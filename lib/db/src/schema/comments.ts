import { pgTable, text, uuid, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { postsTable } from "./posts";
import { usersTable } from "./users";

export const commentsTable = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .references(() => postsTable.id)
      .notNull(),
    userId: text("user_id")
      .references(() => usersTable.id)
      .notNull(),
    text: text("text").notNull(),
    createdAt:     timestamp("created_at").defaultNow().notNull(),
    // Set by admins during moderation. Hidden comments excluded from all reads;
    // comment author still sees their own comments via the owner path.
    hiddenByAdmin: boolean("hidden_by_admin").notNull().default(false),
  },
  (table) => [
    index("comments_post_id_idx").on(table.postId),
    index("comments_user_id_idx").on(table.userId),
  ],
);

export const insertCommentSchema = createInsertSchema(commentsTable);
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;
