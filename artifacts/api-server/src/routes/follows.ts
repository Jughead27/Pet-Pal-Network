/**
 * Interest follows — species & breed follow/unfollow endpoints + follow graph.
 *
 * All mutation endpoints are idempotent:
 *   POST   /follows/species/:id   — follow a species   (ON CONFLICT DO NOTHING)
 *   DELETE /follows/species/:id   — unfollow a species
 *   POST   /follows/breeds/:id    — follow a breed     (ON CONFLICT DO NOTHING)
 *   DELETE /follows/breeds/:id    — unfollow a breed
 *
 *   GET    /me/follows            — caller's full follow graph:
 *                                   packedPets + followedSpecies + followedBreeds
 *
 * Auth-gated: requireClerkAuth is applied globally before mounting this router.
 */

import { Router, type IRouter } from "express";
import { db, interestFollowsTable, packFollowsTable, petsTable, postsTable, speciesTable, breedsTable } from "@workspace/db";
import { eq, and, sql, asc, desc } from "drizzle-orm";
import { activePets } from "../lib/petQueries.js";
import { mediaTokenUrl } from "../lib/r2.js";

const router: IRouter = Router();

/** Helper to extract userId from req.auth (typed cast used throughout the API). */
function getAuth(req: Express.Request): string {
  return (req as unknown as { auth: { userId: string } }).auth.userId;
}

// ─── POST /follows/species/:id ────────────────────────────────────────────────

router.post("/follows/species/:id", async (req, res) => {
  const userId    = getAuth(req);
  const speciesId = req.params.id;

  // Verify species exists
  const [species] = await db
    .select({ id: speciesTable.id })
    .from(speciesTable)
    .where(eq(speciesTable.id, speciesId))
    .limit(1);

  if (!species) {
    res.status(404).json({ error: "Species not found" });
    return;
  }

  await db
    .insert(interestFollowsTable)
    .values({ userId, speciesId })
    .onConflictDoNothing();

  res.json({ viewerFollows: true });
});

// ─── DELETE /follows/species/:id ──────────────────────────────────────────────

router.delete("/follows/species/:id", async (req, res) => {
  const userId    = getAuth(req);
  const speciesId = req.params.id;

  await db
    .delete(interestFollowsTable)
    .where(
      and(
        eq(interestFollowsTable.userId,    userId),
        eq(interestFollowsTable.speciesId, speciesId),
      ),
    );

  res.json({ viewerFollows: false });
});

// ─── POST /follows/breeds/:id ─────────────────────────────────────────────────

router.post("/follows/breeds/:id", async (req, res) => {
  const userId  = getAuth(req);
  const breedId = req.params.id;

  // Verify breed exists
  const [breed] = await db
    .select({ id: breedsTable.id })
    .from(breedsTable)
    .where(eq(breedsTable.id, breedId))
    .limit(1);

  if (!breed) {
    res.status(404).json({ error: "Breed not found" });
    return;
  }

  await db
    .insert(interestFollowsTable)
    .values({ userId, breedId })
    .onConflictDoNothing();

  res.json({ viewerFollows: true });
});

// ─── DELETE /follows/breeds/:id ───────────────────────────────────────────────

router.delete("/follows/breeds/:id", async (req, res) => {
  const userId  = getAuth(req);
  const breedId = req.params.id;

  await db
    .delete(interestFollowsTable)
    .where(
      and(
        eq(interestFollowsTable.userId,   userId),
        eq(interestFollowsTable.breedId,  breedId),
      ),
    );

  res.json({ viewerFollows: false });
});

// ─── GET /me/follows ──────────────────────────────────────────────────────────

router.get("/me/follows", async (req, res) => {
  const userId = getAuth(req);

  // Run all three sub-queries in parallel
  const [packedPetsRows, followedSpeciesRows, followedBreedsRows] = await Promise.all([
    // Packed pets: pack_follows → pets
    db
      .select({
        id:             petsTable.id,
        name:           petsTable.name,
        species:        petsTable.species,
        breed:          petsTable.breed,
        speciesId:      petsTable.speciesId,
        breedId:        petsTable.breedId,
        avatarKey:      petsTable.avatarKey,
        // Correlated subquery: most recent non-archived post media key (fallback thumbnail).
        recentMediaKey: sql<string | null>`(
          SELECT ${postsTable.mediaKey}
          FROM   ${postsTable}
          WHERE  ${postsTable.petId} = ${petsTable.id}
            AND  ${postsTable.archivedAt} IS NULL
          ORDER  BY ${postsTable.createdAt} DESC
          LIMIT  1
        )`,
      })
      .from(packFollowsTable)
      .innerJoin(petsTable, eq(petsTable.id, packFollowsTable.petId))
      .where(and(eq(packFollowsTable.userId, userId), activePets))
      // Most recently followed first — the profile "My Pack" section shows the
      // 3 most recent by default with the rest behind a "show all" toggle.
      .orderBy(desc(packFollowsTable.createdAt)),

    // Followed species: interest_follows → species WHERE speciesId IS NOT NULL
    db
      .select({
        id:   speciesTable.id,
        name: speciesTable.name,
      })
      .from(interestFollowsTable)
      .innerJoin(speciesTable, eq(speciesTable.id, interestFollowsTable.speciesId))
      .where(
        and(
          eq(interestFollowsTable.userId, userId),
          sql`${interestFollowsTable.speciesId} IS NOT NULL`,
        ),
      )
      .orderBy(asc(speciesTable.name)),

    // Followed breeds: interest_follows → breeds → species WHERE breedId IS NOT NULL
    db
      .select({
        id:          breedsTable.id,
        name:        breedsTable.name,
        speciesId:   breedsTable.speciesId,
        speciesName: speciesTable.name,
      })
      .from(interestFollowsTable)
      .innerJoin(breedsTable,  eq(breedsTable.id,        interestFollowsTable.breedId))
      .innerJoin(speciesTable, eq(speciesTable.id,        breedsTable.speciesId))
      .where(
        and(
          eq(interestFollowsTable.userId, userId),
          sql`${interestFollowsTable.breedId} IS NOT NULL`,
        ),
      )
      .orderBy(asc(breedsTable.name)),
  ]);

  res.json({
    packedPets: packedPetsRows.map((p) => {
      // Thumbnail prefers the avatar; falls back to most recent non-archived post.
      const avatarUrl = p.avatarKey ? mediaTokenUrl(p.avatarKey) : null;
      const thumbnailUrl = avatarUrl
        ?? (p.recentMediaKey ? mediaTokenUrl(p.recentMediaKey) : null);
      return {
        id:           p.id,
        name:         p.name,
        species:      p.species,
        breed:        p.breed     ?? null,
        speciesId:    p.speciesId ?? null,
        breedId:      p.breedId   ?? null,
        thumbnailUrl,
      };
    }),
    followedSpecies: followedSpeciesRows,
    followedBreeds:  followedBreedsRows,
  });
});

export default router;
