import { Router, type IRouter } from "express";
import {
  db,
  postsTable,
  petsTable,
  commentsTable,
  boopsTable,
  treatsTable,
  configTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { CreatePostBody } from "@workspace/api-zod";
import { deleteObject } from "../lib/r2.js";
import { notBlockedCommentAuthor, notHiddenByAdminComment } from "../lib/excludeBlocked.js";
import { isPetOwner, isPetPrimaryOwner } from "../lib/isPetOwner.js";
import { activePets } from "../lib/petQueries.js";

const router: IRouter = Router();

/**
 * POST /posts
 *
 * Creates a post for a pet owned (primary or co) by the authenticated user.
 * Stores posted_by_user_id for moderation/audit — never surfaced in any UI.
 */
router.post("/posts", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { petId, mediaKey, caption, isNursery, cropFocusX, cropFocusY, cropMode, cropX, cropY, cropW, cropH } = parsed.data;

  // Verify pet exists, is not soft-deleted, and caller is any owner (primary or co)
  const [pet] = await db
    .select({ id: petsTable.id })
    .from(petsTable)
    .where(and(eq(petsTable.id, petId), activePets))
    .limit(1);

  if (!pet) {
    res.status(404).json({ error: "Pet not found" });
    return;
  }

  if (!(await isPetOwner(userId, petId))) {
    res.status(403).json({ error: "You do not own this pet" });
    return;
  }

  const [post] = await db
    .insert(postsTable)
    .values({
      petId,
      mediaKey,
      caption:        caption ?? null,
      isNursery:      isNursery ?? false,
      cropFocusX:     cropFocusX ?? null,
      cropFocusY:     cropFocusY ?? null,
      cropMode:       cropMode  ?? null,
      cropX:          cropX     ?? null,
      cropY:          cropY     ?? null,
      cropW:          cropW     ?? null,
      cropH:          cropH     ?? null,
      // Audit field — never returned to clients
      postedByUserId: userId,
    })
    .returning();

  res.status(201).json({
    id:         post.id,
    petId:      post.petId,
    mediaKey:   post.mediaKey,
    caption:    post.caption ?? null,
    isNursery:  post.isNursery,
    cropFocusX: post.cropFocusX ?? null,
    cropFocusY: post.cropFocusY ?? null,
    createdAt:  post.createdAt,
  });
});

/**
 * GET /posts/:id/comments
 */
router.get("/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const rows = await db
    .select({
      id:             commentsTable.id,
      text:           commentsTable.text,
      authorUsername: usersTable.username,
      authorId:       commentsTable.userId,
      createdAt:      commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .where(and(
      eq(commentsTable.postId, id),
      notBlockedCommentAuthor(userId),
      notHiddenByAdminComment(),
    ))
    .orderBy(asc(commentsTable.createdAt));

  res.json(rows);
});

/**
 * POST /posts/:id/boops
 */
router.post("/posts/:id/boops", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [post] = await db
    .select({ id: postsTable.id })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db.insert(boopsTable).values({ postId: id, userId });

  const [countRow] = await db
    .select({ boopCount: sql<number>`count(*)::int` })
    .from(boopsTable)
    .where(eq(boopsTable.postId, id));

  res.json({ boopCount: countRow?.boopCount ?? 0 });
});

/**
 * POST /posts/:id/treats
 *
 * Self-treat guard: rejects if the caller is ANY owner (primary or co) of
 * the post's pet — co-owners cannot treat their shared pet's own posts.
 */
router.post("/posts/:id/treats", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [postRow] = await db
    .select({ petId: postsTable.petId })
    .from(postsTable)
    .where(eq(postsTable.id, id))
    .limit(1);

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Self-treat guard: any owner of the pet cannot treat it
  if (await isPetOwner(userId, postRow.petId)) {
    res.status(403).json({ error: "self_treat" });
    return;
  }

  const [limitRow] = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "daily_treat_limit"));
  const dailyLimit = limitRow ? parseInt(limitRow.value, 10) : 5;

  const result = await db.transaction(async (tx) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [countRow] = await tx
      .select({ todayCount: sql<number>`count(*)::int` })
      .from(treatsTable)
      .where(and(eq(treatsTable.userId, userId), gte(treatsTable.createdAt, today)));

    const todayCount = countRow?.todayCount ?? 0;

    if (todayCount >= dailyLimit) {
      return { type: "limit" as const };
    }

    await tx.insert(treatsTable).values({ postId: id, userId });

    const [totalRow] = await tx
      .select({ treatCount: sql<number>`count(*)::int` })
      .from(treatsTable)
      .where(eq(treatsTable.postId, id));

    return {
      type: "ok" as const,
      treatCount: totalRow?.treatCount ?? 0,
      treatsRemainingToday: dailyLimit - (todayCount + 1),
    };
  });

  if (result.type === "limit") {
    res.status(429).json({ error: "treat_limit_reached" });
    return;
  }

  res.json({
    treatCount: result.treatCount,
    treatsRemainingToday: result.treatsRemainingToday,
  });
});

