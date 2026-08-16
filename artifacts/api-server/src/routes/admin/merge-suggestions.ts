/**
 * Admin routes — merge-suggestions section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import {
  db,
  usersTable,
  petsTable,
  mergeSuggestionsTable,
} from "@workspace/db";
import { alias } from "drizzle-orm/pg-core";
import { eq, asc, sql, and, isNull } from "drizzle-orm";
import { writeAudit } from "../../lib/writeAudit.js";

const adminRouter = Router();

// ─── Merge suggestions ────────────────────────────────────────────────────────

/**
 * GET /admin/merge-suggestions
 *
 * Pending user-submitted "same pet" suggestions, oldest first. Joins both
 * pets and their primary owners so the queue card can show them side by side.
 * Returns: { suggestions }
 */
adminRouter.get("/admin/merge-suggestions", async (_req, res) => {
  const suggesterPet   = alias(petsTable, "suggester_pet");
  const targetPet      = alias(petsTable, "target_pet");
  const suggesterUser  = alias(usersTable, "suggester_user");
  const targetOwner    = alias(usersTable, "target_owner");

  const suggestions = await db
    .select({
      id:                 mergeSuggestionsTable.id,
      createdAt:          mergeSuggestionsTable.createdAt,
      suggesterUserId:    mergeSuggestionsTable.suggesterUserId,
      suggesterUsername:  suggesterUser.username,
      suggesterPetId:     mergeSuggestionsTable.suggesterPetId,
      suggesterPetName:   suggesterPet.name,
      suggesterPetSpecies: suggesterPet.species,
      suggesterPetBreed:  suggesterPet.breed,
      targetPetId:        mergeSuggestionsTable.targetPetId,
      targetPetName:      targetPet.name,
      targetPetSpecies:   targetPet.species,
      targetPetBreed:     targetPet.breed,
      targetOwnerId:      targetPet.ownerId,
      targetOwnerUsername: targetOwner.username,
      // Per-pet counts so the admin confirm step can show "X posts, Y
      // followers, Z co-owners will move" before committing. Columns are
      // hand-qualified via the alias tables (drizzle sql`` interpolation
      // renders them qualified because alias tables carry their alias name).
      suggesterPetPosts:     sql<number>`(select count(*) from post_pets pp where pp.pet_id = ${suggesterPet.id})::int`,
      suggesterPetFollowers: sql<number>`(select count(*) from pack_follows pf where pf.pet_id = ${suggesterPet.id})::int`,
      suggesterPetOwners:    sql<number>`(select count(*) from pet_owners po where po.pet_id = ${suggesterPet.id})::int`,
      targetPetPosts:        sql<number>`(select count(*) from post_pets pp where pp.pet_id = ${targetPet.id})::int`,
      targetPetFollowers:    sql<number>`(select count(*) from pack_follows pf where pf.pet_id = ${targetPet.id})::int`,
      targetPetOwners:       sql<number>`(select count(*) from pet_owners po where po.pet_id = ${targetPet.id})::int`,
    })
    .from(mergeSuggestionsTable)
    .innerJoin(suggesterPet,  eq(suggesterPet.id, mergeSuggestionsTable.suggesterPetId))
    .innerJoin(targetPet,     eq(targetPet.id, mergeSuggestionsTable.targetPetId))
    .innerJoin(suggesterUser, eq(suggesterUser.id, mergeSuggestionsTable.suggesterUserId))
    .innerJoin(targetOwner,   eq(targetOwner.id, targetPet.ownerId))
    .where(eq(mergeSuggestionsTable.status, "pending"))
    .orderBy(asc(mergeSuggestionsTable.createdAt));

  res.json({ suggestions });
});

/**
 * POST /admin/merge-suggestions/:id/dismiss
 *
 * Marks a pending suggestion dismissed. Audit: merge_suggestion.dismiss
 */
