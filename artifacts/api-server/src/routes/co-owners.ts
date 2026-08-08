/**
 * Co-ownership routes — symmetric model.
 *
 * Any owner can invite another user by username.
 * Invite lifecycle: pending → accepted | declined.
 * Accepted requests create a pet_owners row.
 * Only self-removal is allowed; a pet must always retain at least one owner.
 */

import { Router, type IRouter } from "express";
import {
  db,
  petOwnersTable,
  coOwnershipRequestsTable,
  petsTable,
  usersTable,
  auditLogTable,
} from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { activePets } from "../lib/petQueries.js";
import { isPetOwner } from "../lib/isPetOwner.js";

const router: IRouter = Router();

// Helper: write an audit log row inside a transaction
async function writeAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actorId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> | null = null,
) {
  await tx.insert(auditLogTable).values({
    actorId,
    action,
    targetType: targetType ?? undefined,
    targetId:   targetId   ?? undefined,
    metadata:   metadata   ?? undefined,
  });
}

// ─── POST /pets/:id/co-owners ─────────────────────────────────────────────────
// Any owner invites a user (by username) as a co-owner.
router.post("/pets/:id/co-owners", async (req, res) => {
  const { id: petId } = req.params;
  const inviterId = (req as any).auth.userId as string;
  const { username } = req.body as { username?: string };

  if (!username?.trim()) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  // Caller must be an owner
  if (!(await isPetOwner(inviterId, petId))) {
    res.status(403).json({ error: "Only owners can invite co-owners" });
    return;
  }

  // Verify pet exists and is not soft-deleted
  const [pet] = await db
    .select({ id: petsTable.id, name: petsTable.name })
    .from(petsTable)
    .where(and(eq(petsTable.id, petId), activePets))
    .limit(1);
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }

  // Resolve invitee by username
  const [invitee] = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.username, username.trim()))
    .limit(1);
  if (!invitee) { res.status(404).json({ error: "User not found" }); return; }

  // Can't invite yourself
  if (invitee.id === inviterId) {
    res.status(400).json({ error: "You are already an owner of this pet" });
    return;
  }

  // Check if already an owner
  const [existing] = await db
    .select({ id: petOwnersTable.id })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, invitee.id)))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "User is already an owner of this pet" });
    return;
  }

  // Check for an existing pending request for this pet+invitee pair
  const [pendingRequest] = await db
    .select({ id: coOwnershipRequestsTable.id })
    .from(coOwnershipRequestsTable)
    .where(
      and(
        eq(coOwnershipRequestsTable.petId, petId),
        eq(coOwnershipRequestsTable.inviteeUserId, invitee.id),
        eq(coOwnershipRequestsTable.status, "pending"),
      ),
    )
    .limit(1);
  if (pendingRequest) {
    res.status(409).json({ error: "A pending request for this user already exists" });
    return;
  }

  const [request] = await db
    .insert(coOwnershipRequestsTable)
    .values({
      petId,
      inviterUserId: inviterId,
      inviteeUserId: invitee.id,
    })
    .returning();

  res.status(201).json({
    id:              request.id,
    petId:           request.petId,
    petName:         pet.name,
    inviteeId:       request.inviteeUserId,
    inviteeUsername: invitee.username,
    status:          request.status,
    createdAt:       request.createdAt,
  });
});

// ─── GET /co-ownership-requests/mine ─────────────────────────────────────────
// Returns pending co-ownership requests addressed to the authenticated user.
router.get("/co-ownership-requests/mine", async (req, res) => {
  const userId = (req as any).auth.userId as string;

  const rows = await db
    .select({
      id:              coOwnershipRequestsTable.id,
      petId:           coOwnershipRequestsTable.petId,
      petName:         petsTable.name,
      inviterUsername: usersTable.username,
      status:          coOwnershipRequestsTable.status,
      createdAt:       coOwnershipRequestsTable.createdAt,
    })
    .from(coOwnershipRequestsTable)
    .innerJoin(petsTable,  eq(petsTable.id,  coOwnershipRequestsTable.petId))
    .innerJoin(usersTable, eq(usersTable.id, coOwnershipRequestsTable.inviterUserId))
    .where(
      and(
        eq(coOwnershipRequestsTable.inviteeUserId, userId),
        eq(coOwnershipRequestsTable.status, "pending"),
        activePets,
      ),
    )
    .orderBy(desc(coOwnershipRequestsTable.createdAt));

  res.json({ requests: rows });
});

