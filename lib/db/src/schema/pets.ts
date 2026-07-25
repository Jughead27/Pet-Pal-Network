import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const petsTable = pgTable(
  "pets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .references(() => usersTable.id)
      .notNull(),
    name: text("name").notNull(),
    species: text("species").notNull(),
    breed: text("breed"),
    bio: text("bio"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("pets_owner_id_idx").on(table.ownerId),
  ],
);

export const insertPetSchema = createInsertSchema(petsTable);
export type InsertPet = z.infer<typeof insertPetSchema>;
export type Pet = typeof petsTable.$inferSelect;
