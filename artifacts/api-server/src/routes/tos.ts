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
import { eq } from "drizzle-orm";
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

export default router;
