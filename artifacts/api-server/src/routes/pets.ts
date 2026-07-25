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
      id: r.id,
      caption: r.caption ?? null,
      mediaKey: r.mediaKey,
      mediaUrl: await presignGet(r.mediaKey),
      isNursery: r.isNursery,
      createdAt: r.createdAt,
      pet: petSummary,
      boopCount: r.boopCount,
      treatCount: r.treatCount,
      commentCount: r.commentCount,
      viewerHasBooped: r.viewerHasBooped,
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

  const { name, species, breed, bio } = parsed.data;

  const [pet] = await db
    .insert(petsTable)
    .values({ ownerId: userId, name, species, breed: breed ?? null, bio: bio ?? null })
    .returning();

  res.status(201).json({
    id:        pet.id,
    ownerId:   pet.ownerId,
    name:      pet.name,
    species:   pet.species,
    breed:     pet.breed ?? null,
    bio:       pet.bio ?? null,
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
