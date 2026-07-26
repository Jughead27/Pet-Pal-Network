import { pgTable, text, timestamp, uniqueIndex, pgEnum, boolean, integer, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Role enum ────────────────────────────────────────────────────────────────
// All new users default to 'member'. Admins are promoted via seed-admin.ts.
// Never trust a client-supplied role; always read from this table.
export const userRoleEnum = pgEnum("user_role", ["member", "admin"]);

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
    role:      userRoleEnum("role").notNull().default("member"),
    // Set by admins. Suspended users receive 403 on every authenticated call.
    suspended:   boolean("suspended").notNull().default(false),
    // Invite v2 — per-user quota override (null = use config default)
    inviteQuota: integer("invite_quota"),
    // Permanent attribution — who invited this user (null = founding account)
    invitedBy:   text("invited_by").references((): AnyPgColumn => usersTable.id),
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
