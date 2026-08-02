import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * quota_requests — member-initiated requests for additional invite quota.
 *
 * Separate from invite_requests (pre-signup email capture) — these are
 * requests from existing members who have used all their invites and want
 * more.  Admin action: grant (+5 to inviteQuota) or dismiss (no change).
 */
export const quotaRequestsTable = pgTable("quota_requests", {
  id:         text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:     text("user_id").notNull().references(() => usersTable.id),
  status:     text("status").notNull().default("pending"), // pending | granted | dismissed
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by").references(() => usersTable.id),
});

export type QuotaRequest = typeof quotaRequestsTable.$inferSelect;
