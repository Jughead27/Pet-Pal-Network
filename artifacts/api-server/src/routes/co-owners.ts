/**
 * Co-ownership invite routes.
 *
 * Invite lifecycle: pending → accepted | declined.
 * Accepted invites create a pet_owners row (role='co').
 * No one becomes a co-owner without explicitly accepting.
 */

import { Router, type IRouter } from "express";
import {
  db,
  petOwnersTable,
  petOwnerInvitesTable,
  petsTable,
  usersTable,
  auditLogTable,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { activePets } from "../lib/petQueries.js";
import { isPetPrimaryOwner } from "../lib/isPetOwner.js";

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

// ─── POST /pets/:petId/co-owner-invites ──────────────────────────────────────
// Primary owner invites a user (by username) as a co-owner.
router.post("/pets/:petId/co-owner-invites", async (req, res) => {
  const { petId }  = req.params;
  const inviterId  = (req as any).auth.userId as string;
  const { username } = req.body as { username?: string };

  if (!username?.trim()) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  // Only primary owner may invite
  if (!(await isPetPrimaryOwner(inviterId, petId))) {
    res.status(403).json({ error: "Only the primary owner can invite co-owners" });
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
    res.status(400).json({ error: "You are already the primary owner" });
    return;
  }

  // Check if already an owner
  const [existing] = await db
    .select({ id: petOwnersTable.id })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, invitee.id)))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "User is already a co-owner of this pet" });
    return;
  }

  // Create invite (the unique index will reject a duplicate pending invite)
  let invite;
  try {
    const [row] = await db
      .insert(petOwnerInvitesTable)
      .values({
        petId,
        inviterId,
        inviteeId: invitee.id,
        status:    "pending",
      })
      .returning();
    invite = row;
  } catch (err: any) {
    // Unique violation = invite already exists for this pet+invitee pair
    if (err.code === "23505") {
      res.status(409).json({ error: "An invite to this user is already pending" });
      return;
    }
    throw err;
  }

  res.status(201).json({
    id:          invite.id,
    petId:       invite.petId,
    petName:     pet.name,
    inviteeId:   invite.inviteeId,
    inviteeUsername: invitee.username,
    status:      invite.status,
    createdAt:   invite.createdAt,
  });
});

// ─── GET /me/co-owner-invites ─────────────────────────────────────────────────
// Returns pending co-owner invites addressed to the authenticated user.
router.get("/me/co-owner-invites", async (req, res) => {
  const userId = (req as any).auth.userId as string;

  const rows = await db
    .select({
      id:             petOwnerInvitesTable.id,
      petId:          petOwnerInvitesTable.petId,
      petName:        petsTable.name,
      inviterUsername: usersTable.username,
      status:         petOwnerInvitesTable.status,
      createdAt:      petOwnerInvitesTable.createdAt,
    })
    .from(petOwnerInvitesTable)
    .innerJoin(petsTable,   eq(petsTable.id,   petOwnerInvitesTable.petId))
    .innerJoin(usersTable,  eq(usersTable.id,  petOwnerInvitesTable.inviterId))
    .where(
      and(
        eq(petOwnerInvitesTable.inviteeId, userId),
        eq(petOwnerInvitesTable.status, "pending"),
        activePets,
      ),
    )
    .orderBy(desc(petOwnerInvitesTable.createdAt));

  res.json({ invites: rows });
});

// ─── GET /pets/:petId/co-owners ───────────────────────────────────────────────
// Returns all owners of a pet (any owner may call this).
router.get("/pets/:petId/co-owners", async (req, res) => {
  const { petId } = req.params;

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
      role:     petOwnersTable.role,
      addedAt:  petOwnersTable.addedAt,
    })
    .from(petOwnersTable)
    .innerJoin(usersTable, eq(usersTable.id, petOwnersTable.userId))
    .where(eq(petOwnersTable.petId, petId))
    .orderBy(petOwnersTable.addedAt);

  res.json({ owners: rows });
});

