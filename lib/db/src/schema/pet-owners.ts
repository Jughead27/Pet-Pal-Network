import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { petsTable } from "./pets";
import { usersTable } from "./users";

// ─── Role enum ────────────────────────────────────────────────────────────────
// 'primary' — the original creator.  Exactly one per pet.  Can invite co-owners,
//             edit pet metadata, delete the pet, and manage all posts.
// 'co'      — accepted via invite.  Can post as the pet and edit pet metadata.
//             Cannot delete the pet or manage posts they didn't create.
export const petOwnerRoleEnum = pgEnum("pet_owner_role", ["primary", "co"]);

// ─── pet_owners ───────────────────────────────────────────────────────────────
//
// Source-of-truth for who has ownership rights to a pet.  Every pet has
// exactly one 'primary' row created atomically with the pet; additional
// 'co' rows are added after an invite is accepted.
//
// MIGRATION (run once after schema push):
//   INSERT INTO pet_owners (pet_id, user_id, role)
//   SELECT id, owner_id, 'primary'
//   FROM   pets
//   ON CONFLICT DO NOTHING;
//
// pets.owner_id is kept as a denormalized primary-pointer (NOT dropped this
// delivery) so existing read paths continue to work during the transition.
export const petOwnersTable = pgTable(
  "pet_owners",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    petId:     uuid("pet_id").references(() => petsTable.id).notNull(),
    userId:    text("user_id").references(() => usersTable.id).notNull(),
    role:      petOwnerRoleEnum("role").notNull(),
    addedAt:   timestamp("added_at").defaultNow().notNull(),
    // Who invited this member (null for the original primary owner).
    invitedBy: text("invited_by").references(() => usersTable.id),
  },
  (t) => ({
    uniquePetUser: unique("pet_owners_pet_user_uniq").on(t.petId, t.userId),
    petIdIdx:      index("pet_owners_pet_id_idx").on(t.petId),
    userIdIdx:     index("pet_owners_user_id_idx").on(t.userId),
  }),
);

export type PetOwner = typeof petOwnersTable.$inferSelect;
