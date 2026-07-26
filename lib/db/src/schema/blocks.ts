import { pgTable, text, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * blocks — symmetric user-to-user blocking.
 *
 * Unique constraint on (blocker_id, blocked_id) — a second block attempt
 * from the same viewer against the same target is handled as a duplicate
 * (200 { ok, duplicate }) by the API layer, not a DB error.
 *
 * Self-blocks are rejected at the API layer (not enforced by a DB check
 * constraint so the error message can be clean JSON rather than a PG exception).
 */
export const blocksTable = pgTable(
  "blocks",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    blockerId: text("blocker_id").notNull().references(() => usersTable.id),
    blockedId: text("blocked_id").notNull().references(() => usersTable.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("blocks_blocker_blocked_uniq").on(t.blockerId, t.blockedId),
    index("blocks_blocker_id_idx").on(t.blockerId),
    index("blocks_blocked_id_idx").on(t.blockedId),
  ],
);

export type Block = typeof blocksTable.$inferSelect;
