import { Router, type IRouter } from "express";
import {
  db,
  postsTable,
  petsTable,
  boopsTable,
  treatsTable,
  commentsTable,
  configTable,
  packFollowsTable,
} from "@workspace/db";
import { and, eq, gte, desc, sql } from "drizzle-orm";
import { mediaTokenUrl } from "../lib/r2.js";

const router: IRouter = Router();

/**
 * GET /feed
 *
 * Returns all posts in reverse-chronological order, each with embedded pet
 * info, aggregate reaction counts, and per-post viewer state (has_booped /
 * has_treated / viewer_in_pack).  Also returns viewer.treats_remaining_today.
 *
 * Requires a valid Clerk session token (enforced by requireClerkAuth).
 */
router.get("/feed", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Optional nursery filter — when ?nursery=true only is_nursery posts are returned
  const nurseryOnly = req.query.nursery === "true";

  const rows = await db
    .select({
      id:          postsTable.id,
      caption:     postsTable.caption,
      mediaKey:    postsTable.mediaKey,
      cropFocusX:  postsTable.cropFocusX,
      cropFocusY:  postsTable.cropFocusY,
      isNursery:   postsTable.isNursery,
      createdAt:   postsTable.createdAt,
      petId:       petsTable.id,
      petName:     petsTable.name,
      petSpecies:  petsTable.species,
      petBreed:    petsTable.breed,
      boopCount:    sql<number>`count(distinct ${boopsTable.id})::int`,
      treatCount:   sql<number>`count(distinct ${treatsTable.id})::int`,
      commentCount: sql<number>`count(distinct ${commentsTable.id})::int`,
      // bool_or across the LEFT-JOINed rows: true if any row belongs to the viewer
      viewerHasBooped:  sql<boolean>`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)`,
      viewerHasTreated: sql<boolean>`coalesce(bool_or(${treatsTable.userId} = ${userId}), false)`,
      // Correlated EXISTS — whether the viewer follows this pet
      viewerInPack: sql<boolean>`exists(
        select 1 from pack_follows pf
        where pf.user_id = ${userId}
          and pf.pet_id = ${petsTable.id}
      )`,
      // Ownership flag — drives the delete affordance on the post-detail screen
      viewerOwnsPet: sql<boolean>`${petsTable.ownerId} = ${userId}`,
    })
    .from(postsTable)
    .innerJoin(petsTable,    eq(petsTable.id,    postsTable.petId))
    .leftJoin(boopsTable,    eq(boopsTable.postId,    postsTable.id))
    .leftJoin(treatsTable,   eq(treatsTable.postId,   postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .where(nurseryOnly ? eq(postsTable.isNursery, true) : undefined)
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

  // mediaTokenUrl is synchronous — no Promise.all needed
  const posts = rows.map((r) => ({
    id:          r.id,
    caption:     r.caption ?? null,
    mediaKey:    r.mediaKey,
    mediaUrl:    mediaTokenUrl(r.mediaKey),
    cropFocusX:  r.cropFocusX  ?? null,
    cropFocusY:  r.cropFocusY  ?? null,
    isNursery:   r.isNursery,
    createdAt:   r.createdAt,
    pet: {
      id:            r.petId,
      name:          r.petName,
      species:       r.petSpecies,
      breed:         r.petBreed ?? null,
      viewerInPack:  r.viewerInPack,
      viewerOwnsPet: r.viewerOwnsPet,
    },
    boopCount:        r.boopCount,
    treatCount:       r.treatCount,
    commentCount:     r.commentCount,
    viewerHasBooped:  r.viewerHasBooped,
    viewerHasTreated: r.viewerHasTreated,
  }));

  res.json({ posts, viewer: { treatsRemainingToday } });
});

export default router;
