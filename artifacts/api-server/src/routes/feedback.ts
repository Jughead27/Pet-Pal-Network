/**
 * POST /api/feedback
 *
 * Authenticated member route — submit a piece of feedback.
 * - body clamped to 1000 chars server-side (client enforces the same)
 * - Rate limit: 5 submissions per user per hour (in-memory, resets on restart)
 */

import { Router, type IRouter } from "express";
import { db, feedbackTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── In-memory per-user rate limiter ───────────────────────────────────────────
// 5 feedback submissions per user per hour.
const feedbackLimiter = new Map<string, { count: number; resetAt: number }>();

function checkFeedbackLimit(userId: string): boolean {
  const now = Date.now();
  const entry = feedbackLimiter.get(userId);
  if (!entry || now > entry.resetAt) {
    feedbackLimiter.set(userId, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count += 1;
  return true;
}

const BODY_MAX = 1000;

/**
 * POST /feedback
 *
 * Body: { body: string }
 * - body is required, trimmed, and clamped to 1000 chars.
 * - Returns 201 { ok: true, id } on success.
 * - Returns 429 when rate limit exceeded.
 */
router.post("/feedback", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  if (!checkFeedbackLimit(userId)) {
    res.status(429).json({ ok: false, error: "too many submissions. try again later." });
    return;
  }

  const { body } = req.body as { body?: unknown };

  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ ok: false, error: "body is required" });
    return;
  }

  const trimmedBody = body.trim().slice(0, BODY_MAX);

  const [row] = await db
    .insert(feedbackTable)
    .values({ userId, body: trimmedBody })
    .returning({ id: feedbackTable.id });

  logger.info({ userId, feedbackId: row.id }, "Feedback submitted");
  res.status(201).json({ ok: true, id: row.id });
});

export default router;