adminRouter.post("/admin/merge-suggestions/:id/dismiss", async (req, res) => {
  const { id } = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(mergeSuggestionsTable)
      .set({ status: "dismissed" })
      .where(and(eq(mergeSuggestionsTable.id, id), eq(mergeSuggestionsTable.status, "pending")))
      .returning({ id: mergeSuggestionsTable.id });
    if (rows.length === 0) return false;

    await writeAudit(tx, userId, "merge_suggestion.dismiss", "merge_suggestion", id, {});
    return true;
  });

  if (!updated) {
    res.status(404).json({ error: "suggestion not found or already handled" });
    return;
  }
  res.json({ ok: true });
});

/**
 * POST /admin/merge-suggestions/:id/merge
 *
 * The REAL merge. Body: { survivorPetId, mergedPetId } — must be exactly the
 * suggestion's two pets (either orientation; the admin chooses which
 * survives). Single transaction, all-or-nothing:
 *
 *   a. Re-tag post_pets from merged → survivor (dropping rows where the post
 *      is already tagged with the survivor, so no duplicate tags).
 *   b. Reassign posts.pet_id (primary) from merged → survivor. Destination is
 *      explicit, so a direct UPDATE — no earliest-tagged ambiguity (the
 *      reassignPrimaryPetOnDeletion helper is for the no-explicit-destination
 *      deletion path and is intentionally NOT used here).
 *   c. Move pack_follows with insert-then-delete dedupe.
 *   d. Move pet_owners with insert-then-delete dedupe (existing survivor
 *      ownership rows untouched — ownership is symmetric, no roles to clash).
 *   e. Soft-delete the merged pet (deleted_at flip, same mechanism as
 *      DELETE /pets/:id — never hard-delete).
 *   f. Suggestion → actioned + audit entry with moved counts.
 *
 * Boops/treats live on posts (post_id only), so they follow the posts
 * automatically — verified against the schema; no direct changes needed.
 *
 * Returns: { ok, moved: { postsRetagged, primaryReassigned, followersMoved, coOwnersMoved } }
 * Audit: merge_suggestion.merge
 */
