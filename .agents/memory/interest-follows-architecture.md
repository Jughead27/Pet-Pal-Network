---
name: Interest Follows Architecture
description: Species/breed interest follows — schema, API, context, chips, and profile manage list.
---

# Interest Follows Architecture

## DB schema
`interest_follows(id UUID PK, user_id TEXT FK→users, species_id UUID? FK→species, breed_id UUID? FK→breeds, created_at)`.
CHECK constraint: `(species_id IS NOT NULL)::int + (breed_id IS NOT NULL)::int = 1` — exactly one FK set.
Partial unique indexes: `(user_id, species_id) WHERE species_id IS NOT NULL` and `(user_id, breed_id) WHERE breed_id IS NOT NULL`.
Individual indexes on user_id, species_id, breed_id.

Drizzle v0.45 syntax for partial unique index:
```ts
uniqueIndex("name").on(t.userId, t.speciesId).where(sql`${t.speciesId} IS NOT NULL`)
```

**Why:** Partial indexes handle the CHECK constraint's exclusivity at the DB level — a simple UNIQUE(user_id, species_id) fails because NULLs are not equal.

## API surface
- `POST /follows/species/:id` — idempotent insert + verify species exists → `{ viewerFollows: true }`
- `DELETE /follows/species/:id` — idempotent delete → `{ viewerFollows: false }`
- `POST /follows/breeds/:id` — idempotent insert + verify breed exists → `{ viewerFollows: true }`
- `DELETE /follows/breeds/:id` — idempotent delete → `{ viewerFollows: false }`
- `GET /me/follows` → `{ packedPets, followedSpecies, followedBreeds }` — three parallel queries
- `GET /pets/:id` extended: now returns `speciesId`, `breedId`, `viewerFollowsSpecies`, `viewerFollowsBreed` (nullable booleans; null when pet has no catalogue FK)

## Cross-screen consistency
`FollowsContext` (alongside PackContext in `_layout.tsx`) stores `speciesMap: Record<id, boolean>` and `breedMap: Record<id, boolean>`. Components derive state as `speciesMap[id] ?? serverValue` — same pattern as PackContext for pack follows.

Toggling from a pet profile immediately updates all mounted instances (e.g., unfollowing Calico from Profile → chips on Ripley's profile reflect the change without refetch).

## Mobile UI

**InterestChip** — pure animated presentation chip. Parent derives `followed` from FollowsContext. Animation fires in `useEffect` when `followed` changes. No internal optimistic logic — parent owns all state transitions.

**Pet profile chips** — species/breed text replaced by `<InterestChip>` pills when `speciesId`/`breedId` are non-null. Pending ref guards against double-tap during in-flight mutation. Legacy pets (no catalogue FK) fall back to plain text.

**Profile → Following section** — `useGetMyFollows()` populates three sub-lists (Pets in Pack, Species, Breeds). Each has an unfollow affordance (`FollowRow` component). After mutation success, invalidates `getGetMyFollowsQueryKey()` and updates context. Packed pet rows are also tappable to navigate to the pet profile.

## tsc --build incremental miss after orval codegen
After orval regenerates `lib/api-client-react/src/generated/api.ts`, `tsc --build` (incremental) sometimes misses the rebuild and the dist/.d.ts files stay stale. Mobile typecheck then fails because it reads from dist (project references).

**Fix:** Run `npx tsc --build --force` at the workspace root to force-rebuild all project references, then re-run typechecks.

**Why:** Incremental builds compare timestamps/hashes. If the orval output technically has the same modification timestamp as the previous build (fast codegen), tsc skips the rebuild.
