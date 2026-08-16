/**
 * Admin routes — invite-requests section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import {
  db,
  inviteRequestsTable,
  invitesTable,
  configTable,
} from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { writeAudit } from "../../lib/writeAudit.js";
import { generateCode } from "../invites-member.js";

const adminRouter = Router();

// ─── Invite requests ──────────────────────────────────────────────────────────

/**
 * GET /admin/invite-requests
 *
 * Returns all invite requests, oldest-first, with email, note, age, and status.
 */
adminRouter.get("/admin/invite-requests", async (_req, res) => {
  // Explicit projection — exactly the fields the admin invites screen renders
  // (id, email, note, requestedAt, status, inviteId), so columns added to the
  // table later are not accidentally exposed here.
  const rows = await db
    .select({
      id:          inviteRequestsTable.id,
      email:       inviteRequestsTable.email,
      note:        inviteRequestsTable.note,
      requestedAt: inviteRequestsTable.requestedAt,
      status:      inviteRequestsTable.status,
      inviteId:    inviteRequestsTable.inviteId,
    })
    .from(inviteRequestsTable)
    .orderBy(asc(inviteRequestsTable.requestedAt));

  res.json({ inviteRequests: rows });
});

/**
 * POST /admin/invite-requests/:id/contact
 *
 * Marks an invite request as contacted.
 * Audit: invite_request.contact
 */
adminRouter.post("/admin/invite-requests/:id/contact", async (req, res) => {
  const { id }     = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(inviteRequestsTable)
      .set({ status: "contacted" })
      .where(eq(inviteRequestsTable.id, id))
      .returning();

    if (!updated) return null;

    await writeAudit(tx, userId, "invite_request.contact", "invite_request", id, {
      email: updated.email,
    });

    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Invite request not found" });
    return;
  }

  res.json({ ok: true, id, status: "contacted" });
});

/**
 * POST /admin/invite-requests/:id/close
 *
 * Closes an invite request (no invitation issued — Invites v2 concern).
 * Audit: invite_request.close
 */
adminRouter.post("/admin/invite-requests/:id/close", async (req, res) => {
  const { id }     = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(inviteRequestsTable)
      .set({ status: "closed" })
      .where(eq(inviteRequestsTable.id, id))
      .returning();

    if (!updated) return null;

    await writeAudit(tx, userId, "invite_request.close", "invite_request", id, {
      email: updated.email,
    });

    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Invite request not found" });
    return;
  }

  res.json({ ok: true, id, status: "closed" });
});

/**
 * POST /admin/invite-requests/:id/send-invite
 *
 * Creates a real invite under the acting admin's account (standard lineage —
 * invited_by will point at the admin; admins bypass quota in the normal flow
 * and no quota check applies here either). On success the request is marked
 * `contacted` and the created invite id is recorded on the request row.
 * Closed requests are rejected. If an invite was already sent for this
 * request, returns 409 so admins don't accidentally double-issue.
 * Audit: invite_request.send_invite
 */
adminRouter.post("/admin/invite-requests/:id/send-invite", async (req, res) => {
  const { id }     = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(inviteRequestsTable)
      .where(eq(inviteRequestsTable.id, id))
      .for("update");

    if (!request) return { kind: "not_found" as const };
    if (request.status === "closed") return { kind: "closed" as const };
    if (request.inviteId) return { kind: "already_sent" as const };

    const [invite] = await tx
      .insert(invitesTable)
      .values({ inviterId: userId, code: generateCode() })
      .returning();

    await tx
      .update(inviteRequestsTable)
      .set({ status: "contacted", inviteId: invite.id })
      .where(eq(inviteRequestsTable.id, id));

    await writeAudit(tx, userId, "invite_request.send_invite", "invite_request", id, {
      email:    request.email,
      inviteId: invite.id,
    });

    return { kind: "ok" as const, invite };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Invite request not found" });
    return;
  }
  if (result.kind === "closed") {
    res.status(409).json({ error: "Request is closed" });
    return;
  }
  if (result.kind === "already_sent") {
    res.status(409).json({ error: "An invite was already sent for this request" });
    return;
  }

  res.status(201).json({
    ok: true,
    id,
    status: "contacted",
    invite: { id: result.invite.id, code: result.invite.code },
  });
});

/**
 * GET /admin/users-overview
 *
 * Read-only per-user overview for the admin "Users" table: display name,
 * inviter display name, invites used vs. effective quota, and live post
 * count (archived + admin-hidden excluded — same convention as elsewhere).
 * Tombstoned accounts excluded. Most-recently-joined first. No pagination —
 * intentionally simple at current member counts.
 */
adminRouter.get("/admin/users-overview", async (_req, res) => {
  const [cfg] = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, "invite_default_quota"))
    .limit(1);
  const defaultQuota = parseInt(cfg?.value ?? "5");

  const { rows } = await db.execute(sql`
    SELECT
      u.id,
      COALESCE(u.display_name, u.username)                    AS "displayName",
      u.role,
      u.created_at                                            AS "createdAt",
      COALESCE(ib.display_name, ib.username)                  AS "invitedByName",
      COALESCE(u.invite_quota, ${defaultQuota})::int          AS "effectiveQuota",
      (SELECT COUNT(*)::int FROM invites i
        WHERE i.inviter_id = u.id
          AND i.status IN ('active','used'))                  AS "invitesUsed",
      (SELECT COUNT(*)::int FROM posts p
        WHERE p.posted_by_user_id = u.id
          AND p.archived_at IS NULL
          AND p.hidden_by_admin = FALSE)                      AS "postCount"
    FROM users u
    LEFT JOIN users ib ON ib.id = u.invited_by
    WHERE u.deleted_at IS NULL
    ORDER BY u.created_at DESC
  `);

  // Summary strip totals — same exclusion conventions as the table:
  // tombstoned users excluded, live posts only. Invite totals system-wide.
  const { rows: summaryRows } = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM users u2 WHERE u2.deleted_at IS NULL)      AS "totalUsers",
      (SELECT COUNT(*)::int FROM invites)                                   AS "totalInvites",
      (SELECT COUNT(*)::int FROM invites i2 WHERE i2.status = 'used')       AS "totalInvitesAccepted",
      (SELECT COUNT(*)::int FROM posts p2
        WHERE p2.archived_at IS NULL
          AND p2.hidden_by_admin = FALSE)                                   AS "totalPosts"
  `);

  res.json({ users: rows, summary: summaryRows[0] });
});

export default adminRouter;
