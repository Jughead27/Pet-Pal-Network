/**
 * deleteAccount — core account-deletion routine (tombstone pattern).
 *
 * Shared by the self-serve flow (POST /me/delete) and the admin flow
 * (POST /admin/users/:userId/delete). Applies every immediate local effect
 * in ONE transaction; the Clerk-side hard delete is intentionally NOT done
 * here — it runs after the grace period via processClerkDeletions()
 * (see lib/clerkDeletions.ts), scheduled through GET /admin/cron/purge.
 *
 * Immediate effects (all local, all in one tx):
 *   1.  Solely-owned pets       → soft-delete (deleted_at), same as DELETE /pets/:id
 *   2.  Co-owned pets           → remove this user's pet_owners row (same as the
 *                                 leave-as-owner flow); if the user is the
 *                                 denormalized pets.owner_id primary pointer,
 *                                 repoint it to a surviving co-owner first.
 *   3.  Authored posts          → keep, but null posted_by_user_id (audit-only
 *                                 attribution, never displayed).
 *   4.  Comments on posts of pets the user does NOT own → soft-delete
 *                                 (deleted_at). Comments on their own pets'
 *                                 posts remain (rendered as "Former pshpsh
 *                                 member" via users.deleted_at).
 *   5.  Unredeemed sent invites → status 'revoked'.
 *   6.  Pending co-ownership requests (either side) → declined + resolved_at.
 *   7.  Blocks (either direction) → hard-delete.
 *   8.  boops / treats / pack_follows / interest_follows → hard-delete.
 *   9.  Notifications: recipient rows hard-deleted; actor_user_id on other
 *                                 users' notifications nulled.
 *   10. users row               → tombstoned: profile fields nulled,
 *                                 deleted_at set. Row is KEPT — five surfaces
 *                                 INNER JOIN users and ~15 FKs reference it.
 *   Preserved untouched: reports, audit_log, feedback, quota_requests,
 *   invited_by attribution on other users' rows.
 *
 * Auth lockout: requireClerkAuth rejects users whose row has deleted_at set,
 * so the account is unusable immediately even though the Clerk account
 * survives until the grace period ends.
 */

import {
  db,
  usersTable,
  petsTable,
  petOwnersTable,
  postsTable,
  commentsTable,
  invitesTable,
  coOwnershipRequestsTable,
  blocksTable,
  boopsTable,
  treatsTable,
  packFollowsTable,
  interestFollowsTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, or, inArray, isNull, sql } from "drizzle-orm";
import { writeAudit } from "./writeAudit.js";

