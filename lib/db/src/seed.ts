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
import { eq, and, sql } from "drizzle-orm";
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

  // ── Backfill existing pets ──────────────────────────────────────────────
  console.log("Backfilling existing pets…");

  const pets = await db.select().from(schema.petsTable);
  let backfilledCount = 0;

  for (const pet of pets) {
    if (pet.speciesId) continue; // already backfilled

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

  // ── Auto-pack backfill: every owner gets pack_follows rows for their own pets ──
  console.log("Backfilling pack_follows for existing pet owners…");
  const allPets = await db.select({ id: schema.petsTable.id, ownerId: schema.petsTable.ownerId }).from(schema.petsTable);
  let packCount = 0;
  for (const pet of allPets) {
    const result = await db
      .insert(schema.packFollowsTable)
      .values({ userId: pet.ownerId, petId: pet.id })
      .onConflictDoNothing();
    // onConflictDoNothing returns rowCount 0 if already existed
    packCount++;
  }
  console.log(`  ✓ Processed ${packCount} pet(s) — owners now in their own Pack.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
