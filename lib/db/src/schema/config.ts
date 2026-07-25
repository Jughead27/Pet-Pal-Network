import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Flat key/value store for runtime-configurable settings.
// Example: daily_treat_limit = "5"
export const configTable = pgTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const insertConfigSchema = createInsertSchema(configTable);
export type InsertConfig = z.infer<typeof insertConfigSchema>;
export type Config = typeof configTable.$inferSelect;
