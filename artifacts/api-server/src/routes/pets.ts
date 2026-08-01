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
  petOwnersTable,
} from "@workspace/db";
import { eq, desc, sql, and, or, isNull, isNotNull } from "drizzle-orm";
import { CreatePetBody, PatchPetBody } from "@workspace/api-zod";
import { mediaTokenUrl, copyObject } from "../lib/r2.js";
import { notHiddenByAdminPost } from "../lib/excludeBlocked.js";
import { writeAudit } from "../lib/writeAudit.js";
import { isPetOwner, isPetPrimaryOwner, getPetOwnerRow } from "../lib/isPetOwner.js";

const router: IRouter = Router();

/**
 * GET /pets/:id
 *
 * Returns a pet profile (name, species, breed, bio, packCount, viewerInPack)
 * and all of its posts with reaction counts + viewer flags.
 *
 * With co-ownership:
 *   viewerOwnsPet        — viewer is any member of pet_owners (primary or co)
 *   viewerIsPrimaryOwner — viewer holds the 'primary' role
 *   each post gets viewerCanManagePost = viewer posted it OR viewer is primary
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
    .where(and(eq(petsTable.id, id), isNull(petsTable.deletedAt)));

  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Ownership + pack + interest-follows — run in parallel
  const [ownerRow, packChecks] = await Promise.all([
    // Ownership check: is viewer in pet_owners for this pet?
    getPetOwnerRow(userId, id),

    // Pack count + viewer membership + interest-follow state
    Promise.all([
      db
        .select({
          packCount:    sql<number>`count(*)::int`,
          viewerInPack: sql<boolean>`coalesce(bool_or(${packFollowsTable.userId} = ${userId}), false)`,
        })
        .from(packFollowsTable)
        .where(eq(packFollowsTable.petId, id)),

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
    ]),
  ]);

  const viewerIsOwner       = ownerRow !== null;
  const viewerIsPrimaryOwner = ownerRow?.role === "primary";

  const [packRow, speciesFollowRows, breedFollowRows] = packChecks;

  const packCount            = packRow[0]?.packCount    ?? 0;
  const viewerInPack         = packRow[0]?.viewerInPack ?? false;
  const viewerFollowsSpecies = pet.speciesId
    ? ((speciesFollowRows as { n: number }[])[0]?.n ?? 0) > 0
    : null;
  const viewerFollowsBreed   = pet.breedId
    ? ((breedFollowRows as { n: number }[])[0]?.n ?? 0) > 0
    : null;

  // Block check: is there a block between the viewer and ANY co-owner of this pet?
  // Uses raw SQL to avoid a second round-trip for each owner.
  const isBlocked = !viewerIsOwner && Boolean(
    (await db.execute(sql`
      SELECT 1 FROM blocks b
      JOIN pet_owners po ON po.pet_id = ${id}::uuid
      WHERE (b.blocker_id = ${userId} AND b.blocked_id = po.user_id)
         OR (b.blocker_id = po.user_id AND b.blocked_id = ${userId})
      LIMIT 1
    `)).rows[0],
  );

  const petSummary = {
    id:                 pet.id,
    name:               pet.name,
    species:            pet.species,
    breed:              pet.breed ?? null,
    viewerInPack,
    viewerOwnsPet:      viewerIsOwner,
    viewerIsPrimaryOwner,
  };

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
      viewerOwnsPet:         viewerIsOwner,
      viewerIsPrimaryOwner,
      avatarUrl:             pet.avatarKey ? mediaTokenUrl(pet.avatarKey) : null,
      avatarFocusX:          pet.avatarFocusX ?? null,
      avatarFocusY:          pet.avatarFocusY ?? null,
      posts:                 [],
      archivedPosts:         [],
    });
    return;
  }

  // Fetch posts with reaction counts, viewer flags, and posted_by_user_id
  // (for computing viewerCanManagePost — never sent raw to client).
  const rows = await db
    .select({
      id:               postsTable.id,
      caption:          postsTable.caption,
      mediaKey:         postsTable.mediaKey,
      cropFocusX:       postsTable.cropFocusX,
      cropFocusY:       postsTable.cropFocusY,
      isNursery:        postsTable.isNursery,
      archivedAt:       postsTable.archivedAt,
      createdAt:        postsTable.createdAt,
      hiddenByAdmin:    postsTable.hiddenByAdmin,
      postedByUserId:   postsTable.postedByUserId,
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
    .where(and(
      eq(postsTable.petId, id),
      isNull(postsTable.archivedAt),
      viewerIsOwner ? undefined : notHiddenByAdminPost(),
    ))
    .groupBy(postsTable.id)
    .orderBy(desc(postsTable.createdAt));

  const posts = rows.map((r) => {
    // viewerCanManagePost: original poster OR primary owner
    const viewerCanManagePost = viewerIsPrimaryOwner ||
      (viewerIsOwner && r.postedByUserId === userId);
    return {
      id:                  r.id,
      caption:             r.caption ?? null,
      mediaKey:            r.mediaKey,
      mediaUrl:            mediaTokenUrl(r.mediaKey),
      cropFocusX:          r.cropFocusX ?? null,
      cropFocusY:          r.cropFocusY ?? null,
      isNursery:           r.isNursery,
      archivedAt:          r.archivedAt ? r.archivedAt.toISOString() : null,
      createdAt:           r.createdAt,
      hiddenByAdmin:       r.hiddenByAdmin,
      pet:                 petSummary,
      boopCount:           r.boopCount,
      treatCount:          r.treatCount,
      commentCount:        r.commentCount,
      viewerHasBooped:     r.viewerHasBooped,
      viewerHasTreated:    r.viewerHasTreated,
      // Per-post management flag — drives edit/archive/delete affordances.
      // postedByUserId intentionally NOT included in the response.
      viewerCanManagePost,
    };
  });

  // Archived posts — visible to any owner (primary or co)
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
          hiddenByAdmin:    postsTable.hiddenByAdmin,
          postedByUserId:   postsTable.postedByUserId,
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

  const archivedPosts = archivedPostRows.map((r) => {
    const viewerCanManagePost = viewerIsPrimaryOwner ||
      (viewerIsOwner && r.postedByUserId === userId);
    return {
      id:                  r.id,
      caption:             r.caption ?? null,
      mediaKey:            r.mediaKey,
      mediaUrl:            mediaTokenUrl(r.mediaKey),
      cropFocusX:          r.cropFocusX ?? null,
      cropFocusY:          r.cropFocusY ?? null,
      isNursery:           r.isNursery,
      archivedAt:          r.archivedAt ? r.archivedAt.toISOString() : null,
      createdAt:           r.createdAt,
      hiddenByAdmin:       r.hiddenByAdmin,
      pet:                 petSummary,
      boopCount:           r.boopCount,
      treatCount:          r.treatCount,
      commentCount:        r.commentCount,
      viewerHasBooped:     r.viewerHasBooped,
      viewerHasTreated:    r.viewerHasTreated,
      viewerCanManagePost,
    };
  });

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
    viewerOwnsPet:         viewerIsOwner,
    viewerIsPrimaryOwner,
    avatarUrl:             pet.avatarKey ? mediaTokenUrl(pet.avatarKey) : null,
    avatarFocusX:          pet.avatarFocusX ?? null,
    avatarFocusY:          pet.avatarFocusY ?? null,
    posts,
    archivedPosts,
  });
});

/**
 * POST /pets
 *
 * Creates a new pet owned by the authenticated user, then atomically:
 *   - inserts the primary pet_owners row
 *   - auto-packs the creator into their own pet's Pack
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

  if (!speciesId && !speciesText) {
    res.status(400).json({ error: "species or speciesId is required" });
    return;
  }

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

    // Primary ownership row — exactly one per pet, created atomically
    await tx
      .insert(petOwnersTable)
      .values({ petId: newPet.id, userId, role: "primary" })
      .onConflictDoNothing();

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
 */