export async function deleteAccount(
  targetUserId: string,
  actorId: string,
  via: "self" | "admin",
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  let alreadyDeleted = false;
  let notFound = false;

  await db.transaction(async (tx) => {
    // ── Lock the target user row first (serializes concurrent deletions and
    //    guards the tombstone transition) ──
    const lockRes = await tx.execute(
      sql`SELECT deleted_at FROM users WHERE id = ${targetUserId} FOR UPDATE`,
    );
    const lockedRow = (lockRes.rows as { deleted_at: Date | null }[])[0];
    if (!lockedRow) { notFound = true; return; }
    if (lockedRow.deleted_at) { alreadyDeleted = true; return; }

    // ── Lock all pets the user owns, then compute the ownership map INSIDE
    //    the transaction so counts/survivors can't go stale mid-routine.
    //    Locking pets also serializes against concurrent co-owner
    //    add/remove/accept flows, which update pets or pet_owners under the
    //    same pet rows. ──
    await tx.execute(sql`
      SELECT p.id FROM pets p
      WHERE p.id IN (SELECT pet_id FROM pet_owners WHERE user_id = ${targetUserId})
      FOR UPDATE
    `);
    const ownedRows = await tx
      .select({
        petId: petOwnersTable.petId,
        ownerCount: sql<number>`(
          SELECT count(*)::int FROM pet_owners po2 WHERE po2.pet_id = pet_owners.pet_id
        )`,
        primaryOwnerId: petsTable.ownerId,
        petDeletedAt: petsTable.deletedAt,
      })
      .from(petOwnersTable)
      .innerJoin(petsTable, eq(petsTable.id, petOwnersTable.petId))
      .where(eq(petOwnersTable.userId, targetUserId));

    const ownedPetIds = ownedRows.map((r) => r.petId);
    // Solo-owned (or last remaining owner) → soft-delete the pet, like DELETE /pets/:id.
    const soloPetIds = ownedRows
      .filter((r) => r.ownerCount <= 1 && !r.petDeletedAt)
      .map((r) => r.petId);
    // Co-owned with survivors → leave-as-owner. Repoint primary pointer if needed.
    const coOwnedNeedingRepoint = ownedRows
      .filter((r) => r.ownerCount > 1 && r.primaryOwnerId === targetUserId)
      .map((r) => r.petId);
    // 1. Solo pets: soft-delete (existing pattern — purge job handles hard cleanup)
    if (soloPetIds.length > 0) {
      await tx
        .update(petsTable)
        .set({ deletedAt: new Date() })
        .where(inArray(petsTable.id, soloPetIds));
    }

    // 2. Co-owned pets: repoint denormalized primary pointer to a surviving owner
    for (const petId of coOwnedNeedingRepoint) {
      const [survivor] = await tx
        .select({ userId: petOwnersTable.userId })
        .from(petOwnersTable)
        .where(and(
          eq(petOwnersTable.petId, petId),
          sql`${petOwnersTable.userId} <> ${targetUserId}`,
        ))
        .orderBy(petOwnersTable.addedAt)
        .limit(1);
      if (survivor) {
        await tx
          .update(petsTable)
          .set({ ownerId: survivor.userId })
          .where(eq(petsTable.id, petId));
      }
    }
    // …then remove ALL of this user's ownership rows (leave-as-owner equivalent;
    // the last-owner refusal is intentionally skipped — those pets were solo-deleted above).
    await tx.delete(petOwnersTable).where(eq(petOwnersTable.userId, targetUserId));

    // 3. Authored posts: anonymize attribution (audit-only field, never displayed)
    await tx
      .update(postsTable)
      .set({ postedByUserId: null })
      .where(eq(postsTable.postedByUserId, targetUserId));

    // 4. Comments on OTHER people's pets' posts: soft-delete (existing pattern).
    //    Comments on the user's own pets' posts are kept (author renders as
    //    "Former pshpsh member").
    const notOwnPetPost = ownedPetIds.length > 0
      ? sql`${commentsTable.postId} IN (SELECT p.id FROM posts p WHERE p.pet_id NOT IN ${ownedPetIds})`
      : sql`TRUE`;
    await tx
      .update(commentsTable)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(commentsTable.userId, targetUserId),
        isNull(commentsTable.deletedAt),
        notOwnPetPost,
      ));

    // 5. Unredeemed sent invites → revoked
    await tx
      .update(invitesTable)
      .set({ status: "revoked" })
      .where(and(eq(invitesTable.inviterId, targetUserId), eq(invitesTable.status, "active")));

    // 6. Pending co-ownership requests (either side) → declined
    await tx
      .update(coOwnershipRequestsTable)
      .set({ status: "declined", resolvedAt: new Date() })
      .where(and(
        eq(coOwnershipRequestsTable.status, "pending"),
        or(
          eq(coOwnershipRequestsTable.inviterUserId, targetUserId),
          eq(coOwnershipRequestsTable.inviteeUserId, targetUserId),
        ),
      ));

    // NOTE: lib/db/src/schema/pet-owner-invites.ts is dead code — the table
    // is not exported, not used by any route, and does not exist in the
    // database (the live co-ownership model is co_ownership_requests,
    // handled in step 6). Nothing to clean up for it here.

    // 7. Blocks: hard-delete both directions
    await tx.delete(blocksTable).where(or(
      eq(blocksTable.blockerId, targetUserId),
      eq(blocksTable.blockedId, targetUserId),
    ));

    // 8. Reactions & follows: hard-delete
    await tx.delete(boopsTable).where(eq(boopsTable.userId, targetUserId));
    await tx.delete(treatsTable).where(eq(treatsTable.userId, targetUserId));
    await tx.delete(packFollowsTable).where(eq(packFollowsTable.userId, targetUserId));
    await tx.delete(interestFollowsTable).where(eq(interestFollowsTable.userId, targetUserId));

    // 9. Notifications: delete own inbox; anonymize actor on others'
    await tx.delete(notificationsTable).where(eq(notificationsTable.userId, targetUserId));
    await tx
      .update(notificationsTable)
      .set({ actorUserId: null })
      .where(eq(notificationsTable.actorUserId, targetUserId));

    // 10. Tombstone the users row
    await tx
      .update(usersTable)
      .set({
        username:     null,
        displayName:  null,
        locationCity: null,
        about:        null,
        instagram:    null,
        facebook:     null,
        linkedin:     null,
        xTwitter:     null,
        tiktok:       null,
        deletedAt:    new Date(),
      })
      .where(eq(usersTable.id, targetUserId));

    await writeAudit(tx, actorId, "user.deleted", "user", targetUserId, {
      via,
      soloPetsDeleted: soloPetIds.length,
      coOwnedPetsLeft: ownedRows.length - soloPetIds.length,
    });
  });

  if (notFound) return { ok: false, error: "User not found", status: 404 };
  if (alreadyDeleted) return { ok: false, error: "Account already deleted", status: 409 };
  return { ok: true };
}
