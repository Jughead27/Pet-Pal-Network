/**
 * Admin routes — breed-suggestions section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import {
  db,
  petsTable,
  speciesTable,
  breedsTable,
} from "@workspace/db";
import { eq, sql, and, isNull } from "drizzle-orm";
import { writeAudit } from "../../lib/writeAudit.js";

const adminRouter = Router();

// ─── Breed suggestions ────────────────────────────────────────────────────────

/**
 * GET /admin/breed-suggestions
 *
 * Returns distinct free-text breed submissions (pets where breedId IS NULL
 * and breed IS NOT NULL and speciesId IS NOT NULL), grouped by species + name
 * with a count of how many pets share each suggestion.
 *
 * NOTE: db.execute() with drizzle-orm/node-postgres returns a pg.QueryResult;
 * destructure .rows to get the bare array.
 */
type BreedSuggestionRow = {
  speciesId:   string;
  speciesName: string;
  breedName:   string;
  petCount:    number;
};

adminRouter.get("/admin/breed-suggestions", async (_req, res) => {
  const { rows } = await db.execute<BreedSuggestionRow>(sql`
    SELECT
      p.species_id     AS "speciesId",
      sp.name          AS "speciesName",
      p.breed          AS "breedName",
      COUNT(*)::int    AS "petCount"
    FROM pets p
    INNER JOIN species sp ON sp.id = p.species_id
    WHERE p.breed_id IS NULL
      AND p.breed IS NOT NULL
      AND p.species_id IS NOT NULL
    GROUP BY p.species_id, sp.name, p.breed
    ORDER BY sp.name ASC, p.breed ASC
  `);

  res.json({ suggestions: rows });
});

/**
 * POST /admin/breed-suggestions/approve
 *
 * Body: { speciesId, breedName }
 *
 * Duplicate-aware: if a breed with that name already exists for the species
 * (case-insensitive), ci-matches to the existing breed rather than creating a
 * twin. Updates all matching pets to use the canonical breedId.
 * Audit: breed.approve
 */
adminRouter.post("/admin/breed-suggestions/approve", async (req, res) => {
  const { speciesId, breedName } = req.body as {
    speciesId?: string;
    breedName?: string;
  };
  const { userId } = (req as Express.RequestWithAuth).auth!;

  if (!speciesId || !breedName?.trim()) {
    res.status(400).json({ error: "speciesId and breedName are required" });
    return;
  }

  const trimmedName = breedName.trim();

  // Verify species exists (read-only, outside transaction)
  const [species] = await db
    .select()
    .from(speciesTable)
    .where(eq(speciesTable.id, speciesId))
    .limit(1);

  if (!species) {
    res.status(400).json({ error: "Species not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Check for existing breed (case-insensitive)
    const [existing] = await tx
      .select()
      .from(breedsTable)
      .where(
        and(
          eq(breedsTable.speciesId, speciesId),
          sql`lower(${breedsTable.name}) = lower(${trimmedName})`,
        ),
      )
      .limit(1);

    let canonicalBreed = existing;

    if (!canonicalBreed) {
      const [created] = await tx
        .insert(breedsTable)
        .values({ speciesId, name: trimmedName })
        .returning();
      canonicalBreed = created;
    }

    const updated = await tx
      .update(petsTable)
      .set({ breedId: canonicalBreed.id, breed: canonicalBreed.name })
      .where(
        and(
          eq(petsTable.speciesId, speciesId),
          isNull(petsTable.breedId),
          sql`lower(${petsTable.breed}) = lower(${trimmedName})`,
        ),
      )
      .returning({ id: petsTable.id });

    await writeAudit(tx, userId, "breed.approve", "breed", canonicalBreed.id, {
      speciesId,
      speciesName:  species.name,
      breedName:    canonicalBreed.name,
      created:      !existing,
      petsUpdated:  updated.length,
    });

    return { canonicalBreed, created: !existing, petsUpdated: updated.length };
  });

  res.json({
    ok:          true,
    breed:       { id: result.canonicalBreed.id, name: result.canonicalBreed.name, speciesId },
    created:     result.created,
    petsUpdated: result.petsUpdated,
  });
});

/**
 * POST /admin/breed-suggestions/reject
 *
 * Body: { speciesId, breedName }
 *
 * Clears the free-text breed from all matching pets (sets breed = null).
 * The pet owner can re-enter a breed if they wish.
 * Audit: breed.reject
 */
adminRouter.post("/admin/breed-suggestions/reject", async (req, res) => {
  const { speciesId, breedName } = req.body as {
    speciesId?: string;
    breedName?: string;
  };
  const { userId } = (req as Express.RequestWithAuth).auth!;

  if (!speciesId || !breedName?.trim()) {
    res.status(400).json({ error: "speciesId and breedName are required" });
    return;
  }

  const trimmedName = breedName.trim();

  const petsUpdated = await db.transaction(async (tx) => {
    const updated = await tx
      .update(petsTable)
      .set({ breed: null })
      .where(
        and(
          eq(petsTable.speciesId, speciesId),
          isNull(petsTable.breedId),
          sql`lower(${petsTable.breed}) = lower(${trimmedName})`,
        ),
      )
      .returning({ id: petsTable.id });

    await writeAudit(tx, userId, "breed.reject", null, null, {
      speciesId,
      breedName:   trimmedName,
      petsUpdated: updated.length,
    });

    return updated.length;
  });

  res.json({ ok: true, petsUpdated });
});

export default adminRouter;