router.get("/pets/:id/pack-members", async (req, res) => {
  const { id } = req.params;

  const [pet] = await db
    .select({ id: petsTable.id })
    .from(petsTable)
    .where(and(eq(petsTable.id, id), isNull(petsTable.deletedAt)))
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
    .orderBy(packFollowsTable.createdAt);

  res.json({ members: rows.map((r) => ({ username: r.username, joinedAt: r.joinedAt })) });
});

/**
 * GET /me/pets
 *
 * Returns all pets the authenticated user owns (primary or co-owner),
 * ordered by the user's addedAt timestamp in pet_owners (oldest first).
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
      role:           petOwnersTable.role,
      recentMediaKey: sql<string | null>`(
        SELECT ${postsTable.mediaKey}
        FROM   ${postsTable}
        WHERE  ${postsTable.petId} = ${petsTable.id}
          AND  ${postsTable.archivedAt} IS NULL
        ORDER  BY ${postsTable.createdAt} DESC
        LIMIT  1
      )`,
    })
    .from(petOwnersTable)
    .innerJoin(petsTable, eq(petsTable.id, petOwnersTable.petId))
    .where(and(eq(petOwnersTable.userId, userId), isNull(petsTable.deletedAt)))
    .orderBy(desc(petOwnersTable.addedAt));

  res.json({
    pets: pets.map((p) => {
      const avatarUrl = p.avatarKey ? mediaTokenUrl(p.avatarKey) : null;
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
        role:         p.role,   // 'primary' | 'co' — useful for UI badges
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
 * Any owner (primary or co) may update profile fields.
 */
