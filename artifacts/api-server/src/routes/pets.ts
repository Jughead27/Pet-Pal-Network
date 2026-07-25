import { Router, type IRouter } from "express";
import {
  db,
  petsTable,
  postsTable,
  boopsTable,
  treatsTable,
  commentsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /pets/:id
 *
 * Returns a pet profile (name, species, breed, bio) and all of its posts
 * with the same FeedPost shape (reaction counts + viewer flags).
 *
 * Requires a valid Clerk session token (enforced by requireClerkAuth).
 */
router.get("/pets/:id", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Fetch the pet row first so we can 404 cleanly
  const [pet] = await db
    .select()
    .from(petsTable)
    .where(eq(petsTable.id, id));

  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const petSummary = {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? null,
  };

  // Fetch that pet's posts with reaction counts and viewer flags
  const rows = await db
    .select({
      id: postsTable.id,
      caption: postsTable.caption,
      mediaKey: postsTable.mediaKey,
      isNursery: postsTable.isNursery,
      createdAt: postsTable.createdAt,
      boopCount: sql<number>`count(distinct ${boopsTable.id})::int`,
      treatCount: sql<number>`count(distinct ${treatsTable.id})::int`,
      commentCount: sql<number>`count(distinct ${commentsTable.id})::int`,
      viewerHasBooped: sql<boolean>`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)`,
      viewerHasTreated: sql<boolean>`coalesce(bool_or(${treatsTable.userId} = ${userId}), false)`,
    })
    .from(postsTable)
    .leftJoin(boopsTable, eq(boopsTable.postId, postsTable.id))
    .leftJoin(treatsTable, eq(treatsTable.postId, postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .where(eq(postsTable.petId, id))
    .groupBy(postsTable.id)
    .orderBy(desc(postsTable.createdAt));

  const posts = rows.map((r) => ({
    id: r.id,
    caption: r.caption ?? null,
    mediaKey: r.mediaKey,
    isNursery: r.isNursery,
    createdAt: r.createdAt,
    pet: petSummary,
    boopCount: r.boopCount,
    treatCount: r.treatCount,
    commentCount: r.commentCount,
    viewerHasBooped: r.viewerHasBooped,
    viewerHasTreated: r.viewerHasTreated,
  }));

  res.json({
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? null,
    bio: pet.bio ?? null,
    posts,
  });
});

export default router;