/**
 * PATCH /posts/:id
 *
 * Allowed: original poster OR primary owner.
 * Other co-owners cannot edit posts they didn't create.
 */
router.patch("/posts/:id", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [postRow] = await db
    .select({
      caption:        postsTable.caption,
      isNursery:      postsTable.isNursery,
      petId:          postsTable.petId,
      postedByUserId: postsTable.postedByUserId,
    })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const isOriginalPoster  = postRow.postedByUserId === userId;
  const isPrimary         = !isOriginalPoster && await isPetPrimaryOwner(userId, postRow.petId);

  if (!isOriginalPoster && !isPrimary) {
    res.status(403).json({ error: "You do not own this post" });
    return;
  }

  const body = req.body as { caption?: string | null; isNursery?: boolean };
  const nextCaption   = "caption" in body ? (body.caption ?? null) : postRow.caption;
  const nextIsNursery = typeof body.isNursery === "boolean" ? body.isNursery : postRow.isNursery;

  const [updated] = await db
    .update(postsTable)
    .set({ caption: nextCaption, isNursery: nextIsNursery })
    .where(eq(postsTable.id, id))
    .returning({
      id:        postsTable.id,
      caption:   postsTable.caption,
      isNursery: postsTable.isNursery,
    });

  res.json({
    id:        updated.id,
    caption:   updated.caption ?? null,
    isNursery: updated.isNursery,
  });
});

/**
 * DELETE /posts/:id
 *
 * Allowed: original poster OR primary owner.
 */
router.delete("/posts/:id", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [postRow] = await db
    .select({ mediaKey: postsTable.mediaKey, petId: postsTable.petId, postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const isOriginalPoster  = postRow.postedByUserId === userId;
  const isPrimary         = !isOriginalPoster && await isPetPrimaryOwner(userId, postRow.petId);

  if (!isOriginalPoster && !isPrimary) {
    res.status(403).json({ error: "You do not own this post" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(boopsTable).where(eq(boopsTable.postId, id));
    await tx.delete(treatsTable).where(eq(treatsTable.postId, id));
    await tx.delete(commentsTable).where(eq(commentsTable.postId, id));
    await tx.delete(postsTable).where(eq(postsTable.id, id));
  });

  try {
    await deleteObject(postRow.mediaKey);
  } catch (err) {
    console.error({ err, mediaKey: postRow.mediaKey }, "R2 delete failed — DB row already removed");
  }

  res.status(204).send();
});

/**
 * POST /posts/:id/archive
 *
 * Allowed: original poster OR primary owner.
 */
router.post("/posts/:id/archive", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [postRow] = await db
    .select({ petId: postsTable.petId, postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const isOriginalPoster  = postRow.postedByUserId === userId;
  const isPrimary         = !isOriginalPoster && await isPetPrimaryOwner(userId, postRow.petId);

  if (!isOriginalPoster && !isPrimary) {
    res.status(403).json({ error: "You do not own this post" });
    return;
  }

  const [updated] = await db
    .update(postsTable)
    .set({ archivedAt: new Date() })
    .where(eq(postsTable.id, id))
    .returning({ id: postsTable.id, archivedAt: postsTable.archivedAt });

  res.json({ id: updated.id, archivedAt: updated.archivedAt!.toISOString() });
});

/**
 * POST /posts/:id/unarchive
 *
 * Allowed: original poster OR primary owner.
 */
router.post("/posts/:id/unarchive", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [postRow] = await db
    .select({ petId: postsTable.petId, postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const isOriginalPoster  = postRow.postedByUserId === userId;
  const isPrimary         = !isOriginalPoster && await isPetPrimaryOwner(userId, postRow.petId);

  if (!isOriginalPoster && !isPrimary) {
    res.status(403).json({ error: "You do not own this post" });
    return;
  }

  await db
    .update(postsTable)
    .set({ archivedAt: null })
    .where(eq(postsTable.id, id));

  res.json({ id, archivedAt: null });
});

/**
 * POST /posts/:id/comments
 */
router.post("/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  const { text } = req.body as { text?: string };

  if (!text?.trim()) {
    res.status(400).json({ error: "Comment text is required" });
    return;
  }

  const [post] = await db
    .select({ id: postsTable.id })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [inserted] = await db
    .insert(commentsTable)
    .values({ postId: id, userId, text: text.trim() })
    .returning({
      id: commentsTable.id,
      text: commentsTable.text,
      createdAt: commentsTable.createdAt,
    });

  const [user] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  res.status(201).json({
    id: inserted.id,
    text: inserted.text,
    authorUsername: user.username,
    createdAt: inserted.createdAt,
  });
});

export default router;
