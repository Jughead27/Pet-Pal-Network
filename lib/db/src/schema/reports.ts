import { pgTable, text, uuid, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const reportTargetTypeEnum = pgEnum("report_target_type", [
  "post",
  "comment",
]);

// Locked list per spec — order is preserved in the DB type.
export const reportReasonEnum = pgEnum("report_reason", [
  "not_animal_content",
  "animal_cruelty",
  "mislabeled_pet",
  "wrong_nursery_flag",
  "spam",
  "harassment",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "resolved",
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const reportsTable = pgTable(
  "reports",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    reporterId: text("reporter_id")
                  .notNull()
                  .references(() => usersTable.id),
    targetType: reportTargetTypeEnum("target_type").notNull(),
    // target_id holds a post or comment UUID — stored as text, no FK
    // (a single column cannot reference two different tables).
    // Existence is validated at the API layer before insert.
    targetId:   text("target_id").notNull(),
    reason:     reportReasonEnum("reason").notNull(),
    // Silently clamped to 200 chars at the API layer; nullable.
    note:       text("note"),
    status:     reportStatusEnum("status").notNull().default("pending"),
    createdAt:  timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One report per (user, target) — duplicates return 200 { duplicate: true }.
    unique("reports_reporter_target_uniq").on(t.reporterId, t.targetType, t.targetId),
  ],
);

export type Report = typeof reportsTable.$inferSelect;
