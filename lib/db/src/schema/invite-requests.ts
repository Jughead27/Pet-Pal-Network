import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const inviteRequestsTable = pgTable("invite_requests", {
  id:          text("id").primaryKey().default(sql`gen_random_uuid()`),
  email:       text("email").notNull().unique(),
  note:        text("note"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  status:      text("status").notNull().default("pending"),
  // Set when an admin sends a real invite for this request ("send invite"
  // action) — reference only, no FK cascade semantics needed.
  inviteId:    text("invite_id"),
});

export type InviteRequest = typeof inviteRequestsTable.$inferSelect;