// ─── GET /pets/:id/co-ownership-requests ─────────────────────────────────────
// Returns pending owner-sent invites for a pet (any owner may call).
// Invitee-initiated join requests are served by /co-ownership-join-requests.
router.get("/pets/:id/co-ownership-requests", async (req, res) => {
  const { id: petId } = req.params;
  const userId = (req as any).auth.userId as string;

  if (!(await isPetOwner(userId, petId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id:              coOwnershipRequestsTable.id,
      inviteeId:       coOwnershipRequestsTable.inviteeUserId,
      inviteeUsername: usersTable.username,
      status:          coOwnershipRequestsTable.status,
      createdAt:       coOwnershipRequestsTable.createdAt,
    })
    .from(coOwnershipRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, coOwnershipRequestsTable.inviteeUserId))
    .where(
      and(
        eq(coOwnershipRequestsTable.petId, petId),
        eq(coOwnershipRequestsTable.status, "pending"),
        eq(coOwnershipRequestsTable.initiatedBy, "owner"),
      ),
    )
    .orderBy(desc(coOwnershipRequestsTable.createdAt));

  res.json({ requests: rows });
});

// ─── GET /pets/:id/co-ownership-join-requests ────────────────────────────────
// Returns pending invitee-initiated join requests for a pet (any owner may call).
router.get("/pets/:id/co-ownership-join-requests", async (req, res) => {
  const { id: petId } = req.params;
  const userId = (req as any).auth.userId as string;

  if (!(await isPetOwner(userId, petId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id:                coOwnershipRequestsTable.id,
      requesterId:       coOwnershipRequestsTable.inviteeUserId,
      requesterUsername:    usersTable.username,
      requesterDisplayName: usersTable.displayName,
      createdAt:         coOwnershipRequestsTable.createdAt,
    })
    .from(coOwnershipRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, coOwnershipRequestsTable.inviteeUserId))
    .where(
      and(
        eq(coOwnershipRequestsTable.petId, petId),
        eq(coOwnershipRequestsTable.status, "pending"),
        eq(coOwnershipRequestsTable.initiatedBy, "invitee"),
      ),
    )
    .orderBy(desc(coOwnershipRequestsTable.createdAt));

  res.json({ requests: rows });
});

// ─── GET /pets/:id/co-owners ──────────────────────────────────────────────────
// Returns all current owners of a pet (any caller may view).
router.get("/pets/:id/co-owners", async (req, res) => {
  const { id: petId } = req.params;

  const [pet] = await db
    .select({ id: petsTable.id })
    .from(petsTable)
    .where(and(eq(petsTable.id, petId), activePets))
    .limit(1);
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }

  const rows = await db
    .select({
      userId:   petOwnersTable.userId,
      username: usersTable.username,
      addedAt:  petOwnersTable.addedAt,
    })
    .from(petOwnersTable)
    .innerJoin(usersTable, eq(usersTable.id, petOwnersTable.userId))
    .where(eq(petOwnersTable.petId, petId))
    .orderBy(petOwnersTable.addedAt);

  res.json({ owners: rows });
});

// ─── POST /co-ownership-requests/:id/accept ───────────────────────────────────
// Invitee accepts: creates a pet_owners row + audit.
router.post("/co-ownership-requests/:id/accept", async (req, res) => {
  const { id }  = req.params;
  const userId  = (req as any).auth.userId as string;

  const [request] = await db
    .select()
    .from(coOwnershipRequestsTable)
    .where(eq(coOwnershipRequestsTable.id, id))
    .limit(1);

  if (!request)                          { res.status(404).json({ error: "Request not found" }); return; }
  if (request.inviteeUserId !== userId)  { res.status(403).json({ error: "Forbidden" }); return; }
  if (request.status !== "pending")      { res.status(409).json({ error: "Request already resolved" }); return; }
  // Join requests were initiated by the invitee — only a pet owner may approve
  // them (via /approve). The requester cannot self-accept.
  if (request.initiatedBy === "invitee") { res.status(403).json({ error: "Forbidden" }); return; }

  // Fetch inviter's username for the audit metadata
  const [inviter] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, request.inviterUserId))
    .limit(1);

  await db.transaction(async (tx) => {
    // Mark request accepted
    await tx
      .update(coOwnershipRequestsTable)
      .set({ status: "accepted", resolvedAt: new Date() })
      .where(eq(coOwnershipRequestsTable.id, id));

    // Create ownership row
    await tx
      .insert(petOwnersTable)
      .values({ petId: request.petId, userId })
      .onConflictDoNothing(); // idempotent guard

    await writeAudit(tx, userId, "co_owner.accepted", "pet", request.petId, {
      requestId:      id,
      inviterUsername: inviter?.username ?? request.inviterUserId,
    });
  });

  res.json({ ok: true, petId: request.petId });
});

