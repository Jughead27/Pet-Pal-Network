/**
 * Admin router — all routes require role "admin".
 *
 * Surfaces:
 *   GET  /admin/ping                          — liveness probe
 *   GET  /admin/reports                       — pending reports triage list
 *   POST /admin/reports/:id/dismiss           — resolve, content untouched
 *   POST /admin/reports/:id/hide              — set hidden_by_admin on content + resolve
 *   POST /admin/reports/:id/suspend           — suspend content owner + resolve
 *   POST /admin/users/:userId/unsuspend       — lift suspension
 *   GET  /admin/invite-requests               — all invite requests
 *   POST /admin/invite-requests/:id/contact  — mark contacted
 *   POST /admin/invite-requests/:id/close    — close request
 *   GET  /admin/breed-suggestions             — distinct free-text breed submissions
 *   POST /admin/breed-suggestions/approve    — create breed in taxonomy, remap pets
 *   POST /admin/breed-suggestions/reject     — clear free-text breed from pets
 *   GET  /admin/audit                         — paginated audit log, newest first
 *
 * Audit-log: every mutating handler writes an audit_log row IN THE SAME
 * TRANSACTION as the action via writeAudit(tx, ...).  If the transaction rolls
 * back, the log entry rolls back with it.  audit_log is APPEND-ONLY — no
 * update or delete route exists or will be added.
 */

import { Router } from "express";
import {
  db,
  reportsTable,
  usersTable,
  postsTable,
  commentsTable,
  petsTable,
  inviteRequestsTable,
  speciesTable,
  breedsTable,
  auditLogTable,
  feedbackTable,
  invitesTable,
  configTable,
  quotaRequestsTable,
} from "@workspace/db";
import { eq, asc, desc, sql, and, isNull } from "drizzle-orm";
import { PETS_INCLUDING_DELETED } from "../lib/petQueries.js";
import { requireRole } from "../middlewares/requireRole";
import { mediaTokenUrl } from "../lib/r2.js";
import { writeAudit } from "../lib/writeAudit.js";

const adminRouter = Router();

// ─── Role gate ────────────────────────────────────────────────────────────────
// Scoped to "/admin" so Express only invokes requireRole for paths that start
// with /admin.  Without a path argument, Express would run this middleware for
// EVERY request that reaches adminRouter (which is mounted without a prefix),
// turning it into a blanket role gate that blocks /blocks, /reports, etc. for
// member users before those routers ever get a chance to respond.
adminRouter.use("/admin", requireRole("admin"));

// ─── Ping ─────────────────────────────────────────────────────────────────────
adminRouter.get("/admin/ping", (_req, res) => {
  res.json({ ok: true, role: "admin" });
});

// ─── Reports triage ───────────────────────────────────────────────────────────

/**
 * GET /admin/reports
 *
 * Returns all pending reports.
 * Sort: animal_cruelty first, then oldest-first.
 * Each row includes a target preview (post thumbnail + caption, or comment text)
 * and the reporter's username, note, and age.
 *
 * NOTE: db.execute() with drizzle-orm/node-postgres returns a pg.QueryResult
 * object (shape: { rows, rowCount, fields, ... }), NOT a bare array.
 * Always destructure .rows to get the actual data array.
 */
