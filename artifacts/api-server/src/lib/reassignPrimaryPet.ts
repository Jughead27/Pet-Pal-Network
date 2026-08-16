/**
 * reassignPrimaryPetOnDeletion — shared by DELETE /pets/:id (routes/pets.ts)
 * and account deletion's solo-pet cleanup (lib/deleteAccount.ts).
 *
 * Multi-pet posts: if the deleted pet was the PRIMARY pet (posts.pet_id) on a
 * post that has at least one other LIVING tagged pet, reassign posts.pet_id to
 * the earliest-tagged surviving pet (post_pets.created_at ASC, id tie-break)
 * so the post survives. Posts with no surviving tagged pet are untouched and
 * drop out of public reads via the activePets filters, as before.
 *
 * MUST be called AFTER the pet's soft-delete flip, inside the SAME
 * transaction: the tx sees its own write, so `pt.deleted_at IS NULL` can never
 * pick the pet being deleted as its own successor, and no window exists where
 * a post's primary points at a deleted pet.
 */

import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function reassignPrimaryPetOnDeletion(tx: Tx, petId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE posts SET pet_id = (
      SELECT pp.pet_id FROM post_pets pp
      JOIN pets pt ON pt.id = pp.pet_id
      WHERE pp.post_id = posts.id
        AND pp.pet_id <> ${petId}
        AND pt.deleted_at IS NULL
      ORDER BY pp.created_at ASC, pp.id ASC
      LIMIT 1
    )
    WHERE posts.pet_id = ${petId}
      AND EXISTS (
        SELECT 1 FROM post_pets pp2
        JOIN pets pt2 ON pt2.id = pp2.pet_id
        WHERE pp2.post_id = posts.id
          AND pp2.pet_id <> ${petId}
          AND pt2.deleted_at IS NULL
      )
  `);
}
