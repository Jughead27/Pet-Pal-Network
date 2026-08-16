/**
 * Admin routes — feedback section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import { db, usersTable, feedbackTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { writeAudit } from "../../lib/writeAudit.js";

const adminRouter = Router();

// ─── Feedback inbox ───────────────────────────────────────────────────────────

/**
 * GET /admin/feedback?limit=20&offset=0
 *
 * Paginated feedback list, newest first.  Joins users to surface username.
 * Returns: { entries: FeedbackEntry[], total: number }
 *
 * Uses Drizzle fluent API — result is a plain array, no .rows destructuring.
 */
adminRouter.get("/admin/feedback", async (req, res) => {
  const limit  = Math.min(Number(req.query.limit)  || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0,  0);

  const [entries, [{ count }]] = await Promise.all([
    db
      .select({
        id:        feedbackTable.id,
        userId:    feedbackTable.userId,
        username:  usersTable.username,
        body:      feedbackTable.body,
        status:    feedbackTable.status,
        createdAt: feedbackTable.createdAt,
      })
      .from(feedbackTable)
      .leftJoin(usersTable, eq(usersTable.id, feedbackTable.userId))
      .orderBy(desc(feedbackTable.createdAt))
      .limit(limit)
      .offset(offset),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackTable),
  ]);

  res.json({ entries, total: count });
});

/**
 * POST /admin/feedback/:id/reviewed
 *
 * Marks a feedback item as reviewed.
 * Wrapped in a transaction with a writeAudit entry ('feedback.reviewed').
 */
adminRouter.post("/admin/feedback/:id/reviewed", async (req, res) => {
  const { id }     = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(feedbackTable)
      .set({ status: "reviewed" })
      .where(eq(feedbackTable.id, id))
      .returning({ id: feedbackTable.id, userId: feedbackTable.userId });

    if (!updated) return null;

    await writeAudit(tx, userId, "feedback.reviewed", "feedback", id, {
      submittedBy: updated.userId,
    });

    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Feedback not found" });
    return;
  }

  res.json({ ok: true, id, status: "reviewed" });
});

export default adminRouter;
