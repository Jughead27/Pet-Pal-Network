/**
 * Idempotent seed + backfill script.
 *
 * Run:  npx tsx src/seed.ts
 *
 * All inserts use ON CONFLICT DO NOTHING — safe to re-run any number of times.
 * After seeding, existing pets whose free-text species/breed match seeded
 * values (case-insensitive) are backfilled with FK IDs so existing display
 * code keeps working unchanged (it reads the text columns, not the FKs).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, isNull, sql } from "drizzle-orm";
import * as schema from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db   = drizzle(pool, { schema });

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED_DATA: { name: string; sortOrder: number; breeds: string[] }[] = [
  {
    name: "Cat",
    sortOrder: 1,
    breeds: [
      // Colloquial coat-types (first-class entries per spec, listed first)
      "Calico", "Tabby", "Tuxedo", "Tortoiseshell",
      "Domestic Shorthair", "Domestic Longhair",
      // CFA/TICA recognized breeds (alphabetical)
      "Abyssinian", "American Bobtail", "American Curl", "American Shorthair",
      "American Wirehair", "Balinese", "Bengal", "Birman", "Bombay",
      "British Longhair", "British Shorthair", "Burmese", "Burmilla",
      "Chartreux", "Chausie", "Colorpoint Shorthair", "Cornish Rex",
      "Devon Rex", "Egyptian Mau", "European Burmese", "Exotic Shorthair",
      "Havana Brown", "Himalayan", "Japanese Bobtail", "Javanese",
      "Khao Manee", "Korat", "Kurilian Bobtail", "LaPerm", "Lykoi",
      "Maine Coon", "Manx", "Munchkin", "Nebelung", "Norwegian Forest Cat",
      "Ocicat", "Oriental Longhair", "Oriental Shorthair", "Persian",
      "Peterbald", "Pixiebob", "Ragamuffin", "Ragdoll", "Russian Blue",
      "Savannah", "Scottish Fold", "Selkirk Rex", "Siamese", "Siberian",
      "Singapura", "Somali", "Sphynx", "Thai", "Tonkinese", "Toyger",
      "Turkish Angora", "Turkish Van",
    ],
  },
  {
    name: "Dog",
    sortOrder: 2,
    breeds: [
      // Popular designer crosses (listed first per spec)
      "Cockapoo", "Labradoodle", "Goldendoodle", "Bernedoodle", "Cavapoo",
      "Maltipoo", "Cavachon", "Puggle", "Pomsky", "Schnoodle", "Yorkipoo",
      "Shihpoo", "Aussiedoodle", "Sheepadoodle",
      "Mixed Breed / Mutt",
      // AKC recognized breeds (alphabetical)
      "Affenpinscher", "Afghan Hound", "Airedale Terrier", "Akita",
      "Alaskan Klee Kai", "Alaskan Malamute", "American English Coonhound",
      "American Eskimo Dog", "American Foxhound", "American Hairless Terrier",
      "American Leopard Hound", "American Staffordshire Terrier",
      "American Water Spaniel", "Anatolian Shepherd Dog",
      "Appenzeller Sennenhund", "Australian Cattle Dog", "Australian Kelpie",
      "Australian Shepherd", "Australian Terrier", "Azawakh",
      "Barbet", "Basenji", "Basset Fauve de Bretagne", "Basset Hound",
      "Bavarian Mountain Scent Hound", "Beagle", "Bearded Collie",
      "Beauceron", "Bedlington Terrier", "Belgian Laekenois",
      "Belgian Malinois", "Belgian Sheepdog", "Belgian Tervuren",
      "Bergamasco Sheepdog", "Berger Picard", "Bernese Mountain Dog",
      "Bichon Frise", "Biewer Terrier", "Black and Tan Coonhound",
      "Black Russian Terrier", "Bloodhound", "Bluetick Coonhound",
      "Boerboel", "Bohemian Shepherd", "Border Collie", "Border Terrier",
      "Borzoi", "Boston Terrier", "Bouvier des Flandres", "Boxer",
      "Boykin Spaniel", "Bracco Italiano", "Braque du Bourbonnais",
      "Briard", "Brittany", "Brussels Griffon", "Bull Terrier",
      "Bulldog", "Bullmastiff",
      "Cairn Terrier", "Canaan Dog", "Cane Corso", "Cardigan Welsh Corgi",
      "Carolina Dog", "Catahoula Leopard Dog", "Caucasian Shepherd Dog",
      "Cavalier King Charles Spaniel", "Central Asian Shepherd Dog",
      "Cesky Terrier", "Chesapeake Bay Retriever", "Chihuahua",
      "Chinese Crested", "Chinese Shar-Pei", "Chinook", "Chow Chow",
      "Cirneco dell'Etna", "Clumber Spaniel", "Cocker Spaniel",
      "Collie", "Coton de Tulear", "Croatian Sheepdog",
      "Dachshund", "Dalmatian", "Dandie Dinmont Terrier",
      "Danish-Swedish Farmdog", "Doberman Pinscher", "Dogo Argentino",
      "Dogue de Bordeaux", "Dutch Shepherd",
      "English Cocker Spaniel", "English Foxhound", "English Setter",
      "English Springer Spaniel", "English Toy Spaniel",
      "Entlebucher Mountain Dog", "Estrela Mountain Dog",
      "Field Spaniel", "Finnish Lapphund", "Finnish Spitz",
      "Flat-Coated Retriever", "French Bulldog",
      "German Pinscher", "German Shepherd Dog", "German Shorthaired Pointer",
      "German Spitz", "German Wirehaired Pointer", "Giant Schnauzer",
      "Glen of Imaal Terrier", "Golden Retriever", "Gordon Setter",
      "Grand Basset Griffon Vendeen", "Great Dane", "Great Pyrenees",
      "Greater Swiss Mountain Dog", "Greyhound",
      "Hamiltonstovare", "Harrier", "Havanese",
      "Ibizan Hound", "Icelandic Sheepdog", "Irish Red and White Setter",
      "Irish Setter", "Irish Terrier", "Irish Water Spaniel",
      "Irish Wolfhound", "Italian Greyhound",
      "Japanese Chin",
      "Karelian Bear Dog", "Keeshond", "Kerry Blue Terrier",
      "Komondor", "Kuvasz",
      "Labrador Retriever", "Lagotto Romagnolo", "Lancashire Heeler",
      "Leonberger", "Lhasa Apso", "Lowchen",
      "Maltese", "Manchester Terrier", "Mastiff",
      "Miniature American Shepherd", "Miniature Bull Terrier",
      "Miniature Pinscher", "Miniature Schnauzer", "Mudi",
      "Neapolitan Mastiff", "Nederlandse Kooikerhondje", "Newfoundland",
      "Norfolk Terrier", "Norwegian Buhund", "Norwegian Elkhound",
      "Norwegian Lundehund", "Norwich Terrier",
      "Nova Scotia Duck Tolling Retriever",
      "Old English Sheepdog", "Otterhound",
      "Papillon", "Parson Russell Terrier", "Pekingese",
      "Pembroke Welsh Corgi", "Perro de Presa Canario",
      "Petit Basset Griffon Vendeen", "Pharaoh Hound", "Plott Hound",
      "Pointer", "Polish Lowland Sheepdog", "Pomeranian",
      "Poodle (Miniature)", "Poodle (Standard)", "Poodle (Toy)",
      "Portuguese Podengo", "Portuguese Podengo Pequeno",
      "Portuguese Water Dog", "Pug", "Puli", "Pumi",
      "Pyrenean Shepherd",
      "Rat Terrier", "Redbone Coonhound", "Rhodesian Ridgeback",
      "Rottweiler", "Russell Terrier",
      "Samoyed", "Schipperke", "Scottish Deerhound", "Scottish Terrier",
      "Sealyham Terrier", "Shetland Sheepdog", "Shiba Inu", "Shih Tzu",
      "Siberian Husky", "Silky Terrier", "Skye Terrier", "Sloughi",
      "Smooth Fox Terrier", "Spanish Water Dog", "Spinone Italiano",
      "St. Bernard", "Staffordshire Bull Terrier", "Standard Schnauzer",
      "Sussex Spaniel", "Swedish Lapphund", "Swedish Vallhund",
      "Tibetan Mastiff", "Tibetan Spaniel", "Tibetan Terrier",
      "Toy Fox Terrier", "Treeing Tennessee Brindle",
      "Treeing Walker Coonhound",
      "Vizsla",
      "Weimaraner", "Welsh Springer Spaniel", "Welsh Terrier",
      "West Highland White Terrier", "Whippet", "Wire Fox Terrier",
      "Wirehaired Pointing Griffon", "Wirehaired Vizsla",
      "Xoloitzcuintli",
      "Yorkshire Terrier",
    ],
  },
  {
    name: "Bird",
    sortOrder: 3,
    breeds: [
      "Parakeet / Budgie", "Cockatiel", "Cockatoo", "Conure", "Lovebird",
      "Canary", "Finch", "Parrotlet", "African Grey", "Macaw",
      "Amazon Parrot", "Quaker Parrot", "Caique", "Dove", "Pigeon",
      "Chicken", "Duck",
    ],
  },
  {
    name: "Fish",
    sortOrder: 4,
    breeds: [
      "Betta", "Crowntail Betta", "Goldfish", "Guppy", "Molly", "Platy",
      "Tetra", "Angelfish", "Cichlid", "Koi", "Pleco", "Corydoras",
      "Discus", "Gourami", "Barb", "Danio",
    ],
  },
  {
    name: "Small Mammal",
    sortOrder: 5,
    breeds: [
      "Hamster", "Guinea Pig", "Ferret", "Rat", "Mouse", "Rabbit",
      "Gerbil", "Chinchilla", "Hedgehog", "Sugar Glider", "Degu",
    ],
  },
  {
    name: "Reptile",
    sortOrder: 6,
    breeds: [
      "Bearded Dragon", "Leopard Gecko", "Crested Gecko", "Corn Snake",
      "Ball Python", "Turtle", "Tortoise", "Iguana", "Chameleon",
      "Anole", "Skink",
    ],
  },
  {
    name: "Amphibian",
    sortOrder: 7,
    breeds: [
      "Axolotl", "Pacman Frog", "Tree Frog", "Dart Frog",
      "Newt", "Salamander", "Toad",
    ],
  },
  {
    name: "Horse",
    sortOrder: 8,
    breeds: [
      "Quarter Horse", "Arabian", "Thoroughbred", "Appaloosa", "Paint",
      "Morgan", "Andalusian", "Clydesdale", "Shetland Pony", "Welsh Pony",
      "Friesian", "Mustang", "Tennessee Walker", "Standardbred", "Percheron",
    ],
  },
  {
    name: "Invertebrate",
    sortOrder: 9,
    breeds: [
      "Tarantula", "Hermit Crab", "Snail", "Mantis", "Scorpion", "Isopod",
    ],
  },
  {
    name: "Other",
    sortOrder: 10,
    breeds: [],
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Additive schema migrations ─────────────────────────────────────────────
  // This script runs during the BUILD phase (prod-post-build.sh).  The
  // Replit Publish flow applies drizzle-kit push during the PROMOTE phase —
  // AFTER the build.  On the first deploy that introduces new columns, those
  // columns therefore do not yet exist when Drizzle generates its SELECT lists
  // (which are explicit, not SELECT *).
  //
  // Guard: run any additive ALTER TABLE … ADD COLUMN IF NOT EXISTS statements
  // here, before the first Drizzle query that touches the affected table.
  // Each statement is idempotent — a no-op on all subsequent deploys.
  //
  // ⚠ Do NOT add DROP, RENAME, or destructive DDL here — those belong
  // exclusively in the PROMOTE-phase drizzle-kit push.
  await pool.query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_crop_x real`);
  await pool.query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_crop_y real`);
  await pool.query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_crop_w real`);
  await pool.query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_crop_h real`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS crop_fill_color text`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS crop_fill_thumb text`);

  // ── Spotlight — additive table + singleton seed (idempotent) ─────────────
  await pool.query(`DO $$ BEGIN
    CREATE TYPE spotlight_mode AS ENUM ('auto', 'manual');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await pool.query(`CREATE TABLE IF NOT EXISTS spotlight_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mode spotlight_mode NOT NULL DEFAULT 'auto',
    pinned_pet_id uuid CONSTRAINT spotlight_state_pinned_pet_id_pets_id_fk
      REFERENCES pets(id) ON DELETE SET NULL,
    set_by_admin_id text CONSTRAINT spotlight_state_set_by_admin_id_users_id_fk
      REFERENCES users(id) ON DELETE SET NULL,
    set_at timestamp,
    updated_at timestamp NOT NULL DEFAULT now()
  )`);
  // Align FK constraint names with the drizzle schema on DBs where the table
  // was created before the names above were explicit (default `_fkey` names).
  // Without this, publishing sees a perpetual rename diff vs. production.
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spotlight_state_pinned_pet_id_fkey') THEN
      ALTER TABLE spotlight_state RENAME CONSTRAINT spotlight_state_pinned_pet_id_fkey TO spotlight_state_pinned_pet_id_pets_id_fk;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spotlight_state_set_by_admin_id_fkey') THEN
      ALTER TABLE spotlight_state RENAME CONSTRAINT spotlight_state_set_by_admin_id_fkey TO spotlight_state_set_by_admin_id_users_id_fk;
    END IF;
  END $$`);
  await pool.query(`INSERT INTO spotlight_state (mode)
    SELECT 'auto' WHERE NOT EXISTS (SELECT 1 FROM spotlight_state)`);
  await pool.query(`INSERT INTO config (key, value)
    VALUES ('spotlight_window_days', '7')
    ON CONFLICT (key) DO NOTHING`);

  // ── Species / breeds — one-time setup, skip when already present ─────────
  // On every deploy after the first, the species table is already populated
  // and every INSERT below would be an ON CONFLICT DO NOTHING no-op.  The
  // no-ops are still hundreds of individual DB round-trips, so we skip the
  // entire block when any species row exists.
  const [speciesCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.speciesTable);

  if ((speciesCountRow?.count ?? 0) === 0) {
    console.log("Seeding species and breeds…");

    for (const { name, sortOrder, breeds } of SEED_DATA) {
      // Insert species (idempotent)
      await db
        .insert(schema.speciesTable)
        .values({ name, sortOrder })
        .onConflictDoNothing();

      const [species] = await db
        .select()
        .from(schema.speciesTable)
        .where(eq(schema.speciesTable.name, name))
        .limit(1);

      if (!species) throw new Error(`Failed to upsert species: ${name}`);

      // Insert breeds (idempotent)
      for (const breedName of breeds) {
        await db
          .insert(schema.breedsTable)
          .values({ speciesId: species.id, name: breedName })
          .onConflictDoNothing();
      }

      console.log(`  ✓ ${name} (${breeds.length} breeds)`);
    }
  } else {
    console.log(`Species/breeds already present (${speciesCountRow?.count} species) — skipping.`);
  }

  // ── Backfill existing pets ──────────────────────────────────────────────
  console.log("Backfilling existing pets…");

  // Only fetch pets that still need backfilling — zero rows returned (and zero
  // loop iterations) once every pet has a speciesId set.
  const pets = await db
    .select()
    .from(schema.petsTable)
    .where(isNull(schema.petsTable.speciesId));
  let backfilledCount = 0;

  for (const pet of pets) {

    // Pass 1: match the free-text species column against a catalogue species name (case-insensitive).
    let matchedSpecies = await db
      .select()
      .from(schema.speciesTable)
      .where(sql`lower(${schema.speciesTable.name}) = lower(${pet.species})`)
      .limit(1)
      .then((r) => r[0] ?? null);

    // Pass 2 (fallback): the free-text species column may hold a *breed* name instead
    // of a species name (e.g. pet.species = "Betta" when the catalogue species is "Fish").
    // Look the value up in the breeds table and infer the parent species from there.
    let speciesTextNeedsSync = false;
    if (!matchedSpecies) {
      const breedRow = await db
        .select({ parentSpeciesId: schema.breedsTable.speciesId })
        .from(schema.breedsTable)
        .where(sql`lower(${schema.breedsTable.name}) = lower(${pet.species})`)
        .limit(1)
        .then((r) => r[0] ?? null);

      if (breedRow) {
        matchedSpecies = await db
          .select()
          .from(schema.speciesTable)
          .where(eq(schema.speciesTable.id, breedRow.parentSpeciesId))
          .limit(1)
          .then((r) => r[0] ?? null);

        // The text column held a breed name — mirror the canonical species name
        // back so display code (which reads the text column) stays correct.
        if (matchedSpecies) speciesTextNeedsSync = true;
      }
    }

    if (!matchedSpecies) continue;

    // Match breed (case-insensitive, only if a breed text exists)
    let matchedBreedId: string | null = null;
    if (pet.breed) {
      const [matchedBreed] = await db
        .select()
        .from(schema.breedsTable)
        .where(
          and(
            eq(schema.breedsTable.speciesId, matchedSpecies.id),
            sql`lower(${schema.breedsTable.name}) = lower(${pet.breed})`,
          ),
        )
        .limit(1);
      matchedBreedId = matchedBreed?.id ?? null;
    }

    await db
      .update(schema.petsTable)
      .set({
        speciesId: matchedSpecies.id,
        breedId:   matchedBreedId,
        // Sync text column when it held a breed name rather than the species name.
        ...(speciesTextNeedsSync ? { species: matchedSpecies.name } : {}),
      })
      .where(eq(schema.petsTable.id, pet.id));

    backfilledCount++;
    console.log(
      `  ✓ ${pet.name} → ${matchedSpecies.name}` +
      (matchedBreedId ? ` / ${pet.breed}` : " (no breed match)") +
      (speciesTextNeedsSync ? ` (species text corrected from "${pet.species}")` : ""),
    );
  }

  console.log(`Backfill complete — ${backfilledCount} pet(s) updated.`);

  // ── Co-ownership backfill ──────────────────────────────────────────────────
  // This seed script runs during the BUILD phase (prod-post-build.sh).
  // Replit applies the schema migration (CREATE TABLE pet_owners …) during the
  // PROMOTE phase — AFTER the build.  So on the very first deploy that
  // introduces pet_owners, the table does not yet exist here.
  //
  // Guard: skip gracefully if the table isn't created yet.  The API server's
  // startup backfill (artifacts/api-server/src/lib/startupBackfill.ts) runs
  // after promotion and handles the actual population on that first deploy.
  // On all subsequent deploys the table exists and the inserts are no-ops
  // (ON CONFLICT DO NOTHING / WHERE IS NULL).
  const petOwnersCheck = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE  table_schema = 'public' AND table_name = 'pet_owners'
    ) AS exists
  `);
  if (petOwnersCheck.rows[0]?.exists) {
    console.log("Backfilling pet_owners primary rows from existing pets…");
    const coOwnerResult = await db.execute(sql`
      INSERT INTO pet_owners (pet_id, user_id)
      SELECT id, owner_id
      FROM   pets
      ON CONFLICT DO NOTHING
    `);
    console.log(`  ✓ pet_owners backfill — ${coOwnerResult.rowCount ?? 0} new row(s) inserted`);

    console.log("Backfilling posts.posted_by_user_id for pre-existing posts…");
    const postsBackfillResult = await db.execute(sql`
      UPDATE posts
      SET    posted_by_user_id = pets.owner_id
      FROM   pets
      WHERE  posts.pet_id = pets.id
        AND  posts.posted_by_user_id IS NULL
    `);
    console.log(`  ✓ posts.posted_by_user_id backfill — ${postsBackfillResult.rowCount ?? 0} row(s) updated`);
  } else {
    console.log("  ℹ pet_owners table not yet created (schema migration pending) — backfill deferred to server startup");
  }

  // ── Auto-pack backfill: every owner gets pack_follows rows for their own pets ──
  // Single INSERT … SELECT instead of N individual round-trips.  ON CONFLICT DO
  // NOTHING makes this a sub-millisecond no-op once all rows already exist.
  console.log("Backfilling pack_follows for existing pet owners…");
  const packResult = await db.execute(sql`
    INSERT INTO pack_follows (user_id, pet_id)
    SELECT owner_id, id FROM pets
    ON CONFLICT DO NOTHING
  `);
  console.log(`  ✓ pack_follows backfill — ${packResult.rowCount ?? 0} new row(s) inserted.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
