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

const router: IRouter = Router();

/**
 * GET /posts/:id/comments
 *
 * Returns all comments on a post, ordered oldest-first, with the author's
 * username joined from the users table.
 */
router.get("/posts/:id/comments", async (req, res) => {
  const { id } = req.params;

  const rows = await db
    .select({
      id: commentsTable.id,
      text: commentsTable.text,
      authorUsername: usersTable.username,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .where(eq(commentsTable.postId, id))
    .orderBy(asc(commentsTable.createdAt));

  res.json(rows);
});

/**
 * POST /posts/:id/boops
 *
 * Inserts one boop event per call (unlimited, no dedupe).
 * Returns the new total boop count for the post.
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
 * In a single transaction:
 *   1. Reject with 403 { error: "self_treat" } if the caller owns the post's pet.
 *   2. Read daily_treat_limit from config (default 5).
 *   3. Count the caller's treats since midnight UTC.
 *   4. Reject with 429 { error: "treat_limit_reached" } if at limit.
 *   5. Insert and return the new treat_count and treats_remaining_today.
 */
router.post("/posts/:id/treats", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Check post exists and get pet owner in one query
  const [postRow] = await db
    .select({ petOwnerId: petsTable.ownerId })
    .from(postsTable)
    .innerJoin(petsTable, eq(petsTable.id, postsTable.petId))
    .where(eq(postsTable.id, id));

  if (!postRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Self-treat guard (permanent condition — checked before the transaction)
  if (postRow.petOwnerId === userId) {
    res.status(403).json({ error: "self_treat" });
    return;
  }

  // Read daily limit from config (default 5)
  const [limitRow] = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "daily_treat_limit"));
  const dailyLimit = limitRow ? parseInt(limitRow.value, 10) : 5;

  // Limit check + insert in a single transaction
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
 * POST /posts/:id/comments
 *
 * Creates a comment on a post, returns it with the author's username.
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
