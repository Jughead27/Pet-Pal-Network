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
  postPetsTable,
  breedsTable,
  speciesTable,
} from "@workspace/db";
import { and, eq, gte, desc, sql, isNull } from "drizzle-orm";
import { activePets } from "../lib/petQueries.js";
import { mediaTokenUrl } from "../lib/r2.js";
import { notBlockedPostOwner, notHiddenByAdminPost } from "../lib/excludeBlocked.js";

const router: IRouter = Router();

// ── Cursor-based pagination ───────────────────────────────────────────────────
// Opaque base64url-encoded JSON. Fresh/chronological pages key on
// (created_at, id); Popular pages key on (score, created_at, id) since the
// 7-day engagement score is the primary sort key there. id is the final
// tiebreak in both, making the ordering total and the cursor stable.

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE     = 50;

type FeedCursor = { s?: number; t: string; id: string };

function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): FeedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string") return null;
    if (parsed.s !== undefined && typeof parsed.s !== "number") return null;
    return parsed as FeedCursor;
  } catch {
    return null;
  }
}

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
  // Spotlight tap-through — only this pet's posts (primary pet or tagged).
  const petId = typeof req.query.petId === "string" && req.query.petId.length > 0
    ? req.query.petId
    : undefined;
  // Breed narrow — catalogue breed UUID; only valid alongside speciesId.
  const breedId = typeof req.query.breedId === "string" && req.query.breedId.length > 0
    ? req.query.breedId
    : undefined;

  // Pagination params — page size (default 20, max 50) + opaque cursor.
  const limitParsed = parseInt(String(req.query.limit ?? ""), 10);
  const pageSize = Number.isFinite(limitParsed) && limitParsed > 0
    ? Math.min(limitParsed, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const cursorRaw = typeof req.query.cursor === "string" && req.query.cursor.length > 0
    ? req.query.cursor
    : undefined;
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : undefined;
  if (cursorRaw && !cursor) {
    res.status(400).json({ error: "Invalid cursor" });
    return;
  }
  if (cursor && sortPopular && typeof cursor.s !== "number") {
    res.status(400).json({ error: "Invalid cursor" });
    return;
  }

  // Validate breed belongs to the selected species (never trust the client
  // pairing — breed implies species, but confirm server-side).
  if (breedId) {
    if (!speciesId) {
      res.status(400).json({ error: "breedId requires speciesId" });
      return;
    }
    const [breedRow] = await db
      .select({ id: breedsTable.id })
      .from(breedsTable)
      .where(and(
        sql`${breedsTable.id}::text = ${breedId}`,
        sql`${breedsTable.speciesId}::text = ${speciesId}`,
      ));
    if (!breedRow) {
      res.status(400).json({ error: "Breed does not belong to the selected species" });
      return;
    }
  }

  // 7-day engagement score — shared by the Popular ORDER BY, the Popular
  // cursor predicate, and the per-row select used to build nextCursor.
  const popularScore = sql<number>`(
    select coalesce(count(*), 0)
    from boops b7
    where b7.post_id = ${postsTable.id}
      and b7.created_at >= now() - interval '7 days'
  ) + 3 * (
    select coalesce(count(*), 0)
    from treats t7
    where t7.post_id = ${postsTable.id}
      and t7.created_at >= now() - interval '7 days'
  )`;

  // id is the final tiebreak in both orders so the sort is total — required
  // for the row-comparison cursor to never skip or duplicate posts within a
  // static dataset. Popular pages accept live-ranking drift: a score change
  // between page fetches can duplicate or omit a post across pages, which is
  // the standard tradeoff for cursoring a live score without a snapshot.
  const popularOrderBy = [
    desc(popularScore),
    desc(postsTable.createdAt),
    desc(postsTable.id),
  ] as const;

  // Keyset predicate: rows strictly after the cursor position in sort order.
  const cursorWhere = cursor
    ? sortPopular
      ? sql`(${popularScore}, ${postsTable.createdAt}, ${postsTable.id})
            < (${cursor.s}::int, ${cursor.t}::timestamp, ${cursor.id}::uuid)`
      : sql`(${postsTable.createdAt}, ${postsTable.id})
            < (${cursor.t}::timestamp, ${cursor.id}::uuid)`
    : undefined;

  const rows = await db
    .select({
      id:          postsTable.id,
      caption:     postsTable.caption,
      mediaKey:    postsTable.mediaKey,
      cropFocusX:  postsTable.cropFocusX,
      cropFocusY:  postsTable.cropFocusY,
      cropMode:    postsTable.cropMode,
      cropX:       postsTable.cropX,
      cropY:       postsTable.cropY,
      cropW:       postsTable.cropW,
      cropH:       postsTable.cropH,
      cropFillColor: postsTable.cropFillColor,
      cropFillThumb: postsTable.cropFillThumb,
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
      commentCount: sql<number>`count(distinct case when ${commentsTable.deletedAt} is null then ${commentsTable.id} end)::int`,
      viewerHasBooped:  sql<boolean>`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)`,
      viewerHasTreated: sql<boolean>`coalesce(bool_or(${treatsTable.userId} = ${userId}), false)`,
      // Author flag — viewer cannot treat their own post (authorship, not ownership).
      viewerIsAuthor:   sql<boolean>`(${postsTable.postedByUserId} = ${userId})`,
      // Post author — drives the tappable "Posted by [DisplayName]" line.
      authorId:          postsTable.postedByUserId,
      authorDisplayName: sql<string | null>`(
        SELECT u.display_name FROM users u WHERE u.id = ${postsTable.postedByUserId}
      )`,
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
      taggedPetRaw: sql<string | null>`COALESCE((
        SELECT json_agg(json_build_object(
          'id',            pp.pet_id::text,
          'name',          pe_t.name,
          'ownerId',       pe_t.owner_id,
          'viewerOwnsPet', EXISTS(
            SELECT 1 FROM pet_owners po2
            WHERE po2.pet_id = pp.pet_id AND po2.user_id = ${userId}
          ),
          'avatarKey', pe_t.avatar_key
        ) ORDER BY pp.created_at)
        FROM post_pets pp
        JOIN pets pe_t ON pe_t.id = pp.pet_id
        WHERE pp.post_id = ${postsTable.id}
      ), '[]'::json)`,
      // Lossless microsecond-precision created_at text for the cursor —
      // Date.toISOString() only keeps milliseconds, which can skip rows
      // sharing the same millisecond at a page boundary.
      createdAtCursor: sql<string>`to_char(${postsTable.createdAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
      // Popular sort only: score echoed per-row to build nextCursor. Skipped
      // on the fresh path so its two correlated subqueries aren't paid there.
      ...(sortPopular ? { popularScore } : {}),
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
      breedId     ? sql`${petsTable.breedId}::text = ${breedId}` : undefined,
      // Pet filter — primary pet OR tagged via post_pets (canonical source).
      petId ? sql`(
        ${postsTable.petId}::text = ${petId}
        or exists(
          select 1 from post_pets ppf
          where ppf.post_id = ${postsTable.id}
            and ppf.pet_id::text = ${petId}
        )
      )` : undefined,
      notBlockedPostOwner(userId),
      notHiddenByAdminPost(),
      cursorWhere,
    ))
    .groupBy(postsTable.id, petsTable.id)
    .orderBy(...(sortPopular ? popularOrderBy : [desc(postsTable.createdAt), desc(postsTable.id)]))
    .limit(pageSize + 1); // +1 row = "has more" probe; trimmed before response

  const hasMore  = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const lastRow  = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow
    ? encodeCursor({
        ...(sortPopular
          ? { s: Number((lastRow as unknown as { popularScore: number }).popularScore) }
          : {}),
        t:  lastRow.createdAtCursor,
        id: lastRow.id,
      })
    : null;

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

  const posts = pageRows.map((r) => ({
    id:          r.id,
    caption:     r.caption ?? null,
    mediaKey:    r.mediaKey,
    mediaUrl:    mediaTokenUrl(r.mediaKey),
    cropFocusX:  r.cropFocusX  ?? null,
    cropFocusY:  r.cropFocusY  ?? null,
    cropMode:    r.cropMode    ?? null,
    cropX:       r.cropX       ?? null,
    cropY:       r.cropY       ?? null,
    cropW:       r.cropW       ?? null,
    cropH:       r.cropH       ?? null,
    cropFillColor: r.cropFillColor ?? null,
    cropFillThumb: r.cropFillThumb ?? null,
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
    viewerIsAuthor:   r.viewerIsAuthor,
    authorId:          r.authorId          ?? null,
    authorDisplayName: r.authorDisplayName ?? null,
    taggedPets: (() => {
      const raw = r.taggedPetRaw as Array<{ id: string; name: string; ownerId: string; viewerOwnsPet: boolean; avatarKey: string | null }> | null;
      return (Array.isArray(raw) ? raw : []).map((tp) => ({
        id:            tp.id,
        name:          tp.name,
        ownerId:       tp.ownerId,
        viewerOwnsPet: tp.viewerOwnsPet,
        avatarUrl:     tp.avatarKey ? mediaTokenUrl(tp.avatarKey) : null,
      }));
    })(),
  }));

  res.json({ posts, viewer: { treatsRemainingToday }, nextCursor });
});

/**
 * GET /feed/species
 *
 * Distinct species with at least one eligible post — powers the Sniff and
 * Nursery species chips. Exhaustive (grouped query over all posts), NOT a
 * recent-posts sample. Applies the exact same eligibility rules as GET /feed:
 * archived, admin-hidden, blocked-owner, and soft-deleted-pet posts excluded.
 *
 * ?nursery=true scopes to nursery posts (for the Nursery screen's chips).
 */
router.get("/feed/species", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  const nurseryOnly = req.query.nursery === "true";

  const rows = await db
    .select({ id: speciesTable.id, name: speciesTable.name })
    .from(postsTable)
    .innerJoin(petsTable,    eq(petsTable.id, postsTable.petId))
    .innerJoin(speciesTable, eq(speciesTable.id, petsTable.speciesId))
    .where(and(
      isNull(postsTable.archivedAt),
      activePets,
      nurseryOnly ? eq(postsTable.isNursery, true) : undefined,
      notBlockedPostOwner(userId),
      notHiddenByAdminPost(),
    ))
    .groupBy(speciesTable.id, speciesTable.name, speciesTable.sortOrder)
    .orderBy(speciesTable.sortOrder);

  res.json({ species: rows });
});

/**
 * GET /feed/species/:id/breeds
 *
 * Distinct catalogue breeds of a species with at least one eligible post —
 * powers the Sniff breed dropdown. Same eligibility rules as GET /feed.
 * Pets with free-text ("not listed") breeds have breed_id NULL and are
 * naturally excluded by the inner join. Alphabetical, same shape as
 * GET /species/:id/breeds so the client can swap sources directly.
 */
router.get("/feed/species/:id/breeds", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
  const { id: speciesId } = req.params;

  const rows = await db
    .select({ id: breedsTable.id, speciesId: breedsTable.speciesId, name: breedsTable.name })
    .from(postsTable)
    .innerJoin(petsTable,   eq(petsTable.id, postsTable.petId))
    .innerJoin(breedsTable, eq(breedsTable.id, petsTable.breedId))
    .where(and(
      isNull(postsTable.archivedAt),
      activePets,
      sql`${petsTable.speciesId}::text = ${speciesId}`,
      notBlockedPostOwner(userId),
      notHiddenByAdminPost(),
    ))
    .groupBy(breedsTable.id, breedsTable.speciesId, breedsTable.name)
    .orderBy(breedsTable.name);

  res.json({ breeds: rows });
});

export default router;
