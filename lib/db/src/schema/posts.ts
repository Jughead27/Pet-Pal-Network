import { pgTable, text, uuid, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { petsTable } from "./pets";

export const postsTable = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    petId: uuid("pet_id")
      .references(() => petsTable.id)
      .notNull(),
    // R2 object key — resolved to a URL at serve time, never stored as a full URL
    mediaKey: text("media_key").notNull(),
    caption: text("caption"),
    isNursery: boolean("is_nursery").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("posts_pet_id_idx").on(table.petId),
  ],
);

export const insertPostSchema = createInsertSchema(postsTable);
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
