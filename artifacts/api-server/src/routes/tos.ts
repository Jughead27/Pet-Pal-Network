/**
 * ToS acceptance endpoint.
 *
 *   POST /api/tos/accept
 *
 * Records accepted_tos_at = now(), accepted_tos_version = current version
 * inside a single transaction alongside a writeAudit('tos.accepted') row.
 * Idempotent: if the user has already accepted the current version, returns ok.
 */

import { Router, type IRouter } from "express";
import { db, usersTable, configTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { writeAudit } from "../lib/writeAudit.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.post("/tos/accept", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  // Fetch current version from config
  const [cfg] = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, "tos_current_version"))
    .limit(1);

  const currentVersion = cfg?.value ?? "2026-07-27";

  // Idempotency: already on this version → no-op
  const [user] = await db
    .select({ acceptedTosVersion: usersTable.acceptedTosVersion })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (user?.acceptedTosVersion === currentVersion) {
    res.json({ ok: true, alreadyAccepted: true, version: currentVersion });
    return;
  }

  // Record acceptance inside a transaction with audit
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ acceptedTosAt: new Date(), acceptedTosVersion: currentVersion })
      .where(eq(usersTable.id, userId));

    await writeAudit(tx, userId, "tos.accepted", "user", userId, {
      version: currentVersion,
    });
  });

  logger.info({ userId, version: currentVersion }, "ToS accepted");
  res.json({ ok: true, version: currentVersion });
});

/**
 * Age affirmation endpoint (COPPA self-affirmation, 13+).
 *
 *   POST /age/affirm
 *
 * Records age_affirmed_at = now() alongside a writeAudit('age.affirmed') row.
 * Idempotent: if already affirmed, returns ok without rewriting the timestamp.
 */
router.post("/age/affirm", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  // Atomic conditional update — concurrency-safe idempotency. Only the
  // request that actually flips null → now() writes the audit row.
  let updated = false;
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(usersTable)
      .set({ ageAffirmedAt: new Date() })
      .where(and(eq(usersTable.id, userId), isNull(usersTable.ageAffirmedAt)))
      .returning({ id: usersTable.id });

    if (rows.length > 0) {
      updated = true;
      await writeAudit(tx, userId, "age.affirmed", "user", userId, {});
    }
  });

  if (!updated) {
    res.json({ ok: true, alreadyAffirmed: true });
    return;
  }

  logger.info({ userId }, "Age affirmed (13+)");
  res.json({ ok: true });
});

export default router;
