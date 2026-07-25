import { Router, type IRouter } from "express";
import { db, speciesTable, breedsTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /species
 *
 * Returns all species ordered by sort_order, each with a breedCount.
 * Auth-gated (requireClerkAuth applied in the main app before mounting).
 */
router.get("/species", async (_req, res) => {
  const rows = await db
    .select({
      id:         speciesTable.id,
      name:       speciesTable.name,
      sortOrder:  speciesTable.sortOrder,
      breedCount: sql<number>`count(${breedsTable.id})::int`,
    })
    .from(speciesTable)
    .leftJoin(breedsTable, eq(breedsTable.speciesId, speciesTable.id))
    .groupBy(speciesTable.id)
    .orderBy(asc(speciesTable.sortOrder));

  res.json({ species: rows });
});

/**
 * GET /species/:id/breeds
 *
 * Returns all breeds for the given species, ordered alphabetically.
 * Auth-gated. Returns 404 if the species ID is unknown.
 */
router.get("/species/:id/breeds", async (req, res) => {
  const { id } = req.params;

  // Verify species exists
  const [species] = await db
    .select()
    .from(speciesTable)
    .where(eq(speciesTable.id, id))
    .limit(1);

  if (!species) {
    res.status(404).json({ error: "Species not found" });
    return;
  }

  const breeds = await db
    .select({
      id:        breedsTable.id,
      speciesId: breedsTable.speciesId,
      name:      breedsTable.name,
    })
    .from(breedsTable)
    .where(eq(breedsTable.speciesId, id))
    .orderBy(asc(breedsTable.name));

  res.json({ breeds });
});

export default router;
