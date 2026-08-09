import { pgTable, pgEnum, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { petsTable } from "./pets";
import { usersTable } from "./users";

// Spotlight — featured pet on the Sniff screen.
// Singleton row (seeded on migration with mode='auto').
//   mode='auto'   → resolution picks the pet with the most treats received
//                   over the last spotlight_window_days (config table).
//   mode='manual' → pinned_pet_id is shown until an admin clears the pin.
export const spotlightModeEnum = pgEnum("spotlight_mode", ["auto", "manual"]);

export const spotlightStateTable = pgTable("spotlight_state", {
  id:           uuid("id").primaryKey().defaultRandom(),
  mode:         spotlightModeEnum("mode").notNull().default("auto"),
  pinnedPetId:  uuid("pinned_pet_id").references(() => petsTable.id, { onDelete: "set null" }),
  setByAdminId: text("set_by_admin_id").references(() => usersTable.id, { onDelete: "set null" }),
  setAt:        timestamp("set_at"),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

export type SpotlightState = typeof spotlightStateTable.$inferSelect;