router.patch("/pets/:id", async (req, res) => {
  const { id } = req.params;
  const userId  = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [existing] = await db
    .select({ id: petsTable.id })
    .from(petsTable)
    .where(and(eq(petsTable.id, id), isNull(petsTable.deletedAt)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Any owner (primary or co) may edit pet metadata
  if (!(await isPetOwner(userId, id))) {
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
    updates.breedId   = null;
    updates.breed     = null;
  }

  if (breedId !== undefined) {
    if (breedId === null) {
      updates.breedId = null;
      updates.breed   = breed ?? null;
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
    thumbnailUrl: null,
    avatarUrl:    null,
    avatarFocusX: null,
    avatarFocusY: null,
  });
});

/**
 * PATCH /pets/:id/avatar
 *
 * Any owner (primary or co) may update the avatar.
 */
router.patch("/pets/:id/avatar", async (req, res) => {
  const { id } = req.params;
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [pet] = await db
    .select({ id: petsTable.id, ownerId: petsTable.ownerId })
    .from(petsTable)
    .where(and(eq(petsTable.id, id), isNull(petsTable.deletedAt)))
    .limit(1);

  if (!pet) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!(await isPetOwner(userId, id))) {
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
      const ext   = avatarKey.split(".").pop() ?? "jpg";
      const destKey = `avatars/${randomUUID()}.${ext}`;
      await copyObject(avatarKey, destKey);
      storedKey = destKey;
    } else if (avatarKey.startsWith("avatars/")) {
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

/**
 * DELETE /pets/:id
 *
 * Soft-deletes a pet by setting deleted_at = now(). Primary owner only.
 * Posts fall out of all public reads immediately via the isNull(deletedAt)
 * guards on pet joins. A background purge job handles hard-deletion after
 * 30 days (see lib/purgePets.ts).
 *
 * Returns 204 on success.
 */
router.delete("/pets/:id", async (req, res) => {
  const { id }  = req.params;
  const userId  = (req as unknown as { auth: { userId: string } }).auth.userId;

  const [petRow] = await db
    .select({ id: petsTable.id, name: petsTable.name })
    .from(petsTable)
    .where(and(eq(petsTable.id, id), isNull(petsTable.deletedAt)))
    .limit(1);

  if (!petRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!(await isPetPrimaryOwner(userId, id))) {
    res.status(403).json({ error: "Forbidden — only the primary owner may delete a pet" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(petsTable)
      .set({ deletedAt: new Date() })
      .where(eq(petsTable.id, id));
    await writeAudit(tx, userId, "pet.delete", "pet", id, { petName: petRow.name });
  });

  res.status(204).send();
});

export default router;
