/**
 * Centralized pet-ownership helpers.
 *
 * DESIGN RULE: use these everywhere instead of inline `pet.ownerId === userId`
 * comparisons.  Ownership is fully symmetric — any member of pet_owners for a
 * pet has equal rights.  There is no role distinction.
 */

import { and, eq } from "drizzle-orm";
import { db, petOwnersTable } from "@workspace/db";

/**
 * Returns true when userId is any owner of petId.
 * Use for: posting as a pet, editing metadata, setting avatar, viewing
 * archived posts, inviting co-owners, managing any post on the pet.
 */
export async function isPetOwner(userId: string, petId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: petOwnersTable.id })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Returns the ownership row for (userId, petId), or null.
 * Use when you need both the membership check and the row ID in one query.
 */
export async function getPetOwnerRow(
  userId: string,
  petId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: petOwnersTable.id })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, userId)))
    .limit(1);
  return row ?? null;
}
