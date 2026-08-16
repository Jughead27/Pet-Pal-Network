/**
 * Admin routes — reports section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import {
  db,
  reportsTable,
  usersTable,
  postsTable,
  commentsTable,
  petsTable,
} from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { PETS_INCLUDING_DELETED } from "../../lib/petQueries.js";
import { mediaTokenUrl } from "../../lib/r2.js";
import { writeAudit } from "../../lib/writeAudit.js";

const adminRouter = Router();

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
type AdminReportRow = {
  id:                   string;
  targetType:           string;
  targetId:             string;
  reason:               string;
  note:                 string | null;
  createdAt:            Date;
  reporterUsername:     string | null;
  postCaption:          string | null;
  postMediaKey:         string | null;
  postHiddenByAdmin:    boolean | null;
  postOwnerId:          string | null;
  commentText:          string | null;
  commentHiddenByAdmin: boolean | null;
  commentAuthorId:      string | null;
  targetUserUsername:    string | null;
  targetUserDisplayName: string | null;
  targetUserSuspended:   boolean | null;
};

adminRouter.get("/admin/reports", async (_req, res) => {
  const { rows } = await db.execute<AdminReportRow>(sql`
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

  const reports = rows.map((r) => ({
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
            mediaUrl:     r.postMediaKey ? mediaTokenUrl(r.postMediaKey) : null,
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

export default adminRouter;
