import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  db,
  petsTable,
  postsTable,
  boopsTable,
  treatsTable,
  commentsTable,
  speciesTable,
  breedsTable,
  packFollowsTable,
  interestFollowsTable,
  usersTable,
  blocksTable,
} from "@workspace/db";
import { eq, desc, sql, and, or, isNull, isNotNull } from "drizzle-orm";
import { CreatePetBody, PatchPetBody } from "@workspace/api-zod";
import { mediaTokenUrl, copyObject } from "../lib/r2.js";

const router: IRouter = Router();

/**
 * GET /pets/:id
 *
 * Returns a pet profile (name, species, breed, bio, packCount, viewerInPack)
 * and all of its posts with the same FeedPost shape (reaction counts + viewer
 * flags, including viewerInPack on the embedded PetSummary).
 *
 * Requires a valid Clerk session token (enforced by requireClerkAuth).
 */
router.get("/pets/:id", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Fetch the pet row first so we can 404 cleanly
  const [pet] = await db
    .select({
      id:           petsTable.id,
      ownerId:      petsTable.ownerId,
      name:         petsTable.name,
      species:      petsTable.species,
      breed:        petsTable.breed,
      speciesId:    petsTable.speciesId,
      breedId:      petsTable.breedId,
      bio:          petsTable.bio,
      createdAt:    petsTable.createdAt,
      avatarKey:    petsTable.avatarKey,
      avatarFocusX: petsTable.avatarFocusX,
      avatarFocusY: petsTable.avatarFocusY,
    })
    .from(petsTable)
    .where(eq(petsTable.id, id));

  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Pack count + viewer membership + interest-follow state — run in parallel
  const followChecks = await Promise.all([
    // Pack aggregation
    db
      .select({
        packCount:    sql<number>`count(*)::int`,
        viewerInPack: sql<boolean>`coalesce(bool_or(${packFollowsTable.userId} = ${userId}), false)`,
      })
      .from(packFollowsTable)
      .where(eq(packFollowsTable.petId, id)),

    // Species interest follow (only if pet has a catalogued species)
    pet.speciesId
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(interestFollowsTable)
          .where(
            and(
              eq(interestFollowsTable.userId,    userId),
              eq(interestFollowsTable.speciesId, pet.speciesId),
            ),
          )
      : Promise.resolve(null),

    // Breed interest follow (only if pet has a catalogued breed)
    pet.breedId
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(interestFollowsTable)
          .where(
            and(
              eq(interestFollowsTable.userId,  userId),
              eq(interestFollowsTable.breedId, pet.breedId),
            ),
          )
      : Promise.resolve(null),
  ]);

  const [packRow, speciesFollowRows, breedFollowRows] = followChecks;

  const packCount           = packRow[0]?.packCount    ?? 0;
  const viewerInPack        = packRow[0]?.viewerInPack ?? false;
  const viewerFollowsSpecies = pet.speciesId
    ? ((speciesFollowRows as { n: number }[])[0]?.n ?? 0) > 0
    : null;
  const viewerFollowsBreed   = pet.breedId
    ? ((breedFollowRows as { n: number }[])[0]?.n ?? 0) > 0
    : null;

  const viewerIsOwner = pet.ownerId === userId;

  // If viewer and pet owner have a block relationship (and viewer is not the owner),
  // return the profile metadata with empty posts so grids are hidden per spec.
  const isBlocked = !viewerIsOwner && Boolean(
    (await db
      .select({ id: blocksTable.id })
      .from(blocksTable)
      .where(or(
        and(eq(blocksTable.blockerId, userId),     eq(blocksTable.blockedId, pet.ownerId)),
        and(eq(blocksTable.blockerId, pet.ownerId), eq(blocksTable.blockedId, userId)),
      ))
      .limit(1))[0],
  );

  const petSummary = {
    id:            pet.id,
    name:          pet.name,
    species:       pet.species,
    breed:         pet.breed ?? null,
    viewerInPack,
    // True when the signed-in user owns this pet — drives edit/archive/delete affordances.
    viewerOwnsPet: viewerIsOwner,
  };

  // If blocked, skip the post queries — return empty arrays
  if (isBlocked) {
    res.json({
      id:                  pet.id,
      ownerId:             pet.ownerId,
      name:                pet.name,
      species:             pet.species,
      breed:               pet.breed     ?? null,
      bio:                 pet.bio       ?? null,
      speciesId:           pet.speciesId ?? null,
      breedId:             pet.breedId   ?? null,
      packCount,
      viewerInPack,
      viewerFollowsSpecies,
      viewerFollowsBreed,
      viewerOwnsPet:       viewerIsOwner,
      avatarUrl:           pet.avatarKey    ? mediaTokenUrl(pet.avatarKey)    : null,
      avatarFocusX:        pet.avatarFocusX ?? null,
      avatarFocusY:        pet.avatarFocusY ?? null,
      posts:               [],
      archivedPosts:       [],
    });
    return;
  }

  // Fetch that pet's posts with reaction counts and viewer flags
  const rows = await db
    .select({
      id:              postsTable.id,
      caption:         postsTable.caption,
      mediaKey:        postsTable.mediaKey,
      cropFocusX:      postsTable.cropFocusX,
      cropFocusY:      postsTable.cropFocusY,
      isNursery:       postsTable.isNursery,
      archivedAt:      postsTable.archivedAt,
      createdAt:       postsTable.createdAt,
      boopCount:       sql<number>`count(distinct ${boopsTable.id})::int`,
      treatCount:      sql<number>`count(distinct ${treatsTable.id})::int`,
      commentCount:    sql<number>`count(distinct ${commentsTable.id})::int`,
      viewerHasBooped:  sql<boolean>`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)`,
      viewerHasTreated: sql<boolean>`coalesce(bool_or(${treatsTable.userId} = ${userId}), false)`,
    })
    .from(postsTable)
    .leftJoin(boopsTable,    eq(boopsTable.postId,    postsTable.id))
    .leftJoin(treatsTable,   eq(treatsTable.postId,   postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .where(and(eq(postsTable.petId, id), isNull(postsTable.archivedAt)))
    .groupBy(postsTable.id)
    .orderBy(desc(postsTable.createdAt));

  const posts = rows.map((r) => ({
    id:               r.id,
    caption:          r.caption ?? null,
    mediaKey:         r.mediaKey,
    mediaUrl:         mediaTokenUrl(r.mediaKey),
    cropFocusX:       r.cropFocusX ?? null,
    cropFocusY:       r.cropFocusY ?? null,
    isNursery:        r.isNursery,
    archivedAt:       r.archivedAt ? r.archivedAt.toISOString() : null,
    createdAt:        r.createdAt,
    pet:              petSummary,
    boopCount:        r.boopCount,
    treatCount:       r.treatCount,
    commentCount:     r.commentCount,
    viewerHasBooped:  r.viewerHasBooped,
    viewerHasTreated: r.viewerHasTreated,
  }));

  // Archived posts — only fetched for the pet's owner; empty array for everyone else.
  const archivedPostRows = viewerIsOwner
    ? await db
        .select({
          id:               postsTable.id,
          caption:          postsTable.caption,
          mediaKey:         postsTable.mediaKey,
          cropFocusX:       postsTable.cropFocusX,
          cropFocusY:       postsTable.cropFocusY,
          isNursery:        postsTable.isNursery,
          archivedAt:       postsTable.archivedAt,
          createdAt:        postsTable.createdAt,
          boopCount:        sql<number>`count(distinct ${boopsTable.id})::int`,
          treatCount:       sql<number>`count(distinct ${treatsTable.id})::int`,
          commentCount:     sql<number>`count(distinct ${commentsTable.id})::int`,
          viewerHasBooped:  sql<boolean>`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)`,
          viewerHasTreated: sql<boolean>`coalesce(bool_or(${treatsTable.userId} = ${userId}), false)`,
        })
        .from(postsTable)
        .leftJoin(boopsTable,    eq(boopsTable.postId,    postsTable.id))
        .leftJoin(treatsTable,   eq(treatsTable.postId,   postsTable.id))
        .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
        .where(and(eq(postsTable.petId, id), isNotNull(postsTable.archivedAt)))
        .groupBy(postsTable.id)
        .orderBy(desc(postsTable.archivedAt))
    : [];

  const archivedPosts = archivedPostRows.map((r) => ({
    id:               r.id,
    caption:          r.caption ?? null,
    mediaKey:         r.mediaKey,
    mediaUrl:         mediaTokenUrl(r.mediaKey),
    cropFocusX:       r.cropFocusX ?? null,
    cropFocusY:       r.cropFocusY ?? null,
    isNursery:        r.isNursery,
    archivedAt:       r.archivedAt ? r.archivedAt.toISOString() : null,
    createdAt:        r.createdAt,
    pet:              petSummary,
    boopCount:        r.boopCount,
    treatCount:       r.treatCount,
    commentCount:     r.commentCount,
    viewerHasBooped:  r.viewerHasBooped,
    viewerHasTreated: r.viewerHasTreated,
  }));

  res.json({
    id:                  pet.id,
    ownerId:             pet.ownerId,
    name:                pet.name,
    species:             pet.species,
    breed:               pet.breed     ?? null,
    bio:                 pet.bio       ?? null,
    speciesId:           pet.speciesId ?? null,
    breedId:             pet.breedId   ?? null,
    packCount,
    viewerInPack,
    viewerFollowsSpecies,
    viewerFollowsBreed,
    viewerOwnsPet:       viewerIsOwner,
    avatarUrl:           pet.avatarKey    ? mediaTokenUrl(pet.avatarKey)    : null,
    avatarFocusX:        pet.avatarFocusX ?? null,
    avatarFocusY:        pet.avatarFocusY ?? null,
    posts,
    archivedPosts,
  });
});

/**
 * POST /pets
 *
 * Creates a new pet owned by the authenticated user, then immediately adds the
 * creator to that pet's Pack — both in a single transaction.  This ensures the
 * owner always has their own pets in their Pack, which the future
 * follows-filtered Home feed requires.
 */
router.post("/pets", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const parsed = CreatePetBody.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { name, species: speciesText, breed: breedText, bio, speciesId, breedId } = parsed.data;

  // At least one of speciesId or free-text species must be present.
  if (!speciesId && !speciesText) {
    res.status(400).json({ error: "species or speciesId is required" });
    return;
  }

  // Resolve authoritative text values from FKs (server is the source of truth
  // for names when FKs are provided, preventing client-side name drift).
  let resolvedSpecies = speciesText ?? "";
  let resolvedBreed: string | null = breedText ?? null;

  if (speciesId) {
    const [speciesRow] = await db
      .select()
      .from(speciesTable)
      .where(eq(speciesTable.id, speciesId))
      .limit(1);
    if (!speciesRow) {
      res.status(400).json({ error: "Invalid speciesId" });
      return;
    }
    resolvedSpecies = speciesRow.name;
  }

  if (breedId) {
    const [breedRow] = await db
      .select()
      .from(breedsTable)
      .where(eq(breedsTable.id, breedId))
      .limit(1);
    if (!breedRow) {
      res.status(400).json({ error: "Invalid breedId" });
      return;
    }
    resolvedBreed = breedRow.name;
  }

  // Create the pet and auto-join the creator's Pack in one transaction
  const pet = await db.transaction(async (tx) => {
    const [newPet] = await tx
      .insert(petsTable)
      .values({
        ownerId:   userId,
        name,
        species:   resolvedSpecies,
        breed:     resolvedBreed,
        speciesId: speciesId ?? null,
        breedId:   breedId   ?? null,
        bio:       bio        ?? null,
      })
      .returning();

    // Auto-pack: owner always follows their own pet from creation
    await tx
      .insert(packFollowsTable)
      .values({ userId, petId: newPet.id })
      .onConflictDoNothing();

    return newPet;
  });

  res.status(201).json({
    id:           pet.id,
    ownerId:      pet.ownerId,
    name:         pet.name,
    species:      pet.species,
    breed:        pet.breed     ?? null,
    speciesId:    pet.speciesId ?? null,
    breedId:      pet.breedId   ?? null,
    bio:          pet.bio       ?? null,
    createdAt:    pet.createdAt,
    thumbnailUrl: null,
    avatarUrl:    null,
    avatarFocusX: null,
    avatarFocusY: null,
  });
});

