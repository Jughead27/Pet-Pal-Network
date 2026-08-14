import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { postsTable } from "./posts";
import { usersTable } from "./users";

// Intentionally no unique constraint on (post_id, user_id).
// Multiple boops per user per post are allowed — claps-style unlimited reactions.
export const boopsTable = pgTable(
  "boops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .references(() => postsTable.id)
      .notNull(),
    userId: text("user_id")
      .references(() => usersTable.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("boops_post_id_idx").on(table.postId),
    // Popular-sort 7-day window aggregation per post.
    index("boops_post_id_created_at_idx").on(table.postId, table.createdAt),
    index("boops_user_id_idx").on(table.userId),
  ],
);

export const insertBoopSchema = createInsertSchema(boopsTable);
export type InsertBoop = z.infer<typeof insertBoopSchema>;
export type Boop = typeof boopsTable.$inferSelect;
