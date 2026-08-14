import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { postsTable } from "./posts";
import { usersTable } from "./users";

export const treatsTable = pgTable(
  "treats",
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
    index("treats_post_id_idx").on(table.postId),
    // Popular-sort 7-day window aggregation per post.
    index("treats_post_id_created_at_idx").on(table.postId, table.createdAt),
    index("treats_user_id_idx").on(table.userId),
    // Composite index for daily-cap queries:
    // COUNT treats WHERE user_id = ? AND created_at >= <start of day>
    index("treats_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const insertTreatSchema = createInsertSchema(treatsTable);
export type InsertTreat = z.infer<typeof insertTreatSchema>;
export type Treat = typeof treatsTable.$inferSelect;
