import { Router, type IRouter } from "express";
import { db, reportsTable, postsTable, commentsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── In-memory per-user rate limiter ───────────────────────────────────────────
// 10 reports per user per hour, resets on server restart.
const reportLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = reportLimiter.get(userId);
  if (!entry || now > entry.resetAt) {
    reportLimiter.set(userId, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count += 1;
  return true;
}

// ── Locked enum values ────────────────────────────────────────────────────────
const VALID_TARGET_TYPES = new Set(["post", "comment", "user"] as const);
const VALID_REASONS = new Set([
  "not_animal_content",
  "animal_cruelty",
  "mislabeled_pet",
  "wrong_nursery_flag",
  "spam",
  "harassment",
  "other",
] as const);

type TargetType = "post" | "comment" | "user";
type Reason = typeof VALID_REASONS extends Set<infer R> ? R : never;

/**
 * POST /api/reports
 *
 * Authenticated. Any member can report a post or comment once per target.
 * - Duplicate report (same reporter + target) → 200 { ok: true, duplicate: true }
 * - Rate limit: 10 reports / user / hour → 429
 * - note is silently clamped to 200 chars
 */
router.post("/reports", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  // Rate limit check
  if (!checkRateLimit(userId)) {
    res.status(429).json({ ok: false, error: "too many reports. try again later." });
    return;
  }

  const { targetType, targetId, reason, note } = req.body as {
    targetType?: unknown;
    targetId?:  unknown;
    reason?:    unknown;
    note?:      unknown;
  };

  // ── Input validation ──────────────────────────────────────────────────────
  if (
    typeof targetType !== "string" ||
    !VALID_TARGET_TYPES.has(targetType as TargetType)
  ) {
    res.status(400).json({ ok: false, error: "invalid targetType" });
    return;
  }

  if (typeof targetId !== "string" || !targetId.trim()) {
    res.status(400).json({ ok: false, error: "invalid targetId" });
    return;
  }

  if (typeof reason !== "string" || !VALID_REASONS.has(reason as Reason)) {
    res.status(400).json({ ok: false, error: "invalid reason" });
    return;
  }

  const trimmedTargetId = targetId.trim();
  const trimmedNote = typeof note === "string"
    ? note.trim().slice(0, 200) || null
    : null;

  // Self-report guard for user targets.
  if (targetType === "user" && trimmedTargetId === userId) {
    res.status(400).json({ ok: false, error: "cannot report yourself" });
    return;
  }

  // ── Validate target exists ────────────────────────────────────────────────
  if (targetType === "user") {
    const [target] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, trimmedTargetId))
      .limit(1);
    if (!target) {
      res.status(404).json({ ok: false, error: "user not found" });
      return;
    }
  } else if (targetType === "post") {
    const [post] = await db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(eq(postsTable.id, trimmedTargetId))
      .limit(1);
    if (!post) {
      res.status(404).json({ ok: false, error: "post not found" });
      return;
    }
  } else {
    const [comment] = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.id, trimmedTargetId))
      .limit(1);
    if (!comment) {
      res.status(404).json({ ok: false, error: "comment not found" });
      return;
    }
  }

  // ── Insert (or detect duplicate) ──────────────────────────────────────────
  try {
    await db.insert(reportsTable).values({
      reporterId: userId,
      targetType: targetType as TargetType,
      targetId:   trimmedTargetId,
      reason:     reason as Reason,
      note:       trimmedNote,
    });
  } catch (err: unknown) {
    // Unique constraint violation → kind duplicate response, not an error tone.
    const pg = err as { code?: string };
    if (pg?.code === "23505") {
      res.json({ ok: true, duplicate: true });
      return;
    }
    logger.error({ err, userId, targetType, targetId }, "Failed to insert report");
    res.status(500).json({ ok: false, error: "could not submit report" });
    return;
  }

  logger.info({ userId, targetType, targetId: trimmedTargetId, reason }, "Report submitted");
  res.status(201).json({ ok: true });
});

export default router;
