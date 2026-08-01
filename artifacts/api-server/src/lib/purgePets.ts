/**
 * purgePets — hard-delete pets that have been soft-deleted for > 30 days.
 *
 * ─── TRIGGER MECHANISM ────────────────────────────────────────────────────────
 * No job scheduler exists in this project.  Plug purgeSoftDeletedPets() into
 * your preferred cron provider:
 *
 *   • Render (Cron Job service): create a GET /admin/cron/purge-pets route
 *     guarded by a shared secret header and call this function inside it.
 *     Set the schedule to "0 3 * * *" (03:00 UTC daily).
 *
 *   • Vercel: create api/cron/purge-pets.ts and add a vercel.json crons entry:
 *       { "path": "/api/cron/purge-pets", "schedule": "0 3 * * *" }
 *
 *   • Self-hosted: add node-cron ("0 3 * * *") inside the API server process and
 *     call purgeSoftDeletedPets() from the callback.
 *
 * The function is idempotent — only rows with deletedAt < now()-30 days are
 * touched, so running it multiple times per day is safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  db,
  petsTable,
  postsTable,
  boopsTable,
  treatsTable,
  commentsTable,
  packFollowsTable,
  petOwnersTable,
  petOwnerInvitesTable,
} from "@workspace/db";
import { and, inArray, isNotNull, lt } from "drizzle-orm";
import { deleteObject } from "./r2.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export async function purgeSoftDeletedPets(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  // 1. Find pets that passed the grace period
  const expiredPets = await db
    .select({ id: petsTable.id, avatarKey: petsTable.avatarKey })
    .from(petsTable)
    .where(and(isNotNull(petsTable.deletedAt), lt(petsTable.deletedAt, cutoff)));

  if (expiredPets.length === 0) return { purged: 0 };

  const petIds = expiredPets.map((p) => p.id);

  // 2. Collect post media keys for R2 cleanup (before we delete post rows)
  const postRows = await db
    .select({ id: postsTable.id, mediaKey: postsTable.mediaKey })
    .from(postsTable)
    .where(inArray(postsTable.petId, petIds));

  const postIds = postRows.map((p) => p.id);

  // 3. Hard-delete in FK-safe order inside a single transaction
  await db.transaction(async (tx) => {
    // Reactions + comments on affected posts
    if (postIds.length > 0) {
      await tx.delete(commentsTable).where(inArray(commentsTable.postId, postIds));
      await tx.delete(boopsTable).where(inArray(boopsTable.postId, postIds));
      await tx.delete(treatsTable).where(inArray(treatsTable.postId, postIds));
    }

    // Posts (references petsTable.id via pet_id FK)
    await tx.delete(postsTable).where(inArray(postsTable.petId, petIds));

    // Pack follows, invites, ownership (all reference petsTable.id)
    await tx.delete(packFollowsTable).where(inArray(packFollowsTable.petId, petIds));
    await tx.delete(petOwnerInvitesTable).where(inArray(petOwnerInvitesTable.petId, petIds));
    await tx.delete(petOwnersTable).where(inArray(petOwnersTable.petId, petIds));

    // Pet rows
    await tx.delete(petsTable).where(inArray(petsTable.id, petIds));
  });

  // 4. Best-effort R2 cleanup after the transaction (DB stays clean on R2 failure)
  //    Skip seed keys — they live in bundled assets, not R2.
  const r2Keys: string[] = [
    ...postRows
      .filter((p) => !p.mediaKey.startsWith("seed:"))
      .map((p) => p.mediaKey),
    ...expiredPets
      .filter((p) => p.avatarKey && !p.avatarKey.startsWith("seed:"))
      .map((p) => p.avatarKey as string),
  ];

  await Promise.allSettled(r2Keys.map((key) => deleteObject(key)));

  return { purged: expiredPets.length };
}
