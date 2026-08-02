/**
 * Member-facing quota-request routes.
 *
 *   POST /api/quota-requests       — request more invites (idempotent on pending)
 *   GET  /api/quota-requests/mine  — check whether a pending request already exists
 */

import { Router } from "express";
import { db, quotaRequestsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const quotaRequestsRouter = Router();

// ── POST /quota-requests ──────────────────────────────────────────────────────
// Creates a pending quota request for the current user.
// Idempotent: if the user already has a pending request, returns the existing
// one without creating a duplicate (prevents spam; admin sees one row per user).

quotaRequestsRouter.post("/quota-requests", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const [existing] = await db
    .select({ id: quotaRequestsTable.id })
    .from(quotaRequestsTable)
    .where(
      and(
        eq(quotaRequestsTable.userId, userId),
        eq(quotaRequestsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existing) {
    res.json({ ok: true, id: existing.id, created: false });
    return;
  }

  const [created] = await db
    .insert(quotaRequestsTable)
    .values({ userId, status: "pending" })
    .returning({ id: quotaRequestsTable.id });

  res.json({ ok: true, id: created.id, created: true });
});

// ── GET /quota-requests/mine ──────────────────────────────────────────────────
// Returns the user's current pending request (if any), so the profile UI can
// show the disabled/confirmed state on mount without an extra POST.

quotaRequestsRouter.get("/quota-requests/mine", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const [pending] = await db
    .select({ id: quotaRequestsTable.id, createdAt: quotaRequestsTable.createdAt })
    .from(quotaRequestsTable)
    .where(
      and(
        eq(quotaRequestsTable.userId, userId),
        eq(quotaRequestsTable.status, "pending"),
      ),
    )
    .limit(1);

  res.json({ pendingRequest: pending ?? null });
});

export default quotaRequestsRouter;
