import { Router, type IRouter } from "express";
import {
  db,
  petsTable,
  postsTable,
  boopsTable,
  treatsTable,
  commentsTable,
  speciesTable,
  breedsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { CreatePetBody } from "@workspace/api-zod";
import { presignGet } from "../lib/r2.js";

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
      cropFocusX: postsTable.cropFocusX,
      cropFocusY: postsTable.cropFocusY,
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

  const posts = await Promise.all(
    rows.map(async (r) => ({
      id:         r.id,
      caption:    r.caption ?? null,
      mediaKey:   r.mediaKey,
      mediaUrl:   await presignGet(r.mediaKey),
      cropFocusX: r.cropFocusX ?? null,
      cropFocusY: r.cropFocusY ?? null,
      isNursery:  r.isNursery,
      createdAt:  r.createdAt,
      pet:        petSummary,
      boopCount:        r.boopCount,
      treatCount:       r.treatCount,
      commentCount:     r.commentCount,
      viewerHasBooped:  r.viewerHasBooped,
      viewerHasTreated: r.viewerHasTreated,
    })),
  );

  res.json({
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? null,
    bio: pet.bio ?? null,
    posts,
  });
});

/**
 * POST /pets
 *
 * Creates a new pet owned by the authenticated user.
 * Validates name (required) and species (required) server-side; returns 400 on failure.
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

  const [pet] = await db
    .insert(petsTable)
    .values({
      ownerId:   userId,
      name,
      species:   resolvedSpecies,
      breed:     resolvedBreed,
      speciesId: speciesId ?? null,
      breedId:   breedId   ?? null,
      bio:       bio       ?? null,
    })
    .returning();

  res.status(201).json({
    id:        pet.id,
    ownerId:   pet.ownerId,
    name:      pet.name,
    species:   pet.species,
    breed:     pet.breed     ?? null,
    speciesId: pet.speciesId ?? null,
    breedId:   pet.breedId   ?? null,
    bio:       pet.bio       ?? null,
    createdAt: pet.createdAt,
  });
});

/**
 * GET /me/pets
 *
 * Returns all pets owned by the authenticated user, ordered by creation time.
 */
router.get("/me/pets", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const pets = await db
    .select()
    .from(petsTable)
    .where(eq(petsTable.ownerId, userId))
    .orderBy(desc(petsTable.createdAt));

  res.json({
    pets: pets.map((p) => ({
      id:        p.id,
      ownerId:   p.ownerId,
      name:      p.name,
      species:   p.species,
      breed:     p.breed ?? null,
      bio:       p.bio ?? null,
      createdAt: p.createdAt,
    })),
  });
});

export default router;
