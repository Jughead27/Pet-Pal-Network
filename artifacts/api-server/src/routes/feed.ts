import { Router, type IRouter } from "express";
import {
  db,
  postsTable,
  petsTable,
  boopsTable,
  treatsTable,
  commentsTable,
  configTable,
} from "@workspace/db";
import { and, eq, gte, desc, sql } from "drizzle-orm";
import { presignGet } from "../lib/r2.js";

const router: IRouter = Router();

/**
 * GET /feed
 *
 * Returns all posts in reverse-chronological order, each with embedded pet
 * info, aggregate reaction counts, and per-post viewer state (has_booped /
 * has_treated).  Also returns viewer.treats_remaining_today.
 *
 * Requires a valid Clerk session token (enforced by requireClerkAuth).
 */
router.get("/feed", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

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
      // bool_or across the LEFT-JOINed rows: true if any row belongs to the viewer
      viewerHasBooped: sql<boolean>`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)`,
      viewerHasTreated: sql<boolean>`coalesce(bool_or(${treatsTable.userId} = ${userId}), false)`,
    })
    .from(postsTable)
    .innerJoin(petsTable, eq(petsTable.id, postsTable.petId))
    .leftJoin(boopsTable, eq(boopsTable.postId, postsTable.id))
    .leftJoin(treatsTable, eq(treatsTable.postId, postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .groupBy(postsTable.id, petsTable.id)
    .orderBy(desc(postsTable.createdAt));

  // Compute viewer's treats remaining today
  const [limitRow] = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "daily_treat_limit"));
  const dailyLimit = limitRow ? parseInt(limitRow.value, 10) : 5;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [countRow] = await db
    .select({ todayTreats: sql<number>`count(*)::int` })
    .from(treatsTable)
    .where(and(eq(treatsTable.userId, userId), gte(treatsTable.createdAt, today)));
  const treatsRemainingToday = Math.max(0, dailyLimit - (countRow?.todayTreats ?? 0));

  const posts = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      caption: r.caption ?? null,
      mediaKey: r.mediaKey,
      mediaUrl: await presignGet(r.mediaKey),
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
      viewerHasBooped: r.viewerHasBooped,
      viewerHasTreated: r.viewerHasTreated,
    })),
  );

  res.json({ posts, viewer: { treatsRemainingToday } });
});

export default router;
