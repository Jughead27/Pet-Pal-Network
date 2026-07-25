import { Router, type IRouter } from "express";
import { db, postsTable, petsTable, boopsTable, treatsTable, commentsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /feed
 *
 * Returns all posts in reverse-chronological order, each with embedded pet
 * info and aggregate reaction counts.  Requires a valid Clerk session token
 * (enforced by requireClerkAuth in routes/index.ts).
 */
router.get("/feed", async (_req, res) => {
  const rows = await db
    .select({
      id: postsTable.id,
      caption: postsTable.caption,
      mediaKey: postsTable.mediaKey,
      isNursery: postsTable.isNursery,
      createdAt: postsTable.createdAt,
      petId: petsTable.id,
      petName: petsTable.name,
      petSpecies: petsTable.species,
      petBreed: petsTable.breed,
      boopCount: sql<number>`count(distinct ${boopsTable.id})::int`,
      treatCount: sql<number>`count(distinct ${treatsTable.id})::int`,
      commentCount: sql<number>`count(distinct ${commentsTable.id})::int`,
    })
    .from(postsTable)
    .innerJoin(petsTable, eq(petsTable.id, postsTable.petId))
    .leftJoin(boopsTable, eq(boopsTable.postId, postsTable.id))
    .leftJoin(treatsTable, eq(treatsTable.postId, postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .groupBy(postsTable.id, petsTable.id)
    .orderBy(desc(postsTable.createdAt));

  const feed = rows.map((r) => ({
    id: r.id,
    caption: r.caption ?? null,
    mediaKey: r.mediaKey,
    isNursery: r.isNursery,
    createdAt: r.createdAt,
    pet: {
      id: r.petId,
      name: r.petName,
      species: r.petSpecies,
      breed: r.petBreed ?? null,
    },
    boopCount: r.boopCount,
    treatCount: r.treatCount,
    commentCount: r.commentCount,
  }));

  res.json(feed);
});

export default router;
