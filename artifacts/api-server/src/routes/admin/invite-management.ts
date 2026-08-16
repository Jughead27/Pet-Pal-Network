/**
 * Admin routes — invite-management section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import { db, usersTable, configTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { writeAudit } from "../../lib/writeAudit.js";

const adminRouter = Router();

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

  const { rows: [{ total }] } = await db.execute<{ total: number }>(sql`
    SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL
  `);

  res.json({ defaultQuota, users: userRows, total });
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

export default adminRouter;
