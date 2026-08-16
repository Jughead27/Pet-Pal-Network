/**
 * Admin routes — audit section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const adminRouter = Router();

// ─── Audit log viewer ─────────────────────────────────────────────────────────

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
