import { pgTable, text, uuid, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const feedbackStatusEnum = pgEnum("feedback_status", ["new", "reviewed"]);

export const feedbackTable = pgTable("feedback", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    text("user_id").notNull().references(() => usersTable.id),
  body:      text("body").notNull(),
  status:    feedbackStatusEnum("status").notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Feedback = typeof feedbackTable.$inferSelect;