adminRouter.post("/admin/merge-suggestions/:id/merge", async (req, res) => {
  const { id } = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;
  const { survivorPetId, mergedPetId } = req.body as {
    survivorPetId?: unknown;
    mergedPetId?: unknown;
  };

  if (typeof survivorPetId !== "string" || typeof mergedPetId !== "string") {
    res.status(400).json({ error: "survivorPetId and mergedPetId are required" });
    return;
  }
  if (survivorPetId === mergedPetId) {
    res.status(400).json({ error: "survivor and merged pet must differ" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    // Lock the suggestion row so a concurrent dismiss/merge can't race.
    const [suggestion] = await tx
      .select({
        id:             mergeSuggestionsTable.id,
        suggesterPetId: mergeSuggestionsTable.suggesterPetId,
        targetPetId:    mergeSuggestionsTable.targetPetId,
        status:         mergeSuggestionsTable.status,
      })
      .from(mergeSuggestionsTable)
      .where(eq(mergeSuggestionsTable.id, id))
      .for("update");

    if (!suggestion || suggestion.status !== "pending") {
      return { status: 404 as const, error: "suggestion not found or already handled" };
    }

    // The chosen pair must be exactly the suggestion's two pets (either way).
    const pair = new Set([suggestion.suggesterPetId, suggestion.targetPetId]);
    if (!pair.has(survivorPetId) || !pair.has(mergedPetId)) {
      return { status: 400 as const, error: "pets do not match this suggestion" };
    }

    // Both pets must still be live. Lock them for the duration of the tx so a
    // concurrent DELETE /pets/:id can't soft-delete one mid-merge.
    const petRows = await tx
      .select({ id: petsTable.id, deletedAt: petsTable.deletedAt, name: petsTable.name })
      .from(petsTable)
      .where(sql`${petsTable.id} in (${survivorPetId}, ${mergedPetId})`)
      .for("update");
    const survivorRow = petRows.find((p) => p.id === survivorPetId);
    const mergedRow   = petRows.find((p) => p.id === mergedPetId);
    if (!survivorRow || survivorRow.deletedAt || !mergedRow || mergedRow.deletedAt) {
      return { status: 409 as const, error: "one of the pets has been deleted" };
    }

    // (a) Re-tag posts: drop merged-pet tags on posts already tagged with the
    // survivor (would violate the unique (post_id, pet_id) index), then move
    // the rest.
    await tx.execute(sql`
      DELETE FROM post_pets mp
      WHERE mp.pet_id = ${mergedPetId}
        AND EXISTS (
          SELECT 1 FROM post_pets sp
          WHERE sp.post_id = mp.post_id AND sp.pet_id = ${survivorPetId}
        )
    `);
    const retagged = await tx.execute(sql`
      UPDATE post_pets SET pet_id = ${survivorPetId}
      WHERE pet_id = ${mergedPetId}
      RETURNING id
    `);
    const postsRetagged = retagged.rows.length;

    // (b) Primary pointer: explicit destination, direct UPDATE.
    const primary = await tx.execute(sql`
      UPDATE posts SET pet_id = ${survivorPetId}
      WHERE pet_id = ${mergedPetId}
      RETURNING id
    `);
    const primaryReassigned = primary.rows.length;

    // (c) Followers: copy with dedupe, then remove the old rows.
    const follows = await tx.execute(sql`
      INSERT INTO pack_follows (user_id, pet_id)
      SELECT pf.user_id, ${survivorPetId} FROM pack_follows pf
      WHERE pf.pet_id = ${mergedPetId}
      ON CONFLICT ON CONSTRAINT pack_follows_user_pet_uniq DO NOTHING
      RETURNING user_id
    `);
    const followersMoved = follows.rows.length;
    await tx.execute(sql`DELETE FROM pack_follows WHERE pet_id = ${mergedPetId}`);

    // (d) Owners/co-owners: same copy-with-dedupe. Ownership is symmetric
    // (no roles), so an existing survivor row is simply kept as-is.
    const owners = await tx.execute(sql`
      INSERT INTO pet_owners (pet_id, user_id)
      SELECT ${survivorPetId}, po.user_id FROM pet_owners po
      WHERE po.pet_id = ${mergedPetId}
      ON CONFLICT ON CONSTRAINT pet_owners_pet_user_uniq DO NOTHING
      RETURNING user_id
    `);
    const coOwnersMoved = owners.rows.length;
    await tx.execute(sql`DELETE FROM pet_owners WHERE pet_id = ${mergedPetId}`);

    // (e) Soft-delete the merged pet — same deleted_at flip as DELETE
    // /pets/:id. Conditional on still-live so the count is honest.
    const flipped = await tx
      .update(petsTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(petsTable.id, mergedPetId), isNull(petsTable.deletedAt)))
      .returning({ id: petsTable.id });
    if (flipped.length === 0) {
      // Row was locked above, so this should be impossible — abort loudly.
      throw new Error("merged pet vanished mid-transaction");
    }

    // (f) Resolve the suggestion + audit (audit is always the LAST write).
    await tx
      .update(mergeSuggestionsTable)
      .set({ status: "actioned" })
      .where(eq(mergeSuggestionsTable.id, id));

    const moved = { postsRetagged, primaryReassigned, followersMoved, coOwnersMoved };
    await writeAudit(tx, userId, "merge_suggestion.merge", "merge_suggestion", id, {
      survivorPetId,
      mergedPetId,
      survivorPetName: survivorRow.name,
      mergedPetName:   mergedRow.name,
      ...moved,
    });

    return { status: 200 as const, moved };
  });

  if (outcome.status !== 200) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.json({ ok: true, moved: outcome.moved });
});

export default adminRouter;
