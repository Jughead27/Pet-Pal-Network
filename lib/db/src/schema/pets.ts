import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { speciesTable, breedsTable } from "./species";

export const petsTable = pgTable(
  "pets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .references(() => usersTable.id)
      .notNull(),
    name: text("name").notNull(),
    // Legacy free-text columns — kept for backward compatibility; all existing
    // display code reads these. When a FK is set the server mirrors the name
    // into these columns so they always stay in sync.
    species: text("species").notNull(),
    breed: text("breed"),
    // Structured FK columns — nullable so existing pets remain valid.
    speciesId: uuid("species_id").references(() => speciesTable.id),
    breedId:   uuid("breed_id").references(() => breedsTable.id),
    bio: text("bio"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("pets_owner_id_idx").on(table.ownerId),
    index("pets_species_id_idx").on(table.speciesId),
  ],
);

export const insertPetSchema = createInsertSchema(petsTable);
export type InsertPet = z.infer<typeof insertPetSchema>;
export type Pet = typeof petsTable.$inferSelect;