adminRouter.get("/admin/reports", async (_req, res) => {
  const { rows } = await db.execute(sql`
    SELECT
      r.id,
      r.target_type         AS "targetType",
      r.target_id           AS "targetId",
      r.reason,
      r.note,
      r.created_at          AS "createdAt",
      reporter.username     AS "reporterUsername",
      p.caption             AS "postCaption",
      p.media_key           AS "postMediaKey",
      p.hidden_by_admin     AS "postHiddenByAdmin",
      pet_t.owner_id        AS "postOwnerId",
      c.text                AS "commentText",
      c.hidden_by_admin     AS "commentHiddenByAdmin",
      c.user_id             AS "commentAuthorId"
    FROM reports r
    INNER JOIN users reporter ON reporter.id = r.reporter_id
    LEFT JOIN posts p ON r.target_type = 'post'
                     AND p.id::text = r.target_id
    LEFT JOIN pets pet_t ON r.target_type = 'post'
                        AND pet_t.id = p.pet_id
    LEFT JOIN comments c ON r.target_type = 'comment'
                        AND c.id::text = r.target_id
    WHERE r.status = 'pending'
    ORDER BY
      CASE WHEN r.reason = 'animal_cruelty' THEN 0 ELSE 1 END,
      r.created_at ASC
  `);

  const reports = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id:              r.id,
    targetType:      r.targetType,
    targetId:        r.targetId,
    reason:          r.reason,
    note:            r.note ?? null,
    createdAt:       r.createdAt,
    reporterUsername: r.reporterUsername ?? null,
    targetPreview:
      r.targetType === "post"
        ? {
            type:         "post",
            caption:      r.postCaption ?? null,
            mediaUrl:     r.postMediaKey ? mediaTokenUrl(r.postMediaKey as string) : null,
            hiddenByAdmin: Boolean(r.postHiddenByAdmin),
          }
        : {
            type:         "comment",
            text:         r.commentText ?? null,
            hiddenByAdmin: Boolean(r.commentHiddenByAdmin),
          },
    contentOwnerId:
      r.targetType === "post"
        ? (r.postOwnerId ?? null)
        : (r.commentAuthorId ?? null),
  }));

  res.json({ reports });
});

/**
 * POST /admin/reports/:id/dismiss
 *
 * Resolves the report without touching the content.
 * Audit: report.dismiss
 */
adminRouter.post("/admin/reports/:id/dismiss", async (req, res) => {
  const { id }      = req.params;
  const { userId }  = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [report] = await tx
      .select({ targetType: reportsTable.targetType, targetId: reportsTable.targetId, reason: reportsTable.reason })
      .from(reportsTable)
      .where(eq(reportsTable.id, id))
      .limit(1);

    if (!report) return null;

    await tx
      .update(reportsTable)
      .set({ status: "resolved" })
      .where(eq(reportsTable.id, id));

    await writeAudit(tx, userId, "report.dismiss", "report", id, {
      targetType: report.targetType,
      targetId:   report.targetId,
      reason:     report.reason,
    });

    return { id };
  });

  if (!result) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  res.json({ ok: true, id, action: "dismiss" });
});

/**
 * POST /admin/reports/:id/hide
 *
 * Sets hidden_by_admin on the target post or comment, then resolves the report.
 * Idempotent: re-hiding already-hidden content still resolves the report.
 * Audit: report.hide
 */
adminRouter.post("/admin/reports/:id/hide", async (req, res) => {
  const { id }     = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [report] = await tx
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, id))
      .limit(1);

    if (!report) return null;

    if (report.targetType === "post") {
      await tx
        .update(postsTable)
        .set({ hiddenByAdmin: true })
        .where(sql`${postsTable.id}::text = ${report.targetId}`);
    } else {
      await tx
        .update(commentsTable)
        .set({ hiddenByAdmin: true })
        .where(sql`${commentsTable.id}::text = ${report.targetId}`);
    }

    await tx
      .update(reportsTable)
      .set({ status: "resolved" })
      .where(eq(reportsTable.id, id));

    await writeAudit(tx, userId, "report.hide", report.targetType, report.targetId, {
      reportId: id,
      reason:   report.reason,
    });

    return { targetType: report.targetType };
  });

  if (!result) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  res.json({ ok: true, id, action: "hide", targetType: result.targetType });
});

/**
 * POST /admin/reports/:id/suspend
 *
 * Suspends the owner of the reported content, then resolves the report.
 * For a post report: suspends the pet's owner.
 * For a comment report: suspends the comment's author.
 * Audit: user.suspend
 */
