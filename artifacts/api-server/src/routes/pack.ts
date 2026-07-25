import { Router, type IRouter } from "express";
import { db, petsTable, packFollowsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * POST /pets/:id/pack
 *
 * Idempotent pack join — inserting a row that already exists is a no-op.
 * Returns the current pack count and viewer state after the operation.
 */
router.post("/pets/:id/pack", async (req, res) => {
  const { id: petId } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Verify pet exists
  const [pet] = await db.select({ id: petsTable.id }).from(petsTable).where(eq(petsTable.id, petId));
  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Idempotent insert — duplicate (userId, petId) pair is silently ignored
  await db
    .insert(packFollowsTable)
    .values({ userId, petId })
    .onConflictDoNothing();

  const [{ packCount }] = await db
    .select({ packCount: sql<number>`count(*)::int` })
    .from(packFollowsTable)
    .where(eq(packFollowsTable.petId, petId));

  res.json({ packCount, viewerInPack: true });
});

/**
 * DELETE /pets/:id/pack
 *
 * Idempotent pack leave — deleting a row that doesn't exist is a no-op.
 * Returns the current pack count and viewer state after the operation.
 */
router.delete("/pets/:id/pack", async (req, res) => {
  const { id: petId } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Verify pet exists
  const [pet] = await db.select({ id: petsTable.id }).from(petsTable).where(eq(petsTable.id, petId));
  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .delete(packFollowsTable)
    .where(and(eq(packFollowsTable.userId, userId), eq(packFollowsTable.petId, petId)));

  const [{ packCount }] = await db
    .select({ packCount: sql<number>`count(*)::int` })
    .from(packFollowsTable)
    .where(eq(packFollowsTable.petId, petId));

  res.json({ packCount, viewerInPack: false });
});

export default router;
