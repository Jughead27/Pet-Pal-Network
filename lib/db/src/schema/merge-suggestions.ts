import { pgTable, text, uuid, timestamp, pgEnum, unique, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { petsTable } from "./pets";

// ─── merge_suggestions ────────────────────────────────────────────────────────
//
// User-facing "same pet as one of yours?" flow. A signed-in member viewing a
// pet they have NO ownership relationship with can suggest that it is the same
// animal as one of their own pets. Framed as positive/collaborative — never a
// report. No notification is sent to the target pet's owners; the suggestion
// goes straight to the admin queue.

export const mergeSuggestionStatusEnum = pgEnum("merge_suggestion_status", [
  "pending",
  "actioned",
  "dismissed",
]);

export const mergeSuggestionsTable = pgTable(
  "merge_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suggesterUserId: text("suggester_user_id")
      .notNull()
      .references(() => usersTable.id),
    // The suggester's own pet (they own or co-own it).
    suggesterPetId: uuid("suggester_pet_id")
      .notNull()
      .references(() => petsTable.id),
    // The pet being viewed (the suggester has no ownership relationship).
    targetPetId: uuid("target_pet_id")
      .notNull()
      .references(() => petsTable.id),
    status: mergeSuggestionStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One suggestion per (user, own pet, target pet) — duplicates return
    // 200 { duplicate: true } like reports.
    unique("merge_suggestions_uniq").on(t.suggesterUserId, t.suggesterPetId, t.targetPetId),
    index("merge_suggestions_status_idx").on(t.status),
  ],
);

export type MergeSuggestion = typeof mergeSuggestionsTable.$inferSelect;
