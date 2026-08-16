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
import {
  db,
  usersTable,
  postsTable,
  commentsTable,
  treatsTable,
  boopsTable,
} from "@workspace/db";
import { eq, sql, and, isNull } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import reportsRouter from "./admin/reports.js";
import spotlightRouter from "./admin/spotlight.js";
import inviteRequestsRouter from "./admin/invite-requests.js";
import breedSuggestionsRouter from "./admin/breed-suggestions.js";
import mergeSuggestionsRouter from "./admin/merge-suggestions.js";
import feedbackRouter from "./admin/feedback.js";
import inviteManagementRouter from "./admin/invite-management.js";
import quotaRequestsRouter from "./admin/quota-requests.js";
import auditRouter from "./admin/audit.js";
import cronRouter from "./admin/cron.js";

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

// ─── Section sub-routers (extracted verbatim; mounted in original order) ─────
adminRouter.use(reportsRouter);
adminRouter.use(spotlightRouter);
adminRouter.use(inviteRequestsRouter);
adminRouter.use(breedSuggestionsRouter);
adminRouter.use(mergeSuggestionsRouter);
adminRouter.use(feedbackRouter);
adminRouter.use(inviteManagementRouter);
adminRouter.use(quotaRequestsRouter);
adminRouter.use(auditRouter);
adminRouter.use(cronRouter);

export default adminRouter;
