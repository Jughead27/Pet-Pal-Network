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

// ─── Status enum ─────────────────────────────────────────────────────────────
// pending  → invite sent, awaiting response
// accepted → invitee accepted; a pet_owners row was created
// declined → invitee declined; no ownership granted
export const petInviteStatusEnum = pgEnum("pet_invite_status", [
  "pending",
  "accepted",
  "declined",
]);

// ─── pet_owner_invites ────────────────────────────────────────────────────────
//
// Consent gate for co-ownership: no one becomes a co-owner without explicitly
// accepting.  Only primary owners can create invites.
//
// The unique index (pet_id, invitee_id) prevents double-inviting the same user
// to the same pet while an invite is pending or already resolved.
export const petOwnerInvitesTable = pgTable(
  "pet_owner_invites",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    petId:      uuid("pet_id").references(() => petsTable.id).notNull(),
    inviterId:  text("inviter_id").references(() => usersTable.id).notNull(),
    inviteeId:  text("invitee_id").references(() => usersTable.id).notNull(),
    status:     petInviteStatusEnum("status").notNull().default("pending"),
    createdAt:  timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"), // set on accept or decline
  },
  (t) => ({
    uniquePetInvitee: unique("pet_owner_invites_pet_invitee_uniq").on(t.petId, t.inviteeId),
    inviteeIdx:       index("pet_owner_invites_invitee_idx").on(t.inviteeId),
    petIdIdx:         index("pet_owner_invites_pet_id_idx").on(t.petId),
  }),
);

export type PetOwnerInvite = typeof petOwnerInvitesTable.$inferSelect;
