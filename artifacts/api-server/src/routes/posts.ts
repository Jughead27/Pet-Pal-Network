import { Router, type IRouter, type Response } from "express";
import { logger } from "../lib/logger";
import {
  db,
  postsTable,
  petsTable,
  commentsTable,
  boopsTable,
  treatsTable,
  configTable,
  usersTable,
  postPetsTable,
  notificationsTable,
  blocksTable,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { CreatePostBody } from "@workspace/api-zod";
import { deleteObject } from "../lib/r2.js";
import { notBlockedCommentAuthor, notHiddenByAdminComment, blockedFromPostPetOwners } from "../lib/excludeBlocked.js";
import { isPetOwner } from "../lib/isPetOwner.js";
import { activePets } from "../lib/petQueries.js";

const router: IRouter = Router();

// ── Per-user rate limiting ────────────────────────────────────────────────────
// Same in-memory map pattern used by reports.ts / uploads.ts, keyed per
// endpoint so heavy use of one action (e.g. lots of boops) doesn't block an
// unrelated action (e.g. posting): 25 requests per minute per user per action.
const postsLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(action: string, userId: string): boolean {
  const key = `${action}:${userId}`;
  const now = Date.now();
  const entry = postsLimiter.get(key);
  if (!entry || now > entry.resetAt) {
    postsLimiter.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 25) return false;
  entry.count += 1;
  return true;
}

function rateLimited(res: Response): void {
  res.status(429).json({ error: "too many requests, please slow down." });
}

/**
 * POST /posts
 *
 * Creates a post tagged with one or more pets.
 *   - petIds[0] is the primary pet (stored in posts.pet_id for backward compat).
 *     Caller must own the primary pet.
 *   - All petIds are written to post_pets (the canonical tag source).
 *   - Any pet not owned by the caller triggers a 'pet_tagged' notification for
 *     that pet's owner.
 */
router.post("/posts", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  if (!checkRateLimit("create", userId)) { rateLimited(res); return; }

  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { petIds, mediaKey, caption, isNursery, cropFocusX, cropFocusY, cropMode, cropX, cropY, cropW, cropH, cropFillColor, cropFillThumb } = parsed.data;

  // Crop rect must be a coherent all-or-none tuple with positive dimensions —
  // renderers require all four fields, so a partial rect is a client bug.
  const cropFields = [cropX, cropY, cropW, cropH];
  const setCount = cropFields.filter((v) => v != null).length;
  if (setCount !== 0 && setCount !== 4) {
    res.status(400).json({ error: "cropX/cropY/cropW/cropH must be provided together" });
    return;
  }
  if (setCount === 4 && !((cropW as number) > 0 && (cropH as number) > 0)) {
    res.status(400).json({ error: "cropW and cropH must be positive" });
    return;
  }
  const primaryPetId = petIds[0];

  // Verify all tagged pets exist and are active
  const petRows = await db
    .select({ id: petsTable.id, ownerId: petsTable.ownerId })
    .from(petsTable)
    .where(and(inArray(petsTable.id, petIds), activePets));

  if (petRows.length !== petIds.length) {
    const foundIds = new Set(petRows.map((p) => p.id));
    const missing = petIds.find((id) => !foundIds.has(id));
    res.status(404).json({ error: `Pet not found: ${missing}` });
    return;
  }

  // Caller must own the primary pet
  if (!(await isPetOwner(userId, primaryPetId))) {
    res.status(403).json({ error: "You do not own the primary pet" });
    return;
  }

  // Derive cross-owner pets early — needed for both the block check and
  // for creating notifications after the post is inserted.
  const crossOwnerPets = petRows.filter((p) => p.ownerId !== userId);

  // Block guard: reject if any tagged pet's owner has a block relationship
  // with the poster (either direction).  Consistent with feed-side block
  // exclusion: both "I blocked them" and "they blocked me" prevent the tag.
  //
  // Behavior: hard reject (403) rather than silent drop, so the poster
  // knows immediately why the pet wasn't tagged.  There is no existing
  // write-side partial-failure precedent in this app to follow.
  if (crossOwnerPets.length > 0) {
    const crossOwnerIds = crossOwnerPets.map((p) => p.ownerId);
    const blockRows = await db
      .select({ id: blocksTable.id })
      .from(blocksTable)
      .where(
        or(
          and(inArray(blocksTable.blockerId, crossOwnerIds), eq(blocksTable.blockedId, userId)),
          and(eq(blocksTable.blockerId, userId),             inArray(blocksTable.blockedId, crossOwnerIds)),
        ),
      )
      .limit(1);

    if (blockRows.length > 0) {
      res.status(403).json({ error: "Cannot tag a pet whose owner has blocked you (or whom you have blocked)" });
      return;
    }
  }

  const [post] = await db
    .insert(postsTable)
    .values({
      petId:          primaryPetId,
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
      cropFillColor:  cropFillColor ?? null,
      cropFillThumb:  cropFillThumb ?? null,
      postedByUserId: userId,
    })
    .returning();

  // Record all pet tags in post_pets (including primary)
  await db
    .insert(postPetsTable)
    .values(petIds.map((petId) => ({ postId: post.id, petId, taggedByUserId: userId })))
    .onConflictDoNothing();

  // Notify owners of cross-owner tagged pets (crossOwnerPets derived above)
  if (crossOwnerPets.length > 0) {
    await db.insert(notificationsTable).values(
      crossOwnerPets.map((p) => ({
        userId:      p.ownerId,
        type:        "pet_tagged",
        postId:      post.id,
        petId:       p.id,
        actorUserId: userId,
      })),
    );
  }

  res.status(201).json({
    id:        post.id,
    petIds,
    mediaKey:  post.mediaKey,
    caption:   post.caption  ?? null,
    isNursery: post.isNursery,
    createdAt: post.createdAt,
  });
});

