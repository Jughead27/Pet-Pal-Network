import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * notifications — lightweight in-app notifications.
 *
 * Currently only used for pet_tagged events (cross-owner pet tagging).
 * Kept minimal per spec: no push delivery, no complex threading.
 *
 * readAt null = unread.  readAt set = dismissed.
 */
export const notificationsTable = pgTable(
  "notifications",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    userId:      text("user_id").notNull().references(() => usersTable.id),
    type:        text("type").notNull(),   // 'pet_tagged'
    postId:      uuid("post_id"),
    petId:       uuid("pet_id"),
    actorUserId: text("actor_user_id"),    // who created the post / tag
    createdAt:   timestamp("created_at").defaultNow().notNull(),
    readAt:      timestamp("read_at"),
  },
  (table) => [
    index("notifications_user_id_idx").on(table.userId),
    index("notifications_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);