// ─── POST /co-ownership-requests/:id/decline ─────────────────────────────────
// Invitee declines: marks request declined + audit.
router.post("/co-ownership-requests/:id/decline", async (req, res) => {
  const { id } = req.params;
  const userId = (req as any).auth.userId as string;

  const [request] = await db
    .select()
    .from(coOwnershipRequestsTable)
    .where(eq(coOwnershipRequestsTable.id, id))
    .limit(1);

  if (!request)                         { res.status(404).json({ error: "Request not found" }); return; }
  if (request.inviteeUserId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (request.status !== "pending")     { res.status(409).json({ error: "Request already resolved" }); return; }

  await db.transaction(async (tx) => {
    await tx
      .update(coOwnershipRequestsTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(eq(coOwnershipRequestsTable.id, id));

    await writeAudit(tx, userId, "co_owner.declined", "pet", request.petId, {
      requestId: id,
    });
  });

  res.json({ ok: true });
});

// ─── DELETE /pets/:id/co-ownership-requests/:requestId ───────────────────────
// Any owner of the pet can cancel (withdraw) a pending outgoing invite.
router.delete("/pets/:id/co-ownership-requests/:requestId", async (req, res) => {
  const { id: petId, requestId } = req.params;
  const userId = (req as any).auth.userId as string;

  // Caller must be an owner of this pet
  if (!(await isPetOwner(userId, petId))) {
    res.status(403).json({ error: "Only owners can cancel co-owner invites" });
    return;
  }

  const [request] = await db
    .select()
    .from(coOwnershipRequestsTable)
    .where(
      and(
        eq(coOwnershipRequestsTable.id, requestId),
        eq(coOwnershipRequestsTable.petId, petId),
      ),
    )
    .limit(1);

  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  if (request.status !== "pending") {
    res.status(409).json({ error: "Request already resolved" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(coOwnershipRequestsTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(eq(coOwnershipRequestsTable.id, requestId));

    await writeAudit(tx, userId, "co_owner.invite_cancelled", "pet", petId, {
      requestId,
      cancelledByOwnerId: userId,
    });
  });

  res.json({ ok: true });
});

// ─── POST /co-ownership-requests/:id/approve ─────────────────────────────────
// A pet owner approves an invitee-initiated join request: creates a
// pet_owners row for the requester + audit. Any current owner may approve.
router.post("/co-ownership-requests/:id/approve", async (req, res) => {
  const { id }   = req.params;
  const userId   = (req as any).auth.userId as string;

  const [request] = await db
    .select()
    .from(coOwnershipRequestsTable)
    .where(eq(coOwnershipRequestsTable.id, id))
    .limit(1);

  if (!request)                            { res.status(404).json({ error: "Request not found" }); return; }
  if (request.initiatedBy !== "invitee")   { res.status(403).json({ error: "Forbidden" }); return; }
  if (!(await isPetOwner(userId, request.petId))) {
    res.status(403).json({ error: "Only owners can approve join requests" });
    return;
  }
  if (request.status !== "pending")        { res.status(409).json({ error: "Request already resolved" }); return; }

  // Fetch requester's username for the audit metadata
  const [requester] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, request.inviteeUserId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .update(coOwnershipRequestsTable)
      .set({ status: "accepted", resolvedAt: new Date() })
      .where(eq(coOwnershipRequestsTable.id, id));

    await tx
      .insert(petOwnersTable)
      .values({ petId: request.petId, userId: request.inviteeUserId })
      .onConflictDoNothing(); // idempotent guard

    await writeAudit(tx, userId, "co_owner.join_approved", "pet", request.petId, {
      requestId:         id,
      requesterUsername: requester?.username ?? request.inviteeUserId,
    });
  });

  res.json({ ok: true, petId: request.petId });
});

// ─── POST /co-ownership-requests/:id/reject ──────────────────────────────────
// A pet owner rejects an invitee-initiated join request. No ownership change;
// the requester may send a fresh request later.
router.post("/co-ownership-requests/:id/reject", async (req, res) => {
  const { id } = req.params;
  const userId = (req as any).auth.userId as string;

  const [request] = await db
    .select()
    .from(coOwnershipRequestsTable)
    .where(eq(coOwnershipRequestsTable.id, id))
    .limit(1);

  if (!request)                          { res.status(404).json({ error: "Request not found" }); return; }
  if (request.initiatedBy !== "invitee") { res.status(403).json({ error: "Forbidden" }); return; }
  if (!(await isPetOwner(userId, request.petId))) {
    res.status(403).json({ error: "Only owners can reject join requests" });
    return;
  }
  if (request.status !== "pending")      { res.status(409).json({ error: "Request already resolved" }); return; }

  await db.transaction(async (tx) => {
    await tx
      .update(coOwnershipRequestsTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(eq(coOwnershipRequestsTable.id, id));

    await writeAudit(tx, userId, "co_owner.join_rejected", "pet", request.petId, {
      requestId: id,
    });
  });

  res.json({ ok: true });
});

// ─── POST /pets/:id/request-co-ownership ─────────────────────────────────────
// Any authenticated user who does NOT already own a pet can request to be added
// as a co-owner.  A co_ownership_request row is created with:
//   inviterUserId = pet's primary owner  (who must approve)
//   inviteeUserId = requester            (who will be added on acceptance)
// The pet owner sees this request in their incoming list and accepts/declines
// via the standard co-ownership flow.
router.post("/pets/:id/request-co-ownership", async (req, res) => {
  const { id: petId } = req.params;
  const requesterId = (req as any).auth.userId as string;

  // Verify pet exists and is active
  const [pet] = await db
    .select({ id: petsTable.id, ownerId: petsTable.ownerId, name: petsTable.name })
    .from(petsTable)
    .where(and(eq(petsTable.id, petId), activePets))
    .limit(1);

  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }

  // Reject self-request
  if (pet.ownerId === requesterId) {
    res.status(409).json({ error: "already_owner" });
    return;
  }

  // Reject if already an owner via pet_owners
  const [ownerRow] = await db
    .select({ id: petOwnersTable.id })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, requesterId)))
    .limit(1);

  if (ownerRow) { res.status(409).json({ error: "already_owner" }); return; }

  // Reject if there is already a pending request from this requester for this pet
  const [existing] = await db
    .select({ id: coOwnershipRequestsTable.id })
    .from(coOwnershipRequestsTable)
    .where(
      and(
        eq(coOwnershipRequestsTable.petId, petId),
        eq(coOwnershipRequestsTable.inviteeUserId, requesterId),
        sql`${coOwnershipRequestsTable.status} = 'pending'`,
      ),
    )
    .limit(1);

  if (existing) { res.status(409).json({ error: "request_pending" }); return; }

  const [request] = await db
    .insert(coOwnershipRequestsTable)
    .values({
      petId,
      inviterUserId: pet.ownerId, // pet owner must approve
      inviteeUserId: requesterId,  // requester is added on acceptance
      initiatedBy:   "invitee",    // owner-side approve/reject flow applies
    })
    .returning({ id: coOwnershipRequestsTable.id });

  res.status(201).json({ ok: true, requestId: request.id, petId, petName: pet.name });
});

// ─── DELETE /pets/:id/co-owners/me ───────────────────────────────────────────
// Any owner can remove themselves.  Blocked if they are the last owner —
// a pet must always have at least one owner.
router.delete("/pets/:id/co-owners/me", async (req, res) => {
  const { id: petId } = req.params;
  const userId = (req as any).auth.userId as string;

  // Verify caller is an owner
  const [ownerRow] = await db
    .select({ id: petOwnersTable.id })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, userId)))
    .limit(1);

  if (!ownerRow) {
    res.status(404).json({ error: "You are not an owner of this pet" });
    return;
  }

  // Count remaining owners — block if this would orphan the pet
  const [{ ownerCount }] = await db
    .select({ ownerCount: sql<number>`count(*)::int` })
    .from(petOwnersTable)
    .where(eq(petOwnersTable.petId, petId));

  if (ownerCount <= 1) {
    res.status(400).json({
      error: "Cannot remove yourself — you are the only owner. Delete the pet instead.",
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(petOwnersTable)
      .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, userId)));

    await writeAudit(tx, userId, "co_owner.left", "pet", petId, {
      removedUserId: userId,
    });
  });

  res.json({ ok: true });
});

export default router;
