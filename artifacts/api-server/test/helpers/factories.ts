/**
 * Test-data factories — minimal valid rows, inserted through the SAME
 * transaction-scoped connection as everything else (see harness.ts), so they
 * roll back with the test. Self-contained: no dependency on seed data, all
 * identifiers randomized so tests are order-independent and can run in
 * parallel workers without unique-constraint collisions.
 */
import { randomUUID } from "node:crypto";
import {
  db,
  usersTable,
  petsTable,
  petOwnersTable,
  postsTable,
  postPetsTable,
  packFollowsTable,
  boopsTable,
  blocksTable,
  commentsTable,
  mergeSuggestionsTable,
} from "@workspace/db";

function rand(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function createTestUser(overrides: Partial<{
  role: "member" | "admin";
  suspended: boolean;
  deletedAt: Date;
  username: string;
}> = {}): Promise<{ id: string; username: string }> {
  const id = `test_${rand()}`;
  const username = overrides.username ?? `t_${rand()}`;
  await db.insert(usersTable).values({
    id,
    username,
    role: overrides.role ?? "member",
    suspended: overrides.suspended ?? false,
    deletedAt: overrides.deletedAt ?? null,
  });
  return { id, username };
}

/** Creates a live pet + its pet_owners row (the app invariant). */
export async function createTestPet(
  ownerId: string,
  overrides: Partial<{ name: string; species: string; deletedAt: Date }> = {},
): Promise<{ id: string; name: string }> {
  const name = overrides.name ?? `pet_${rand()}`;
  const [pet] = await db.insert(petsTable).values({
    ownerId,
    name,
    species: overrides.species ?? "dog",
    deletedAt: overrides.deletedAt ?? null,
  }).returning({ id: petsTable.id });
  await db.insert(petOwnersTable).values({ petId: pet.id, userId: ownerId });
  return { id: pet.id, name };
}

export async function addCoOwner(petId: string, userId: string, addedAt?: Date): Promise<void> {
  await db.insert(petOwnersTable).values({
    petId,
    userId,
    ...(addedAt ? { addedAt } : {}),
  });
}

/** Creates a post with post_pets tags (petIds[0] is the primary pet). */
export async function createTestPost(
  taggedByUserId: string,
  petIds: string[],
  overrides: Partial<{
    caption: string;
    isNursery: boolean;
    archivedAt: Date;
    hiddenByAdmin: boolean;
    createdAt: Date;
  }> = {},
): Promise<{ id: string }> {
  const [post] = await db.insert(postsTable).values({
    petId: petIds[0],
    mediaKey: `posts/test/${rand()}.jpg`,
    caption: overrides.caption ?? null,
    isNursery: overrides.isNursery ?? false,
    archivedAt: overrides.archivedAt ?? null,
    hiddenByAdmin: overrides.hiddenByAdmin ?? false,
    postedByUserId: taggedByUserId,
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  }).returning({ id: postsTable.id });
  for (const petId of petIds) {
    await db.insert(postPetsTable).values({
      postId: post.id,
      petId,
      taggedByUserId,
    });
  }
  return { id: post.id };
}

export async function createBoop(postId: string, userId: string): Promise<void> {
  await db.insert(boopsTable).values({ postId, userId });
}

export async function createBlock(blockerId: string, blockedId: string): Promise<void> {
  await db.insert(blocksTable).values({ blockerId, blockedId });
}

export async function createComment(postId: string, userId: string, text = "hi"): Promise<void> {
  await db.insert(commentsTable).values({ postId, userId, text });
}

export async function createPackFollow(userId: string, petId: string): Promise<void> {
  await db.insert(packFollowsTable).values({ userId, petId });
}

export async function createMergeSuggestion(
  suggesterUserId: string,
  suggesterPetId: string,
  targetPetId: string,
): Promise<{ id: string }> {
  const [row] = await db.insert(mergeSuggestionsTable).values({
    suggesterUserId,
    suggesterPetId,
    targetPetId,
  }).returning({ id: mergeSuggestionsTable.id });
  return { id: row.id };
}