/**
 * POST /posts/:id/pets/:petId
 *
 * Adds a pet tag to an already-published post.
 * Caller must be the original poster. Applies the same block guard as POST /posts.
 * Idempotent (ON CONFLICT DO NOTHING). Sends a pet_tagged notification for cross-owner pets.
 */
router.post("/posts/:id/pets/:petId", async (req, res) => {
  const { id: postId, petId } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  if (!checkRateLimit("tag", userId)) { rateLimited(res); return; }

  // Caller must be the original poster
  const [postRow] = await db
    .select({ postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(and(eq(postsTable.id, postId), isNull(postsTable.archivedAt)))
    .limit(1);

  if (!postRow) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (postRow.postedByUserId !== userId) {
    res.status(403).json({ error: "You can only add tags to your own posts" });
    return;
  }

  // Pet must exist and be active
  const [petRow] = await db
    .select({ id: petsTable.id, ownerId: petsTable.ownerId })
    .from(petsTable)
    .where(and(eq(petsTable.id, petId), activePets))
    .limit(1);

  if (!petRow) {
    res.status(404).json({ error: "Pet not found" });
    return;
  }

  // Block guard — same as POST /posts: both directions, cross-owner only
  if (petRow.ownerId !== userId) {
    const [blockRow] = await db
      .select({ id: blocksTable.id })
      .from(blocksTable)
      .where(
        or(
          and(eq(blocksTable.blockerId, petRow.ownerId), eq(blocksTable.blockedId, userId)),
          and(eq(blocksTable.blockerId, userId),         eq(blocksTable.blockedId, petRow.ownerId)),
        ),
      )
      .limit(1);

    if (blockRow) {
      res.status(403).json({ error: "Cannot tag a pet whose owner has blocked you (or whom you have blocked)" });
      return;
    }
  }

  // Insert tag (idempotent)
  await db
    .insert(postPetsTable)
    .values({ postId, petId, taggedByUserId: userId })
    .onConflictDoNothing();

  // Notify cross-owner pet's owner
  if (petRow.ownerId !== userId) {
    await db
      .insert(notificationsTable)
      .values({ userId: petRow.ownerId, type: "pet_tagged", postId, petId, actorUserId: userId })
      .onConflictDoNothing();
  }

  res.status(201).json({ ok: true });
});

/**
 * DELETE /posts/:id/pets/:petId
 *
 * Removes a specific pet tag from a post.
 * Allowed for EITHER the pet's owner OR the post's original poster.
 * Returns 400 if this is the last remaining tag on the post.
 */
router.delete("/posts/:id/pets/:petId", async (req, res) => {
  const { id: postId, petId } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  if (!checkRateLimit("untag", userId)) { rateLimited(res); return; }

  // Allow the pet's owner OR the post's original poster
  const [postRow] = await db
    .select({ postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(eq(postsTable.id, postId))
    .limit(1);

  if (!postRow) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const callerOwnsPet  = await isPetOwner(userId, petId);
  const callerIsAuthor = postRow.postedByUserId === userId;

  if (!callerOwnsPet && !callerIsAuthor) {
    res.status(403).json({ error: "You do not own this pet or this post" });
    return;
  }

  // Verify the tag exists
  const [tag] = await db
    .select({ id: postPetsTable.id })
    .from(postPetsTable)
    .where(and(eq(postPetsTable.postId, postId), eq(postPetsTable.petId, petId)))
    .limit(1);

  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }

  // Prevent removing the last tag
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postPetsTable)
    .where(eq(postPetsTable.postId, postId));

  if ((countRow?.count ?? 0) <= 1) {
    res.status(400).json({ error: "Cannot remove the last pet tag from a post" });
    return;
  }

  await db
    .delete(postPetsTable)
    .where(and(eq(postPetsTable.postId, postId), eq(postPetsTable.petId, petId)));

  res.status(204).end();
});

/**
 * GET /posts/:id/comments
 */
router.get("/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const rows = await db
    .select({
      id:                commentsTable.id,
      text:              commentsTable.text,
      authorUsername:    usersTable.username,
      authorDisplayName: usersTable.displayName,
      authorId:          commentsTable.userId,
      // Tombstoned (deleted) account — client renders "Former pshpsh member",
      // distinct from the generic fallback for users without a displayName.
      authorDeleted:     sql<boolean>`(users.deleted_at IS NOT NULL)`,
      createdAt:         commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .where(and(
      eq(commentsTable.postId, id),
      isNull(commentsTable.deletedAt),
      notBlockedCommentAuthor(userId),
      notHiddenByAdminComment(),
    ))
    .orderBy(asc(commentsTable.createdAt));

  res.json(rows);
});

/**
 * DELETE /posts/:id/comments/:commentId
 *
 * Soft-deletes a comment by setting deleted_at.
 * Only the comment's own author may delete it — the post owner cannot delete
 * other users' comments via this endpoint (admin hide is the moderation path).
 */
router.delete("/posts/:id/comments/:commentId", async (req, res) => {
  const { commentId } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  if (!checkRateLimit("comment-delete", userId)) { rateLimited(res); return; }

  const [comment] = await db
    .select({ userId: commentsTable.userId })
    .from(commentsTable)
    .where(and(
      eq(commentsTable.id, commentId),
      isNull(commentsTable.deletedAt),
    ))
    .limit(1);

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  if (comment.userId !== userId) {
    res.status(403).json({ error: "You can only delete your own comments" });
    return;
  }

  await db
    .update(commentsTable)
    .set({ deletedAt: new Date() })
    .where(eq(commentsTable.id, commentId));

  res.status(204).send();
});

/**
 * POST /posts/:id/boops
 */
router.post("/posts/:id/boops", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  if (!checkRateLimit("boop", userId)) { rateLimited(res); return; }

  const [post] = await db
    .select({ id: postsTable.id, blocked: blockedFromPostPetOwners(userId) })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  // Blocked either direction → the post is invisible to this user; 404 keeps
  // that consistent (no information leak).
  if (!post || post.blocked) {
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
  if (!checkRateLimit("treat", userId)) { rateLimited(res); return; }

  const [postRow] = await db
    .select({ postedByUserId: postsTable.postedByUserId, blocked: blockedFromPostPetOwners(userId) })
    .from(postsTable)
    .where(eq(postsTable.id, id))
    .limit(1);

  // Blocked either direction → invisible content; 404 like other blocked reads.
  if (!postRow || postRow.blocked) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Self-treat guard: the post's author cannot treat their own post.
  // Co-owners who did NOT author the post may still treat it.
  if (postRow.postedByUserId === userId) {
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
  if (!checkRateLimit("edit", userId)) { rateLimited(res); return; }

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

  if (!(await isPetOwner(userId, postRow.petId))) {
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
  if (!checkRateLimit("delete", userId)) { rateLimited(res); return; }

  const [postRow] = await db
    .select({ mediaKey: postsTable.mediaKey, petId: postsTable.petId, postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!(await isPetOwner(userId, postRow.petId))) {
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
    // The DB transaction above has already committed: the post and all its
    // reactions/comments are gone, and the user's intent (delete my post) has
    // fully succeeded from their perspective. Only the R2 media cleanup
    // failed, leaving an orphaned object — returning an error here would be
    // misleading (nothing the client can retry: a retried DELETE would 404)
    // and could make the UI claim a still-visible post. So: keep the success
    // response, but log via the structured logger with the mediaKey so the
    // orphan is visible/trackable for later cleanup.
    logger.error(
      { err, postId: id, mediaKey: postRow.mediaKey },
      "R2 delete failed after post DB deletion — orphaned media object",
    );
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
  if (!checkRateLimit("archive", userId)) { rateLimited(res); return; }

  const [postRow] = await db
    .select({ petId: postsTable.petId, postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!(await isPetOwner(userId, postRow.petId))) {
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
  if (!checkRateLimit("unarchive", userId)) { rateLimited(res); return; }

  const [postRow] = await db
    .select({ petId: postsTable.petId, postedByUserId: postsTable.postedByUserId })
    .from(postsTable)
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!(await isPetOwner(userId, postRow.petId))) {
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
  if (!checkRateLimit("comment", userId)) { rateLimited(res); return; }
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
    .select({ username: usersTable.username, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  res.status(201).json({
    id:                inserted.id,
    text:              inserted.text,
    authorUsername:    user.username,
    authorDisplayName: user.displayName ?? null,
    authorId:          userId,        // required for client-side ownership check
    createdAt:         inserted.createdAt,
  });
});

export default router;
