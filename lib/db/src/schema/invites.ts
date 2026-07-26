import { pgTable, text, uuid, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const inviteStatusEnum = pgEnum("invite_status", ["active", "used", "revoked"]);

export const invitesTable = pgTable("invites", {
  id:        uuid("id").primaryKey().defaultRandom(),
  code:      text("code").notNull().unique(),
  inviterId: text("inviter_id").notNull().references(() => usersTable.id),
  status:    inviteStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  usedBy:    text("used_by").references(() => usersTable.id),
  usedAt:    timestamp("used_at"),
});

export type Invite = typeof invitesTable.$inferSelect;
