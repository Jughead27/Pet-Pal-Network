import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// id is the Clerk user ID (string), not a generated UUID.
// username is nullable — users choose one via PATCH /me; middleware still
// auto-provisions a candidate but the column allows null for edge cases.
// Uniqueness is enforced case-insensitively via the partial index below.
export const usersTable = pgTable(
  "users",
  {
    id:           text("id").primaryKey(),
    username:     text("username"),
    displayName:  text("display_name"),
    locationCity: text("location_city"),
    about:        text("about"),
    createdAt:    timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Case-insensitive unique index — only indexes non-null usernames.
    usernameUniqueIdx: uniqueIndex("users_username_lower_idx")
      .on(sql`lower(${t.username})`)
      .where(sql`${t.username} is not null`),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
