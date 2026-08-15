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
 *   GET  /admin/stats                         — total user/post/comment/treat/boop counts
 *
 * Audit-log: every mutating handler writes an audit_log row IN THE SAME
 * TRANSACTION as the action via writeAudit(tx, ...).  If the transaction rolls
 * back, the log entry rolls back with it.  audit_log is APPEND-ONLY — no
 * update or delete route exists or will be added.
 */

import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
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
  spotlightStateTable,
  treatsTable,
  boopsTable,
} from "@workspace/db";
import { eq, asc, desc, sql, and, isNull } from "drizzle-orm";
import { PETS_INCLUDING_DELETED } from "../lib/petQueries.js";
import { requireRole } from "../middlewares/requireRole";
import { mediaTokenUrl } from "../lib/r2.js";
import { writeAudit } from "../lib/writeAudit.js";
import { purgeSoftDeletedPets } from "../lib/purgePets.js";
import { purgeDeletedComments } from "../lib/purgeDeletedComments.js";
import { deleteAccount } from "../lib/deleteAccount.js";
import { resolveSpotlightPet, getSpotlightWindowDays } from "../lib/spotlight.js";
import { processClerkDeletions } from "../lib/clerkDeletions.js";
import { generateCode } from "./invites-member.js";

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

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * GET /admin/stats
 *
 * Quiet health-check totals for the admin hub.
 * Posts/comments count LIVE content only (not archived, not hidden_by_admin);
 * users count everyone regardless of suspension; treats/boops are raw totals.
 */