// ─── GET /pets/:petId/co-owner-invites ────────────────────────────────────────
// Returns pending invites sent for a pet (primary owner only).
router.get("/pets/:petId/co-owner-invites", async (req, res) => {
  const { petId } = req.params;
  const userId    = (req as any).auth.userId as string;

  if (!(await isPetPrimaryOwner(userId, petId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id:              petOwnerInvitesTable.id,
      inviteeId:       petOwnerInvitesTable.inviteeId,
      inviteeUsername: usersTable.username,
      status:          petOwnerInvitesTable.status,
      createdAt:       petOwnerInvitesTable.createdAt,
    })
    .from(petOwnerInvitesTable)
    .innerJoin(usersTable, eq(usersTable.id, petOwnerInvitesTable.inviteeId))
    .where(
      and(
        eq(petOwnerInvitesTable.petId, petId),
        eq(petOwnerInvitesTable.status, "pending"),
      ),
    )
    .orderBy(desc(petOwnerInvitesTable.createdAt));

  res.json({ invites: rows });
});

// ─── POST /co-owner-invites/:id/accept ───────────────────────────────────────
// Invitee accepts: creates a pet_owners row (role='co') + audit.
router.post("/co-owner-invites/:id/accept", async (req, res) => {
  const { id }  = req.params;
  const userId  = (req as any).auth.userId as string;

  const [invite] = await db
    .select()
    .from(petOwnerInvitesTable)
    .where(eq(petOwnerInvitesTable.id, id))
    .limit(1);

  if (!invite)                        { res.status(404).json({ error: "Invite not found" }); return; }
  if (invite.inviteeId !== userId)    { res.status(403).json({ error: "Forbidden" }); return; }
  if (invite.status !== "pending")    { res.status(409).json({ error: "Invite already resolved" }); return; }

  // Fetch inviter's username for the audit metadata
  const [inviter] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, invite.inviterId))
    .limit(1);

  await db.transaction(async (tx) => {
    // Mark invite accepted
    await tx
      .update(petOwnerInvitesTable)
      .set({ status: "accepted", resolvedAt: new Date() })
      .where(eq(petOwnerInvitesTable.id, id));

    // Create co-owner row
    await tx
      .insert(petOwnersTable)
      .values({
        petId:     invite.petId,
        userId,
        role:      "co",
        invitedBy: invite.inviterId,
      })
      .onConflictDoNothing(); // idempotent guard

    // Audit: accept
    await writeAudit(tx, userId, "co_owner.accepted", "pet", invite.petId, {
      inviteId:       id,
      inviterUsername: inviter?.username ?? invite.inviterId,
    });
  });

  res.json({ ok: true, petId: invite.petId });
});

// ─── POST /co-owner-invites/:id/decline ──────────────────────────────────────
// Invitee declines: marks invite declined + audit.
router.post("/co-owner-invites/:id/decline", async (req, res) => {
  const { id } = req.params;
  const userId = (req as any).auth.userId as string;

  const [invite] = await db
    .select()
    .from(petOwnerInvitesTable)
    .where(eq(petOwnerInvitesTable.id, id))
    .limit(1);

  if (!invite)                      { res.status(404).json({ error: "Invite not found" }); return; }
  if (invite.inviteeId !== userId)  { res.status(403).json({ error: "Forbidden" }); return; }
  if (invite.status !== "pending")  { res.status(409).json({ error: "Invite already resolved" }); return; }

  await db.transaction(async (tx) => {
    await tx
      .update(petOwnerInvitesTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(eq(petOwnerInvitesTable.id, id));

    await writeAudit(tx, userId, "co_owner.declined", "pet", invite.petId, {
      inviteId: id,
    });
  });

  res.json({ ok: true });
});

// ─── DELETE /pets/:petId/co-owners/:targetUserId ──────────────────────────────
// Primary can remove any co-owner; co-owner can remove themselves ("leave").
// Primary cannot be removed via this endpoint.
router.delete("/pets/:petId/co-owners/:targetUserId", async (req, res) => {
  const { petId, targetUserId } = req.params;
  const callerId = (req as any).auth.userId as string;

  // Verify target is a co (not primary) owner
  const [targetRow] = await db
    .select({ id: petOwnersTable.id, role: petOwnersTable.role })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, targetUserId)))
    .limit(1);

  if (!targetRow) {
    res.status(404).json({ error: "Co-owner not found" });
    return;
  }
  if (targetRow.role === "primary") {
    res.status(400).json({
      error: "Cannot remove the primary owner. Transfer of primary is not supported in this release.",
    });
    return;
  }

  // Authorisation: caller must be primary owner OR be removing themselves
  const callerIsPrimary = await isPetPrimaryOwner(callerId, petId);
  const callerIsTarget  = callerId === targetUserId;

  if (!callerIsPrimary && !callerIsTarget) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(petOwnersTable)
      .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, targetUserId)));

    const action = callerIsTarget ? "co_owner.left" : "co_owner.removed";
    await writeAudit(tx, callerId, action, "pet", petId, {
      removedUserId: targetUserId,
    });
  });

  res.json({ ok: true });
});

export default router;
