/**
 * POST /api/merge-suggestions — user-facing "same pet as one of yours?" flow.
 *
 * A signed-in member viewing a pet they have NO ownership relationship with
 * can suggest it is the same animal as one of their own pets. Collaborative
 * framing — never a report. Goes straight to the admin queue; no notification
 * to the target pet's owners.
 *
 * - Duplicate (same suggester + own pet + target pet) → 200 { ok, duplicate }
 * - Rate limit: 10 suggestions / user / day → 429
 */

import { Router, type IRouter } from "express";
import { db, mergeSuggestionsTable, petsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { isPetOwner } from "../lib/isPetOwner";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── In-memory per-user rate limiter ───────────────────────────────────────────
// Same pattern as reports.ts: 10 suggestions per user per 24h, resets on restart.
const suggestionLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = suggestionLimiter.get(userId);
  if (!entry || now > entry.resetAt) {
    suggestionLimiter.set(userId, { count: 1, resetAt: now + 86_400_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count += 1;
  return true;
}

router.post("/merge-suggestions", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  if (!checkRateLimit(userId)) {
    res.status(429).json({ ok: false, error: "too many suggestions. try again tomorrow." });
    return;
  }

  const { suggesterPetId, targetPetId } = req.body as {
    suggesterPetId?: unknown;
    targetPetId?: unknown;
  };

  if (typeof suggesterPetId !== "string" || !suggesterPetId.trim()) {
    res.status(400).json({ ok: false, error: "invalid suggesterPetId" });
    return;
  }
  if (typeof targetPetId !== "string" || !targetPetId.trim()) {
    res.status(400).json({ ok: false, error: "invalid targetPetId" });
    return;
  }

  const ownPetId = suggesterPetId.trim();
  const otherPetId = targetPetId.trim();

  if (ownPetId === otherPetId) {
    res.status(400).json({ ok: false, error: "cannot suggest a pet against itself" });
    return;
  }

  // Both pets must exist and not be soft-deleted.
  const [ownPet] = await db
    .select({ id: petsTable.id })
    .from(petsTable)
    .where(and(eq(petsTable.id, ownPetId), isNull(petsTable.deletedAt)))
    .limit(1);
  if (!ownPet) {
    res.status(404).json({ ok: false, error: "pet not found" });
    return;
  }
  const [targetPet] = await db
    .select({ id: petsTable.id })
    .from(petsTable)
    .where(and(eq(petsTable.id, otherPetId), isNull(petsTable.deletedAt)))
    .limit(1);
  if (!targetPet) {
    res.status(404).json({ ok: false, error: "pet not found" });
    return;
  }

  // The suggester must own/co-own their pet, and must have NO ownership
  // relationship to the target pet (owners/co-owners never see this flow).
  const [ownsSuggester, ownsTarget] = await Promise.all([
    isPetOwner(userId, ownPetId),
    isPetOwner(userId, otherPetId),
  ]);
  if (!ownsSuggester) {
    res.status(403).json({ ok: false, error: "not your pet" });
    return;
  }
  if (ownsTarget) {
    res.status(400).json({ ok: false, error: "you already share this pet" });
    return;
  }

  try {
    await db.insert(mergeSuggestionsTable).values({
      suggesterUserId: userId,
      suggesterPetId: ownPetId,
      targetPetId: otherPetId,
    });
  } catch (err: unknown) {
    // Unique violation → kind duplicate response, not an error tone.
    const pg = err as { code?: string };
    if (pg?.code === "23505") {
      res.json({ ok: true, duplicate: true });
      return;
    }
    logger.error({ err, userId, suggesterPetId: ownPetId, targetPetId: otherPetId }, "Failed to insert merge suggestion");
    res.status(500).json({ ok: false, error: "could not submit suggestion" });
    return;
  }

  logger.info({ userId, suggesterPetId: ownPetId, targetPetId: otherPetId }, "Merge suggestion submitted");
  res.status(201).json({ ok: true });
});

export default router;
