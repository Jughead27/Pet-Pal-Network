import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { petsTable } from "./pets";
import { usersTable } from "./users";

// ─── Status enum ──────────────────────────────────────────────────────────────
// pending  → invite sent, awaiting response
// accepted → invitee accepted; a pet_owners row was created
// declined → invitee declined; no ownership granted
export const coOwnershipRequestStatusEnum = pgEnum("co_ownership_request_status", [
  "pending",
  "accepted",
  "declined",
]);

// ─── co_ownership_requests ────────────────────────────────────────────────────
//
// Consent gate for co-ownership: no one becomes a co-owner without explicitly
// accepting.  Any current owner can create a request.
//
// A partial unique index ensures at most one PENDING request for a given
// pet+invitee pair.  After decline, the inviter can send a new invite.
export const coOwnershipRequestsTable = pgTable(
  "co_ownership_requests",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    petId:          uuid("pet_id").references(() => petsTable.id).notNull(),
    inviterUserId:  text("inviter_user_id").references(() => usersTable.id).notNull(),
    inviteeUserId:  text("invitee_user_id").references(() => usersTable.id).notNull(),
    status:         coOwnershipRequestStatusEnum("status").notNull().default("pending"),
    createdAt:      timestamp("created_at").defaultNow().notNull(),
    resolvedAt:     timestamp("resolved_at"), // set on accept or decline
  },
  (t) => ({
    inviteeIdx: index("co_ownership_requests_invitee_idx").on(t.inviteeUserId),
    petIdx:     index("co_ownership_requests_pet_idx").on(t.petId),
  }),
);

export type CoOwnershipRequest = typeof coOwnershipRequestsTable.$inferSelect;
