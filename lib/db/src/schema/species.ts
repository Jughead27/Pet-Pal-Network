import { pgTable, text, uuid, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const speciesTable = pgTable(
  "species",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    name:      text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("species_name_uidx").on(table.name),
    index("species_sort_order_idx").on(table.sortOrder),
  ],
);

export const breedsTable = pgTable(
  "breeds",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    speciesId: uuid("species_id")
      .references(() => speciesTable.id)
      .notNull(),
    name:      text("name").notNull(),
  },
  (table) => [
    index("breeds_species_id_idx").on(table.speciesId),
    uniqueIndex("breeds_species_name_uidx").on(table.speciesId, table.name),
  ],
);

export const insertSpeciesSchema = createInsertSchema(speciesTable);
export const insertBreedSchema   = createInsertSchema(breedsTable);

export type InsertSpecies = z.infer<typeof insertSpeciesSchema>;
export type InsertBreed   = z.infer<typeof insertBreedSchema>;
export type Species       = typeof speciesTable.$inferSelect;
export type Breed         = typeof breedsTable.$inferSelect;
