import { pgTable, text, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { petsTable } from "./pets";
import { usersTable } from "./users";

/**
 * pack_follows — records a user following a pet into their Pack.
 *
 * user_id: Clerk user ID (text, same type as pets.owner_id / users.id)
 * pet_id:  FK to pets
 *
 * Unique constraint on (user_id, pet_id) makes the join operation idempotent:
 * inserting a duplicate pair is a no-op.
 *
 * Indexed on both columns independently so queries by either dimension
 * (all pets a user follows, all followers of a pet) stay fast.
 */
export const packFollowsTable = pgTable(
  "pack_follows",
  {
    userId: text("user_id")
      .references(() => usersTable.id)
      .notNull(),
    petId: uuid("pet_id")
      .references(() => petsTable.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("pack_follows_user_pet_uniq").on(t.userId, t.petId),
    index("pack_follows_user_id_idx").on(t.userId),
    index("pack_follows_pet_id_idx").on(t.petId),
  ],
);
