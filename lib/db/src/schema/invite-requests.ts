import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const inviteRequestsTable = pgTable("invite_requests", {
  id:          text("id").primaryKey().default(sql`gen_random_uuid()`),
  email:       text("email").notNull().unique(),
  note:        text("note"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  status:      text("status").notNull().default("pending"),
});

export type InviteRequest = typeof inviteRequestsTable.$inferSelect;
