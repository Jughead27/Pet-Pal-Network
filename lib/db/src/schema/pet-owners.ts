import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { petsTable } from "./pets";
import { usersTable } from "./users";

// ─── pet_owners ───────────────────────────────────────────────────────────────
//
// Source-of-truth for who has ownership rights to a pet.
// Fully symmetric — no role distinction between owners.
// Every pet has at least one row (created atomically with the pet).
// Additional rows are added when a co-ownership request is accepted.
//
// MIGRATION (run once after schema push, idempotent):
//   INSERT INTO pet_owners (pet_id, user_id)
//   SELECT id, owner_id
//   FROM   pets
//   ON CONFLICT DO NOTHING;
//
// pets.owner_id is kept as a denormalized primary-pointer (NOT dropped) so
// existing read paths continue to work during the transition.
export const petOwnersTable = pgTable(
  "pet_owners",
  {
    id:      uuid("id").primaryKey().defaultRandom(),
    petId:   uuid("pet_id").references(() => petsTable.id).notNull(),
    userId:  text("user_id").references(() => usersTable.id).notNull(),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => ({
    uniquePetUser: unique("pet_owners_pet_user_uniq").on(t.petId, t.userId),
    petIdIdx:      index("pet_owners_pet_id_idx").on(t.petId),
    userIdIdx:     index("pet_owners_user_id_idx").on(t.userId),
  }),
);

export type PetOwner = typeof petOwnersTable.$inferSelect;
