/**
 * Centralized pet-ownership helpers.
 *
 * DESIGN RULE: use these everywhere instead of inline `pet.ownerId === userId`
 * comparisons.  With co-ownership, "owner" means any member of pet_owners for
 * that pet — not just the primary.
 */

import { and, eq } from "drizzle-orm";
import { db, petOwnersTable } from "@workspace/db";

/**
 * Returns true when userId is any owner (primary or co) of petId.
 * This is the check to use for: posting as a pet, editing metadata, setting
 * the avatar, viewing archived posts.
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
 * Returns true only when userId holds the 'primary' role for petId.
 * Use for: inviting co-owners, removing co-owners, deleting the pet,
 * managing posts that the caller did not personally create.
 */
export async function isPetPrimaryOwner(userId: string, petId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: petOwnersTable.id })
    .from(petOwnersTable)
    .where(
      and(
        eq(petOwnersTable.petId, petId),
        eq(petOwnersTable.userId, userId),
        eq(petOwnersTable.role, "primary"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Returns the full ownership row for (userId, petId), or null.
 * Use when you need both the membership check and the role in one query.
 */
export async function getPetOwnerRow(
  userId: string,
  petId: string,
): Promise<{ id: string; role: "primary" | "co" } | null> {
  const [row] = await db
    .select({ id: petOwnersTable.id, role: petOwnersTable.role })
    .from(petOwnersTable)
    .where(and(eq(petOwnersTable.petId, petId), eq(petOwnersTable.userId, userId)))
    .limit(1);
  return row ?? null;
}
