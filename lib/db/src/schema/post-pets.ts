import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { postsTable } from "./posts";
import { petsTable } from "./pets";
import { usersTable } from "./users";

/**
 * post_pets — join table that records every pet tag on a post.
 *
 * posts.pet_id remains for backward compat as the "primary" pet.
 * This table is the canonical source of truth for multi-pet display:
 *   - All tagged pets, including the primary, are recorded here.
 *   - Pet profile grids query via EXISTS on this table.
 *   - Feed responses include a taggedPets array from this table.
 *
 * Cascade-delete on post removal keeps the table tidy automatically.
 */
export const postPetsTable = pgTable(
  "post_pets",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    postId:          uuid("post_id")
                       .notNull()
                       .references(() => postsTable.id, { onDelete: "cascade" }),
    petId:           uuid("pet_id")
                       .notNull()
                       .references(() => petsTable.id),
    taggedByUserId:  text("tagged_by_user_id")
                       .notNull()
                       .references(() => usersTable.id),
    createdAt:       timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Each pet can appear at most once per post
    uniqueIndex("post_pets_post_id_pet_id_idx").on(table.postId, table.petId),
    // Fast lookup: all posts for a given pet
    index("post_pets_pet_id_idx").on(table.petId),
  ],
);
