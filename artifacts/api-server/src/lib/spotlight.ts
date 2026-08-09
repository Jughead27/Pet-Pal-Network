/**
 * Spotlight resolution — which pet is featured on the Sniff screen.
 *
 * mode='manual' → the admin-pinned pet (falls back to auto if the pinned pet
 *                 no longer exists / is soft-deleted).
 * mode='auto'   → the pet whose posts received the most treats over the last
 *                 spotlight_window_days (config, default 7). Ties broken by
 *                 most-recent-treat-first, then pet id (stable).
 *
 * The public payload NEVER includes treat counts or rank — the selection
 * criterion is invisible by design (not a leaderboard).
 */

import { db, configTable, spotlightStateTable, petsTable, postsTable } from "@workspace/db";
import { and, eq, sql, isNull } from "drizzle-orm";
import { activePets } from "./petQueries.js";
import { mediaTokenUrl } from "./r2.js";

export interface SpotlightPet {
  id:            string;
  name:          string;
  species:       string;
  coverPhotoUrl: string | null;
}

export async function getSpotlightWindowDays(): Promise<number> {
  const [row] = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "spotlight_window_days"));
  const parsed = row ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

/** Fetch a public pet summary (active pets only). Null if missing/deleted. */
async function petSummary(petId: string): Promise<SpotlightPet | null> {
  const [pet] = await db
    .select({
      id:        petsTable.id,
      name:      petsTable.name,
      species:   petsTable.species,
      avatarKey: petsTable.avatarKey,
      recentMediaKey: sql<string | null>`(
        SELECT ${postsTable.mediaKey}
        FROM   ${postsTable}
        WHERE  ${postsTable.petId} = ${petsTable.id}
          AND  ${postsTable.archivedAt} IS NULL
          AND  ${postsTable.hiddenByAdmin} = false
        ORDER  BY ${postsTable.createdAt} DESC
        LIMIT  1
      )`,
    })
    .from(petsTable)
    .where(and(eq(petsTable.id, petId), activePets));

  if (!pet) return null;
  const coverKey = pet.avatarKey ?? pet.recentMediaKey;
  return {
    id:            pet.id,
    name:          pet.name,
    species:       pet.species,
    coverPhotoUrl: coverKey ? mediaTokenUrl(coverKey) : null,
  };
}

/** The current singleton state row (creates none — seed guarantees one). */
export async function getSpotlightState() {
  const [state] = await db.select().from(spotlightStateTable).limit(1);
  return state ?? null;
}

/** Auto resolution — top treated pet in the window, or null when no treats. */
export async function resolveAutoSpotlightPetId(windowDays: number): Promise<string | null> {
  const [top] = await db
    .select({
      petId: postsTable.petId,
      treatCount: sql<number>`count(*)::int`,
      lastTreatAt: sql<string>`max(t.created_at)`,
    })
    .from(sql`treats t`)
    .innerJoin(postsTable, sql`${postsTable.id} = t.post_id`)
    .innerJoin(petsTable, eq(petsTable.id, postsTable.petId))
    .where(and(
      sql`t.created_at >= now() - make_interval(days => ${windowDays})`,
      isNull(postsTable.archivedAt),
      eq(postsTable.hiddenByAdmin, false),
      activePets,
    ))
    .groupBy(postsTable.petId)
    .orderBy(
      sql`count(*) desc`,
      sql`max(t.created_at) desc`,
      sql`${postsTable.petId} asc`,
    )
    .limit(1);

  return top?.petId ?? null;
}

/** Full resolution per the spec. Null → Sniff renders no banner. */
export async function resolveSpotlightPet(): Promise<SpotlightPet | null> {
  const state = await getSpotlightState();

  if (state?.mode === "manual" && state.pinnedPetId) {
    const pinned = await petSummary(state.pinnedPetId);
    if (pinned) return pinned;
    // Pinned pet vanished (deleted) — fall through to auto rather than erroring.
  }

  const windowDays = await getSpotlightWindowDays();
  const autoPetId  = await resolveAutoSpotlightPetId(windowDays);
  if (!autoPetId) return null;
  return petSummary(autoPetId);
}