adminRouter.post("/admin/reports/:id/suspend", async (req, res) => {
  const { id }     = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  // Resolve content owner outside transaction (read-only lookups first)
  const [report] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, id))
    .limit(1);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  let ownerUserId: string | null = null;

  if (report.targetType === "post") {
    const [row] = await db
      .select({ ownerId: petsTable.ownerId })
      .from(postsTable)
      .innerJoin(petsTable, and(eq(petsTable.id, postsTable.petId), PETS_INCLUDING_DELETED))
      .where(sql`${postsTable.id}::text = ${report.targetId}`)
      .limit(1);
    ownerUserId = row?.ownerId ?? null;
  } else {
    const [row] = await db
      .select({ userId: commentsTable.userId })
      .from(commentsTable)
      .where(sql`${commentsTable.id}::text = ${report.targetId}`)
      .limit(1);
    ownerUserId = row?.userId ?? null;
  }

  if (!ownerUserId) {
    res.status(404).json({ error: "Content owner not found" });
    return;
  }

  const suspendedId = ownerUserId;

  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ suspended: true })
      .where(eq(usersTable.id, suspendedId));

    await tx
      .update(reportsTable)
      .set({ status: "resolved" })
      .where(eq(reportsTable.id, id));

    await writeAudit(tx, userId, "user.suspend", "user", suspendedId, {
      reportId:   id,
      targetType: report.targetType,
      targetId:   report.targetId,
      reason:     report.reason,
    });
  });

  res.json({ ok: true, id, action: "suspend", suspendedUserId: suspendedId });
});

/**
 * POST /admin/users/:userId/unsuspend
 *
 * Lifts a suspension. Safe to call on already-active users (no-op on the
 * suspended flag, still logs the action).
 * Audit: user.unsuspend
 */
adminRouter.post("/admin/users/:userId/unsuspend", async (req, res) => {
  const { userId: targetUserId } = req.params;
  const { userId: actorId }      = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(usersTable)
      .set({ suspended: false })
      .where(eq(usersTable.id, targetUserId))
      .returning({ id: usersTable.id, suspended: usersTable.suspended });

    if (!updated) return null;

    await writeAudit(tx, actorId, "user.unsuspend", "user", targetUserId, null);

    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ ok: true, userId: targetUserId, suspended: false });
});

// ─── Invite requests ──────────────────────────────────────────────────────────

/**
 * GET /admin/invite-requests
 *
 * Returns all invite requests, oldest-first, with email, note, age, and status.
 */
