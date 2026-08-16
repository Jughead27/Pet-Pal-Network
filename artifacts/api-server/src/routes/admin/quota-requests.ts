/**
 * Admin routes — quota-requests section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import {
  db,
  usersTable,
  configTable,
  quotaRequestsTable,
} from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { writeAudit } from "../../lib/writeAudit.js";

const adminRouter = Router();

// ── Quota Requests ────────────────────────────────────────────────────────────
// Members can request more invite quota when they've used all their invites.
// These are SEPARATE from invite_requests (pre-signup email capture).
//
//   GET  /admin/quota-requests/count    — pending badge count
//   GET  /admin/quota-requests          — list, oldest-first (fairness)
//   POST /admin/quota-requests/:id/grant    — bump quota +5, mark granted, audit
//   POST /admin/quota-requests/:id/dismiss  — mark dismissed, audit, no quota change

adminRouter.get("/admin/quota-requests/count", async (_req, res) => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quotaRequestsTable)
    .where(eq(quotaRequestsTable.status, "pending"));
  res.json({ pending: count });
});

adminRouter.get("/admin/quota-requests", async (_req, res) => {
  const requests = await db
    .select({
      id:          quotaRequestsTable.id,
      userId:      quotaRequestsTable.userId,
      status:      quotaRequestsTable.status,
      createdAt:   quotaRequestsTable.createdAt,
      resolvedAt:  quotaRequestsTable.resolvedAt,
      username:    usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(quotaRequestsTable)
    .leftJoin(usersTable, eq(usersTable.id, quotaRequestsTable.userId))
    .orderBy(asc(quotaRequestsTable.createdAt));
  res.json({ requests });
});

adminRouter.post("/admin/quota-requests/:id/grant", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;
  const { id } = req.params;

  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .select({ userId: quotaRequestsTable.userId, status: quotaRequestsTable.status })
      .from(quotaRequestsTable)
      .where(eq(quotaRequestsTable.id, id))
      .limit(1);

    if (!request) return null;
    if (request.status !== "pending") return { alreadyResolved: true as const };

    // Determine current effective quota for this user (same pattern as invites-member.ts)
    const [[userRow], [cfg]] = await Promise.all([
      tx.select({ inviteQuota: usersTable.inviteQuota })
        .from(usersTable)
        .where(eq(usersTable.id, request.userId))
        .limit(1),
      tx.select({ value: configTable.value })
        .from(configTable)
        .where(eq(configTable.key, "invite_default_quota"))
        .limit(1),
    ]);

    const configDefault = parseInt(cfg?.value ?? "5");
    const currentQuota  = userRow?.inviteQuota ?? configDefault;
    const newQuota      = currentQuota + 5;

    await Promise.all([
      tx.update(usersTable)
        .set({ inviteQuota: newQuota })
        .where(eq(usersTable.id, request.userId)),
      tx.update(quotaRequestsTable)
        .set({ status: "granted", resolvedAt: new Date(), resolvedBy: actorId })
        .where(eq(quotaRequestsTable.id, id)),
    ]);

    await writeAudit(tx, actorId, "quota_request.grant", "quota_request", id, {
      targetUserId: request.userId,
      oldQuota:     userRow?.inviteQuota ?? null,
      newQuota,
    });

    return { ok: true as const };
  });

  if (!result) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if ("alreadyResolved" in result) {
    res.status(409).json({ error: "Request already resolved" });
    return;
  }
  res.json({ ok: true });
});

adminRouter.post("/admin/quota-requests/:id/dismiss", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;
  const { id } = req.params;

  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .select({ userId: quotaRequestsTable.userId, status: quotaRequestsTable.status })
      .from(quotaRequestsTable)
      .where(eq(quotaRequestsTable.id, id))
      .limit(1);

    if (!request) return null;
    if (request.status !== "pending") return { alreadyResolved: true as const };

    await tx.update(quotaRequestsTable)
      .set({ status: "dismissed", resolvedAt: new Date(), resolvedBy: actorId })
      .where(eq(quotaRequestsTable.id, id));

    await writeAudit(tx, actorId, "quota_request.dismiss", "quota_request", id, {
      targetUserId: request.userId,
    });

    return { ok: true as const };
  });

  if (!result) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if ("alreadyResolved" in result) {
    res.status(409).json({ error: "Request already resolved" });
    return;
  }
  res.json({ ok: true });
});


export default adminRouter;
