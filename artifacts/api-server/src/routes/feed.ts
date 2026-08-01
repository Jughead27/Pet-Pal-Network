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
import { and, eq, gte, desc, sql, isNull } from "drizzle-orm";
import { activePets } from "../lib/petQueries.js";
import { mediaTokenUrl } from "../lib/r2.js";
import { notBlockedPostOwner, notHiddenByAdminPost } from "../lib/excludeBlocked.js";

const router: IRouter = Router();

/**
 * GET /feed
 *
 * Returns all posts in reverse-chronological order, each with embedded pet
 * info, aggregate reaction counts, and per-post viewer state.
 *
 * viewerOwnsPet: true when the viewer is ANY member of pet_owners for that
 * pet (primary or co).  Drives the "this is your pet" affordance in the feed.
 *
 * Requires a valid Clerk session token (enforced by requireClerkAuth).
 */
router.get("/feed", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const nurseryOnly = req.query.nursery === "true";
  const speciesId   = typeof req.query.speciesId === "string" && req.query.speciesId.length > 0
    ? req.query.speciesId
    : undefined;
  const sortPopular = req.query.sort === "popular";

  const popularOrderBy = [
    desc(sql<number>`(
      select coalesce(count(*), 0)
      from boops b7
      where b7.post_id = ${postsTable.id}
        and b7.created_at >= now() - interval '7 days'
    ) + 3 * (
      select coalesce(count(*), 0)
      from treats t7
      where t7.post_id = ${postsTable.id}
        and t7.created_at >= now() - interval '7 days'
    )`),
    desc(postsTable.createdAt),
  ] as const;

  const rows = await db
    .select({
      id:          postsTable.id,
      caption:     postsTable.caption,
      mediaKey:    postsTable.mediaKey,
      cropFocusX:  postsTable.cropFocusX,
      cropFocusY:  postsTable.cropFocusY,
      isNursery:   postsTable.isNursery,
      archivedAt:  postsTable.archivedAt,
      createdAt:   postsTable.createdAt,
      petId:        petsTable.id,
      petName:      petsTable.name,
      petSpecies:   petsTable.species,
      petBreed:     petsTable.breed,
      petSpeciesId: petsTable.speciesId,
      boopCount:    sql<number>`count(distinct ${boopsTable.id})::int`,
      treatCount:   sql<number>`count(distinct ${treatsTable.id})::int`,
      commentCount: sql<number>`count(distinct ${commentsTable.id})::int`,
      viewerHasBooped:  sql<boolean>`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)`,
      viewerHasTreated: sql<boolean>`coalesce(bool_or(${treatsTable.userId} = ${userId}), false)`,
      // Correlated EXISTS — whether the viewer follows this pet's Pack
      viewerInPack: sql<boolean>`exists(
        select 1 from pack_follows pf
        where pf.user_id = ${userId}
          and pf.pet_id = ${petsTable.id}
      )`,
      // Ownership flag via pet_owners (primary or co) — drives delete/edit
      // affordance in the feed card.
      viewerOwnsPet: sql<boolean>`exists(
        select 1 from pet_owners po
        where po.pet_id = ${petsTable.id}
          and po.user_id = ${userId}
      )`,
      // Raw owner ID — used by the mobile block affordance in ReportFlow
      petOwnerId: petsTable.ownerId,
    })
    .from(postsTable)
    .innerJoin(petsTable,    eq(petsTable.id,    postsTable.petId))
    .leftJoin(boopsTable,    eq(boopsTable.postId,    postsTable.id))
    .leftJoin(treatsTable,   eq(treatsTable.postId,   postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .where(and(
      isNull(postsTable.archivedAt),
      activePets,
      nurseryOnly ? eq(postsTable.isNursery, true) : undefined,
      speciesId   ? eq(petsTable.speciesId, speciesId)  : undefined,
      notBlockedPostOwner(userId),
      notHiddenByAdminPost(),
    ))
    .groupBy(postsTable.id, petsTable.id)
    .orderBy(...(sortPopular ? popularOrderBy : [desc(postsTable.createdAt)]));

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

  const posts = rows.map((r) => ({
    id:          r.id,
    caption:     r.caption ?? null,
    mediaKey:    r.mediaKey,
    mediaUrl:    mediaTokenUrl(r.mediaKey),
    cropFocusX:  r.cropFocusX  ?? null,
    cropFocusY:  r.cropFocusY  ?? null,
    isNursery:   r.isNursery,
    archivedAt:  r.archivedAt ? r.archivedAt.toISOString() : null,
    createdAt:   r.createdAt,
    pet: {
      id:            r.petId,
      name:          r.petName,
      species:       r.petSpecies,
      breed:         r.petBreed ?? null,
      speciesId:     r.petSpeciesId ?? null,
      viewerInPack:  r.viewerInPack,
      viewerOwnsPet: r.viewerOwnsPet,
      ownerId:       r.petOwnerId,
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
