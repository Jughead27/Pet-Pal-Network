import { pgTable, text, uuid, timestamp, index, real } from "drizzle-orm/pg-core";
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
    // Soft-delete timestamp. When set, the pet is hidden from all public reads
    // and a background purge job hard-deletes everything after 30 days.
    deletedAt: timestamp("deleted_at"),
    // Avatar — owner-chosen profile photo with WYSIWYG focal-point framing.
    // Key is always stored under the avatars/ R2 prefix (server copies from
    // posts/ on selection so deleting a source post never orphans the avatar).
    avatarKey:    text("avatar_key"),
    avatarFocusX: real("avatar_focus_x"),
    avatarFocusY: real("avatar_focus_y"),
    // Crop rect (0–1 fractions of the natural image) — set alongside focusX/Y
    // by the new CropEditor. When present, FocalImage uses the rect branch for
    // pixel-accurate WYSIWYG rendering across any container aspect ratio.
    avatarCropX:  real("avatar_crop_x"),
    avatarCropY:  real("avatar_crop_y"),
    avatarCropW:  real("avatar_crop_w"),
    avatarCropH:  real("avatar_crop_h"),
  },
  (table) => [
    index("pets_owner_id_idx").on(table.ownerId),
    index("pets_species_id_idx").on(table.speciesId),
    index("pets_breed_id_idx").on(table.breedId),
  ],
);

export const insertPetSchema = createInsertSchema(petsTable);
export type InsertPet = z.infer<typeof insertPetSchema>;
export type Pet = typeof petsTable.$inferSelect;