adminRouter.get("/admin/stats", async (_req, res) => {
  const count = sql<number>`count(*)::int`;
  const [[users], [posts], [comments], [treats], [boops]] = await Promise.all([
    db.select({ count }).from(usersTable),
    db
      .select({ count })
      .from(postsTable)
      .where(and(isNull(postsTable.archivedAt), eq(postsTable.hiddenByAdmin, false))),
    db
      .select({ count })
      .from(commentsTable)
      .where(and(isNull(commentsTable.deletedAt), eq(commentsTable.hiddenByAdmin, false))),
    db.select({ count }).from(treatsTable),
    db.select({ count }).from(boopsTable),
  ]);

  res.json({
    users:    users.count,
    posts:    posts.count,
    comments: comments.count,
    treats:   treats.count,
    boops:    boops.count,
  });
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
      c.user_id             AS "commentAuthorId",
      tu.username           AS "targetUserUsername",
      tu.display_name       AS "targetUserDisplayName",
      tu.suspended          AS "targetUserSuspended"
    FROM reports r
    INNER JOIN users reporter ON reporter.id = r.reporter_id
    LEFT JOIN posts p ON r.target_type = 'post'
                     AND p.id::text = r.target_id
    LEFT JOIN pets pet_t ON r.target_type = 'post'
                        AND pet_t.id = p.pet_id
    LEFT JOIN comments c ON r.target_type = 'comment'
                        AND c.id::text = r.target_id
    LEFT JOIN users tu ON r.target_type = 'user'
                      AND tu.id = r.target_id
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
        : r.targetType === "comment"
          ? {
              type:         "comment",
              text:         r.commentText ?? null,
              hiddenByAdmin: Boolean(r.commentHiddenByAdmin),
            }
          : {
              type:        "user",
              username:    r.targetUserUsername ?? null,
              displayName: r.targetUserDisplayName ?? null,
              suspended:   Boolean(r.targetUserSuspended),
            },
    contentOwnerId:
      r.targetType === "post"
        ? (r.postOwnerId ?? null)
        : r.targetType === "comment"
          ? (r.commentAuthorId ?? null)
          : (r.targetId ?? null),
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

    // "hide" doesn't apply to a user-target report — there's no content to hide.
    if (report.targetType === "user") return { notApplicable: true as const };

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

  if ("notApplicable" in result) {
    res.status(400).json({ error: "hide is not applicable to user reports" });
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

  if (report.targetType === "user") {
    // User-target report: the reported user IS the suspension target.
    const [row] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, report.targetId))
      .limit(1);
    ownerUserId = row?.id ?? null;
  } else if (report.targetType === "post") {
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
 * POST /admin/users/:userId/suspend
 *
 * Standalone suspend — takes just a user ID, no report required. Same
 * suspended state and same audit action as the report-triggered path
 * (POST /admin/reports/:id/suspend); the two coexist, this one simply
 * skips report resolution because there is no report. Guards mirror the
 * standalone delete route: no self-suspend, no suspending admins.
 * Audit: user.suspend (metadata { via: "direct" } instead of report info).
 */
adminRouter.post("/admin/users/:userId/suspend", async (req, res) => {
  const { userId: targetUserId } = req.params;
  const { userId: actorId }      = (req as Express.RequestWithAuth).auth!;

  if (targetUserId === actorId) {
    res.status(400).json({ error: "Cannot suspend your own account" });
    return;
  }

  const [target] = await db
    .select({ role: usersTable.role, suspended: usersTable.suspended })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.role === "admin") {
    res.status(403).json({ error: "Cannot suspend an admin account" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ suspended: true })
      .where(eq(usersTable.id, targetUserId));

    await writeAudit(tx, actorId, "user.suspend", "user", targetUserId, { via: "direct" });
  });

  res.json({ ok: true, userId: targetUserId, suspended: true });
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

/**
 * POST /admin/posts/:postId/hide      — set hidden_by_admin, no report needed
 * POST /admin/posts/:postId/unhide    — clear hidden_by_admin
 * POST /admin/comments/:commentId/hide
 * POST /admin/comments/:commentId/unhide
 *
 * Standalone content moderation — take just the content ID, no report
 * required. They set/unset the SAME hiddenByAdmin flag as the report path
 * (POST /admin/reports/:id/hide), so the two coexist: a report-triggered
 * hide can be reversed via direct unhide and vice versa. Unhide is new
 * capability — the flag was previously one-way.
 * Audit: post.hide / post.unhide / comment.hide / comment.unhide,
 * metadata { via: "direct" } to distinguish from report.hide.
 */
adminRouter.post("/admin/posts/:postId/hide", async (req, res) => {
  const { postId }          = req.params;
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(postsTable)
      .set({ hiddenByAdmin: true })
      .where(sql`${postsTable.id}::text = ${postId}`)
      .returning({ id: postsTable.id });

    if (!updated) return null;
    await writeAudit(tx, actorId, "post.hide", "post", postId, { via: "direct" });
    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  res.json({ ok: true, postId, hiddenByAdmin: true });
});

adminRouter.post("/admin/posts/:postId/unhide", async (req, res) => {
  const { postId }          = req.params;
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(postsTable)
      .set({ hiddenByAdmin: false })
      .where(sql`${postsTable.id}::text = ${postId}`)
      .returning({ id: postsTable.id });

    if (!updated) return null;
    await writeAudit(tx, actorId, "post.unhide", "post", postId, { via: "direct" });
    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  res.json({ ok: true, postId, hiddenByAdmin: false });
});

adminRouter.post("/admin/comments/:commentId/hide", async (req, res) => {
  const { commentId }       = req.params;
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(commentsTable)
      .set({ hiddenByAdmin: true })
      .where(sql`${commentsTable.id}::text = ${commentId}`)
      .returning({ id: commentsTable.id });

    if (!updated) return null;
    await writeAudit(tx, actorId, "comment.hide", "comment", commentId, { via: "direct" });
    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  res.json({ ok: true, commentId, hiddenByAdmin: true });
});

adminRouter.post("/admin/comments/:commentId/unhide", async (req, res) => {
  const { commentId }       = req.params;
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(commentsTable)
      .set({ hiddenByAdmin: false })
      .where(sql`${commentsTable.id}::text = ${commentId}`)
      .returning({ id: commentsTable.id });

    if (!updated) return null;
    await writeAudit(tx, actorId, "comment.unhide", "comment", commentId, { via: "direct" });
    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  res.json({ ok: true, commentId, hiddenByAdmin: false });
});

// ─── Spotlight (featured pet) management ─────────────────────────────────────

/**
 * GET /admin/spotlight
 *
 * Current spotlight state for the admin screen: mode, pinned pet (when
 * manual), the currently-resolved pet (what members are seeing), and the
 * auto-resolution window in days.
 */
adminRouter.get("/admin/spotlight", async (_req, res) => {
  const [state] = await db.select().from(spotlightStateTable).limit(1);

  const [resolvedPet, windowDays] = await Promise.all([
    resolveSpotlightPet(),
    getSpotlightWindowDays(),
  ]);

  let pinnedPet: { id: string; name: string } | null = null;
  if (state?.mode === "manual" && state.pinnedPetId) {
    const [pet] = await db
      .select({ id: petsTable.id, name: petsTable.name })
      .from(petsTable)
      .where(eq(petsTable.id, state.pinnedPetId));
    pinnedPet = pet ?? null;
  }

  res.json({
    mode: state?.mode ?? "auto",
    pinnedPet,
    resolvedPet: resolvedPet ? { id: resolvedPet.id, name: resolvedPet.name, coverPhotoUrl: resolvedPet.coverPhotoUrl } : null,
    windowDays,
  });
});

/**
 * POST /admin/spotlight/pin — body { petId }
 * Sets mode='manual' + pinned pet. Audit: spotlight.pin { petId }.
 */
adminRouter.post("/admin/spotlight/pin", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;
  const petId = typeof req.body?.petId === "string" ? req.body.petId : "";

  if (!petId) {
    res.status(400).json({ error: "petId is required" });
    return;
  }

  const [pet] = await db
    .select({ id: petsTable.id, name: petsTable.name })
    .from(petsTable)
    .where(sql`${petsTable.id}::text = ${petId}`);
  if (!pet) {
    res.status(404).json({ error: "Pet not found" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(spotlightStateTable)
      .set({
        mode:         "manual",
        pinnedPetId:  pet.id,
        setByAdminId: actorId,
        setAt:        new Date(),
        updatedAt:    new Date(),
      });
    await writeAudit(tx, actorId, "spotlight.pin", "pet", pet.id, { petId: pet.id });
  });

  res.json({ ok: true, mode: "manual", pinnedPet: pet });
});

/**
 * POST /admin/spotlight/clear — reverts to mode='auto'. Audit: spotlight.clear.
 */
adminRouter.post("/admin/spotlight/clear", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;

  await db.transaction(async (tx) => {
    await tx
      .update(spotlightStateTable)
      .set({
        mode:         "auto",
        pinnedPetId:  null,
        setByAdminId: actorId,
        setAt:        new Date(),
        updatedAt:    new Date(),
      });
    await writeAudit(tx, actorId, "spotlight.clear", null, null, null);
  });

  res.json({ ok: true, mode: "auto" });
});

/**
 * PATCH /admin/spotlight/config — body { windowDays }
 * Positive integer ≤ 90. Audit: spotlight.config_update { windowDays }.
 */
adminRouter.patch("/admin/spotlight/config", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;
  const windowDays = req.body?.windowDays;

  if (typeof windowDays !== "number" || !Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    res.status(400).json({ error: "windowDays must be an integer between 1 and 90" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(configTable)
      .values({ key: "spotlight_window_days", value: String(windowDays) })
      .onConflictDoUpdate({
        target: configTable.key,
        set:    { value: String(windowDays) },
      });
    await writeAudit(tx, actorId, "spotlight.config_update", null, null, { windowDays });
  });

  res.json({ ok: true, windowDays });
});

/**
 * POST /admin/users/:userId/delete
 *
 * Admin-triggered account deletion (enforcement cases). Runs the same shared
 * deleteAccount() routine as the self-serve flow; Clerk hard delete follows
 * after the grace period via the cron. Admins cannot delete their own account
 * through this route (use the self-serve flow), and cannot delete other admins.
 * Audit: user.deleted (written inside deleteAccount's transaction).
 */
adminRouter.post("/admin/users/:userId/delete", async (req, res) => {
  const { userId: targetUserId } = req.params;
  const { userId: actorId }      = (req as Express.RequestWithAuth).auth!;

  if (targetUserId === actorId) {
    res.status(400).json({ error: "Use the self-serve flow to delete your own account" });
    return;
  }

  const [target] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (target?.role === "admin") {
    res.status(403).json({ error: "Cannot delete an admin account" });
    return;
  }

  const result = await deleteAccount(targetUserId, actorId, "admin");
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json({ ok: true, userId: targetUserId });
});

/**
 * GET /admin/suspended-users
 *
 * Read-only list of currently suspended accounts so admins can find and
 * unsuspend them from the UI (the unsuspend action itself already exists).
 */
adminRouter.get("/admin/suspended-users", async (_req, res) => {
  const rows = await db
    .select({
      id:          usersTable.id,
      username:    usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(eq(usersTable.suspended, true));

  res.json({ users: rows });
});

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
      u.suspended                                             AS "suspended",
      u.invite_quota                                          AS "inviteQuota",
      COALESCE(u.invite_quota, ${defaultQuota})::int          AS "effectiveQuota",
      ib.username                                             AS "invitedByUsername",
      COUNT(i.id) FILTER (WHERE i.status IN ('active','used'))::int AS "nonRevokedCount",
      COUNT(i.id) FILTER (WHERE i.status = 'active')::int    AS "activeCount",
      COUNT(i.id) FILTER (WHERE i.status = 'used')::int      AS "usedCount",
      (SELECT COUNT(*)::int FROM posts p
        WHERE p.posted_by_user_id = u.id
          AND p.archived_at IS NULL
          AND p.hidden_by_admin = FALSE)                      AS "postCount",
      (SELECT COUNT(*)::int FROM comments c
        WHERE c.user_id = u.id
          AND c.deleted_at IS NULL
          AND c.hidden_by_admin = FALSE)                      AS "commentCount"
    FROM users u
    LEFT JOIN users ib ON ib.id = u.invited_by
    LEFT JOIN invites i ON i.inviter_id = u.id
    WHERE u.deleted_at IS NULL
    GROUP BY u.id, u.username, u.role, u.invite_quota, ib.username
    ORDER BY u.username ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const { rows: [{ total }] } = await db.execute(sql`
    SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL
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

// ─── Cron: purge soft-deleted rows ────────────────────────────────────────────

/**
 * GET /admin/cron/purge
 *
 * Hard-deletes rows that passed their 30-day soft-delete grace period:
 *   • Pets (and their posts, reactions, pack-follows, ownership records, R2 media)
 *   • Comments (no media — straight DB delete)
 *
 * NOT behind the requireRole("admin") middleware — this is called by an external
 * scheduler, not an authenticated user.  Instead it checks X-Purge-Secret against
 * the PURGE_SECRET environment variable.  If PURGE_SECRET is unset the route is
 * disabled (returns 503) so it cannot be accidentally invoked in development.
 *
 * Scheduling (set schedule to "0 3 * * *" — 03:00 UTC daily):
 *   Render:       create a Cron Job service pointing at GET /admin/cron/purge
 *   Vercel:       add { "path": "/api/admin/cron/purge", "schedule": "0 3 * * *" } to vercel.json
 *   Self-hosted:  node-cron inside the server process calling this URL with the secret header
 */
adminRouter.get("/admin/cron/purge", async (req, res) => {
  const secret = process.env["PURGE_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "PURGE_SECRET not configured — cron route disabled" });
    return;
  }
  // Timing-safe comparison (same pattern as verifyMediaToken in lib/r2.ts).
  // Both values are hashed to a fixed length first so timingSafeEqual never
  // throws on length mismatch and no length information leaks via timing.
  const provided = req.headers["x-purge-secret"];
  const providedHash = createHash("sha256").update(typeof provided === "string" ? provided : "").digest();
  const expectedHash = createHash("sha256").update(secret).digest();
  if (typeof provided !== "string" || !timingSafeEqual(providedHash, expectedHash)) {
    res.status(401).json({ error: "Invalid or missing X-Purge-Secret header" });
    return;
  }

  const [pets, comments, clerkDeletions] = await Promise.all([
    purgeSoftDeletedPets(),
    purgeDeletedComments(),
    processClerkDeletions(),
  ]);

  res.json({
    ok: true,
    purged: { pets: pets.purged, comments: comments.purged },
    clerkDeletions,
  });
});

export default adminRouter;
