import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { speciesTable, breedsTable } from "./species";

/**
 * interest_follows — records a user following a species or breed.
 *
 * Exactly ONE of species_id / breed_id must be set per row (enforced by
 * CHECK constraint). Partial unique indexes prevent duplicate follows:
 *   - (user_id, species_id) unique where species_id IS NOT NULL
 *   - (user_id, breed_id)   unique where breed_id   IS NOT NULL
 *
 * This makes all POST /follows/* operations idempotent (ON CONFLICT DO NOTHING).
 */
export const interestFollowsTable = pgTable(
  "interest_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => usersTable.id)
      .notNull(),
    speciesId: uuid("species_id").references(() => speciesTable.id),
    breedId: uuid("breed_id").references(() => breedsTable.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Exactly one FK must be set
    check(
      "interest_follows_exactly_one_chk",
      sql`(${t.speciesId} IS NOT NULL)::int + (${t.breedId} IS NOT NULL)::int = 1`,
    ),
    // Partial unique indexes — one per follow type
    uniqueIndex("interest_follows_user_species_uidx")
      .on(t.userId, t.speciesId)
      .where(sql`${t.speciesId} IS NOT NULL`),
    uniqueIndex("interest_follows_user_breed_uidx")
      .on(t.userId, t.breedId)
      .where(sql`${t.breedId} IS NOT NULL`),
    // Individual column indexes for reverse lookups
    index("interest_follows_user_id_idx").on(t.userId),
    index("interest_follows_species_id_idx").on(t.speciesId),
    index("interest_follows_breed_id_idx").on(t.breedId),
  ],
);