/**
 * GET /pets/:id/pack-members
 *
 * Returns the list of users who have this pet in their Pack, ordered by
 * join date ascending (founding members first).  No auth required to view
 * a pet's Pack — the pet must exist, otherwise 404.
 */
router.get("/pets/:id/pack-members", async (req, res) => {
  const { id } = req.params;

  // Verify the pet exists
  const [pet] = await db
    .select({ id: petsTable.id })
    .from(petsTable)
    .where(eq(petsTable.id, id))
    .limit(1);

  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const rows = await db
    .select({
      username: usersTable.username,
      joinedAt: packFollowsTable.createdAt,
    })
    .from(packFollowsTable)
    .innerJoin(usersTable, eq(usersTable.id, packFollowsTable.userId))
    .where(eq(packFollowsTable.petId, id))
    .orderBy(packFollowsTable.createdAt); // oldest first — founding members at top

  res.json({ members: rows.map((r) => ({ username: r.username, joinedAt: r.joinedAt })) });
});

/**
 * GET /me/pets
 *
 * Returns all pets owned by the authenticated user, ordered by creation time.
 */
router.get("/me/pets", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const pets = await db
    .select({
      id:             petsTable.id,
      ownerId:        petsTable.ownerId,
      name:           petsTable.name,
      species:        petsTable.species,
      breed:          petsTable.breed,
      bio:            petsTable.bio,
      speciesId:      petsTable.speciesId,
      breedId:        petsTable.breedId,
      createdAt:      petsTable.createdAt,
      avatarKey:      petsTable.avatarKey,
      avatarFocusX:   petsTable.avatarFocusX,
      avatarFocusY:   petsTable.avatarFocusY,
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
    .from(petsTable)
    .where(eq(petsTable.ownerId, userId))
    .orderBy(desc(petsTable.createdAt));

  res.json({
    pets: pets.map((p) => {
      const avatarUrl = p.avatarKey ? mediaTokenUrl(p.avatarKey) : null;
      // Thumbnail prefers the avatar; falls back to most recent post.
      const thumbnailUrl = avatarUrl
        ?? (p.recentMediaKey ? mediaTokenUrl(p.recentMediaKey) : null);
      return {
        id:           p.id,
        ownerId:      p.ownerId,
        name:         p.name,
        species:      p.species,
        breed:        p.breed     ?? null,
        bio:          p.bio       ?? null,
        speciesId:    p.speciesId ?? null,
        breedId:      p.breedId   ?? null,
        createdAt:    p.createdAt,
        thumbnailUrl,
        avatarUrl,
        avatarFocusX: p.avatarFocusX ?? null,
        avatarFocusY: p.avatarFocusY ?? null,
      };
    }),
  });
});

/**
 * PATCH /pets/:id
 *
 * Updates one or more profile fields for a pet owned by the authenticated user.
 * All body fields are optional; omitted fields are left unchanged.
 *
 * Species + breed resolution mirrors the POST /pets logic:
 *   - speciesId provided → resolve authoritative name, clear existing breed
 *   - breedId provided   → resolve authoritative name
 *   - breedId null       → clear breed FK (use free-text breed if provided)
 *   - breed only         → free-text ("Not listed") path
 *
 * Returns the updated Pet (without post lists; client invalidates pet profile).
 */
router.patch("/pets/:id", async (req, res) => {
  const { id } = req.params;
  const userId  = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Verify pet exists and caller is the owner
  const [existing] = await db
    .select({ id: petsTable.id, ownerId: petsTable.ownerId })
    .from(petsTable)
    .where(eq(petsTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (existing.ownerId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = PatchPetBody.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { name, bio, speciesId, breedId, breed } = parsed.data;

  const updates: {
    name?:      string;
    bio?:       string | null;
    species?:   string;
    speciesId?: string | null;
    breed?:     string | null;
    breedId?:   string | null;
  } = {};

  if (name !== undefined) updates.name = name;
  if (bio  !== undefined) updates.bio  = bio ?? null;

  // Resolve species FK → authoritative name
  if (speciesId !== undefined) {
    const [speciesRow] = await db
      .select({ name: speciesTable.name })
      .from(speciesTable)
      .where(eq(speciesTable.id, speciesId))
      .limit(1);
    if (!speciesRow) {
      res.status(400).json({ error: "Invalid speciesId" });
      return;
    }
    updates.speciesId = speciesId;
    updates.species   = speciesRow.name;
    // Changing species clears the breed; breedId/breed in the same request
    // will overwrite these defaults immediately below.
    updates.breedId = null;
    updates.breed   = null;
  }

  // Resolve breed — FK path, free-text path, or explicit clear
  if (breedId !== undefined) {
    if (breedId === null) {
      updates.breedId = null;
      updates.breed   = breed ?? null; // allow free-text in same request
    } else {
      const [breedRow] = await db
        .select({ name: breedsTable.name })
        .from(breedsTable)
        .where(eq(breedsTable.id, breedId))
        .limit(1);
      if (!breedRow) {
        res.status(400).json({ error: "Invalid breedId" });
        return;
      }
      updates.breedId = breedId;
      updates.breed   = breedRow.name;
    }
  } else if (breed !== undefined) {
    // Free-text breed only — clear the FK
    updates.breedId = null;
    updates.breed   = breed ?? null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(petsTable)
    .set(updates)
    .where(eq(petsTable.id, id))
    .returning();

  res.json({
    id:           updated.id,
    ownerId:      updated.ownerId,
    name:         updated.name,
    species:      updated.species,
    breed:        updated.breed     ?? null,
    speciesId:    updated.speciesId ?? null,
    breedId:      updated.breedId   ?? null,
    bio:          updated.bio       ?? null,
    createdAt:    updated.createdAt,
    thumbnailUrl: null,   // client invalidates pet profile query to get full data
    avatarUrl:    null,
    avatarFocusX: null,
    avatarFocusY: null,
  });
});

/**
 * PATCH /pets/:id/avatar
 *
 * Sets or clears the avatar for a pet owned by the authenticated user.
 *
 * Body: { avatarKey: string | null, focusX: number | null, focusY: number | null }
 *   - avatarKey null → clear the avatar (revert to latest-post hero fallback)
 *   - avatarKey starting with "posts/" → server copies to "avatars/" prefix for
 *     orphan safety (deleting the source post won't break the avatar)
 *   - avatarKey starting with "avatars/" → used as-is (already in avatars/ namespace)
 *
 * Returns: { avatarUrl, avatarFocusX, avatarFocusY }
 */
router.patch("/pets/:id/avatar", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  // Verify pet exists and caller is the owner
  const [pet] = await db
    .select({ id: petsTable.id, ownerId: petsTable.ownerId })
    .from(petsTable)
    .where(eq(petsTable.id, id))
    .limit(1);

  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (pet.ownerId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { avatarKey, focusX, focusY } = req.body as {
    avatarKey: string | null;
    focusX:    number | null;
    focusY:    number | null;
  };

  let storedKey: string | null = null;

  if (avatarKey !== null && typeof avatarKey === "string") {
    if (avatarKey.startsWith("posts/")) {
      // Copy to avatars/ prefix for orphan safety
      const ext   = avatarKey.split(".").pop() ?? "jpg";
      const destKey = `avatars/${randomUUID()}.${ext}`;
      await copyObject(avatarKey, destKey);
      storedKey = destKey;
    } else if (avatarKey.startsWith("avatars/")) {
      // Already in the correct namespace (uploaded via presign-avatar)
      storedKey = avatarKey;
    } else {
      res.status(400).json({ error: "Invalid avatarKey prefix" });
      return;
    }
  }

  await db
    .update(petsTable)
    .set({
      avatarKey:    storedKey,
      avatarFocusX: storedKey !== null ? (focusX ?? null) : null,
      avatarFocusY: storedKey !== null ? (focusY ?? null) : null,
    })
    .where(eq(petsTable.id, id));

  res.json({
    avatarUrl:    storedKey ? mediaTokenUrl(storedKey) : null,
    avatarFocusX: storedKey !== null ? (focusX ?? null) : null,
    avatarFocusY: storedKey !== null ? (focusY ?? null) : null,
  });
});

export default router;
