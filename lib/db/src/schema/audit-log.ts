import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ─── audit_log ────────────────────────────────────────────────────────────────
//
// Append-only record of every admin mutation.
//
// INVARIANT: no UPDATE or DELETE route exists or will be added.  Each admin
// action inserts exactly one row inside the same transaction as the action
// itself — if the transaction rolls back, the log entry rolls back with it.
//
// action strings are dot-namespaced: <domain>.<verb>
//   report.dismiss | report.hide | report.restore
//   user.suspend   | user.unsuspend
//   invite_request.contact | invite_request.close
//   breed.approve  | breed.reject
//
// targetType / targetId identify the primary object acted on (nullable when
// the action has no single target, e.g. breed.reject affecting many pets).
//
// metadata is a free jsonb bag for supporting context — report id, reason,
// breed name, pet count, etc.  Shape is per-action; no schema enforced here.

export const auditLogTable = pgTable("audit_log", {
  id:         uuid("id").primaryKey().defaultRandom(),
  actorId:    text("actor_id")
                .notNull()
                .references(() => usersTable.id),
  action:     text("action").notNull(),
  targetType: text("target_type"),
  targetId:   text("target_id"),
  metadata:   jsonb("metadata"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