adminRouter.get("/admin/invite-requests", async (_req, res) => {
  const rows = await db
    .select()
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

// ─── Breed suggestions ────────────────────────────────────────────────────────

/**
 * GET /admin/breed-suggestions
 *
 * Returns distinct free-text breed submissions (pets where breedId IS NULL
 * and breed IS NOT NULL and speciesId IS NOT NULL), grouped by species + name
 * with a count of how many pets share each suggestion.
 *
 * NOTE: db.execute() with drizzle-orm/node-postgres returns a pg.QueryResult;
 * destructure .rows to get the bare array.
 */
adminRouter.get("/admin/breed-suggestions", async (_req, res) => {
  const { rows } = await db.execute(sql`
    SELECT
      p.species_id     AS "speciesId",
      sp.name          AS "speciesName",
      p.breed          AS "breedName",
      COUNT(*)::int    AS "petCount"
    FROM pets p
    INNER JOIN species sp ON sp.id = p.species_id
    WHERE p.breed_id IS NULL
      AND p.breed IS NOT NULL
      AND p.species_id IS NOT NULL
    GROUP BY p.species_id, sp.name, p.breed
    ORDER BY sp.name ASC, p.breed ASC
  `);

  res.json({ suggestions: rows as unknown as Record<string, unknown>[] });
});

/**
 * POST /admin/breed-suggestions/approve
 *
 * Body: { speciesId, breedName }
 *
 * Duplicate-aware: if a breed with that name already exists for the species
 * (case-insensitive), ci-matches to the existing breed rather than creating a
 * twin. Updates all matching pets to use the canonical breedId.
 * Audit: breed.approve
 */
adminRouter.post("/admin/breed-suggestions/approve", async (req, res) => {
  const { speciesId, breedName } = req.body as {
    speciesId?: string;
    breedName?: string;
  };
  const { userId } = (req as Express.RequestWithAuth).auth!;

  if (!speciesId || !breedName?.trim()) {
    res.status(400).json({ error: "speciesId and breedName are required" });
    return;
  }

  const trimmedName = breedName.trim();

  // Verify species exists (read-only, outside transaction)
  const [species] = await db
    .select()
    .from(speciesTable)
    .where(eq(speciesTable.id, speciesId))
    .limit(1);

  if (!species) {
    res.status(400).json({ error: "Species not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Check for existing breed (case-insensitive)
    const [existing] = await tx
      .select()
      .from(breedsTable)
      .where(
        and(
          eq(breedsTable.speciesId, speciesId),
          sql`lower(${breedsTable.name}) = lower(${trimmedName})`,
        ),
      )
      .limit(1);

    let canonicalBreed = existing;

    if (!canonicalBreed) {
      const [created] = await tx
        .insert(breedsTable)
        .values({ speciesId, name: trimmedName })
        .returning();
      canonicalBreed = created;
    }

    const updated = await tx
      .update(petsTable)
      .set({ breedId: canonicalBreed.id, breed: canonicalBreed.name })
      .where(
        and(
          eq(petsTable.speciesId, speciesId),
          isNull(petsTable.breedId),
          sql`lower(${petsTable.breed}) = lower(${trimmedName})`,
        ),
      )
      .returning({ id: petsTable.id });

    await writeAudit(tx, userId, "breed.approve", "breed", canonicalBreed.id, {
      speciesId,
      speciesName:  species.name,
      breedName:    canonicalBreed.name,
      created:      !existing,
      petsUpdated:  updated.length,
    });

    return { canonicalBreed, created: !existing, petsUpdated: updated.length };
  });

  res.json({
    ok:          true,
    breed:       { id: result.canonicalBreed.id, name: result.canonicalBreed.name, speciesId },
    created:     result.created,
    petsUpdated: result.petsUpdated,
  });
});

/**
 * POST /admin/breed-suggestions/reject
 *
 * Body: { speciesId, breedName }
 *
 * Clears the free-text breed from all matching pets (sets breed = null).
 * The pet owner can re-enter a breed if they wish.
 * Audit: breed.reject
 */
adminRouter.post("/admin/breed-suggestions/reject", async (req, res) => {
  const { speciesId, breedName } = req.body as {
    speciesId?: string;
    breedName?: string;
  };
  const { userId } = (req as Express.RequestWithAuth).auth!;

  if (!speciesId || !breedName?.trim()) {
    res.status(400).json({ error: "speciesId and breedName are required" });
    return;
  }

  const trimmedName = breedName.trim();

  const petsUpdated = await db.transaction(async (tx) => {
    const updated = await tx
      .update(petsTable)
      .set({ breed: null })
      .where(
        and(
          eq(petsTable.speciesId, speciesId),
          isNull(petsTable.breedId),
          sql`lower(${petsTable.breed}) = lower(${trimmedName})`,
        ),
      )
      .returning({ id: petsTable.id });

    await writeAudit(tx, userId, "breed.reject", null, null, {
      speciesId,
      breedName:   trimmedName,
      petsUpdated: updated.length,
    });

    return updated.length;
  });

  res.json({ ok: true, petsUpdated });
});

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

// ─── Audit log viewer ─────────────────────────────────────────────────────────

// ─── Invite Management ────────────────────────────────────────────────────────

/**
 * GET /admin/invite-management?limit=30&offset=0
 *
 * Returns all users with their effective invite quota, invited-by lineage,
 * and per-status invite counts. Uses raw SQL for the multi-aggregate GROUP BY.
 * Response: { defaultQuota, users: UserQuotaRow[], total }
 */
adminRouter.get("/admin/invite-management", async (req, res) => {
  const limit  = Math.min(Number(req.query.limit)  || 30, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  // Default quota from config
  const [cfgRow] = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, "invite_default_quota"))
    .limit(1);
  const defaultQuota = parseInt(cfgRow?.value ?? "5");

  const { rows: userRows } = await db.execute(sql`
    SELECT
      u.id,
      u.username,
      u.role,
      u.invite_quota                                          AS "inviteQuota",
      COALESCE(u.invite_quota, ${defaultQuota})::int          AS "effectiveQuota",
      ib.username                                             AS "invitedByUsername",
      COUNT(i.id) FILTER (WHERE i.status IN ('active','used'))::int AS "nonRevokedCount",
      COUNT(i.id) FILTER (WHERE i.status = 'active')::int    AS "activeCount",
      COUNT(i.id) FILTER (WHERE i.status = 'used')::int      AS "usedCount"
    FROM users u
    LEFT JOIN users ib ON ib.id = u.invited_by
    LEFT JOIN invites i ON i.inviter_id = u.id
    GROUP BY u.id, u.username, u.role, u.invite_quota, ib.username
    ORDER BY u.username ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const { rows: [{ total }] } = await db.execute(sql`
    SELECT COUNT(*)::int AS total FROM users
  `);

  res.json({ defaultQuota, users: userRows, total: (total as number) });
});

/**
 * POST /admin/invite-management/quota
 *
 * Body: { userId: string, quota: number | null }
 *   quota = null   → reset to config default
 *   quota = number → per-user override (must be >= 0)
 *
 * Writes audit('user.invite_quota_set', { oldQuota, newQuota }).
 */
adminRouter.post("/admin/invite-management/quota", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;
  const { userId, quota }   = req.body as { userId?: string; quota?: number | null };

  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId required" });
    return;
  }

  const newQuota =
    quota === null || quota === undefined
      ? null
      : Math.max(0, Math.round(Number(quota)));

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ inviteQuota: usersTable.inviteQuota })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) return null;

    const [updated] = await tx
      .update(usersTable)
      .set({ inviteQuota: newQuota })
      .where(eq(usersTable.id, userId))
      .returning({ inviteQuota: usersTable.inviteQuota });

    await writeAudit(tx, actorId, "user.invite_quota_set", "user", userId, {
      oldQuota: user.inviteQuota,
      newQuota,
    });

    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ ok: true, userId, inviteQuota: result.inviteQuota });
});

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

/**
 * GET /admin/audit?limit=20&offset=0
 *
 * Paginated audit log, newest first.  Joins users to surface actorUsername.
 * Returns: { entries: AuditEntry[], total: number }
 *
 * Uses Drizzle fluent API (not raw SQL) so the result is a plain array —
 * no .rows destructuring needed.
 */
adminRouter.get("/admin/audit", async (req, res) => {
  const limit  = Math.min(Number(req.query.limit)  || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [entries, [{ count }]] = await Promise.all([
    db
      .select({
        id:            auditLogTable.id,
        actorId:       auditLogTable.actorId,
        actorUsername: usersTable.username,
        action:        auditLogTable.action,
        targetType:    auditLogTable.targetType,
        targetId:      auditLogTable.targetId,
        metadata:      auditLogTable.metadata,
        createdAt:     auditLogTable.createdAt,
      })
      .from(auditLogTable)
      .leftJoin(usersTable, eq(usersTable.id, auditLogTable.actorId))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit)
      .offset(offset),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogTable),
  ]);

  res.json({ entries, total: count });
});

export default adminRouter;
