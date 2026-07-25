---
name: Pack Follows Architecture
description: How pack follows (user → pet) are stored, served, and kept consistent across the feed UI.
---

# Pack Follows Architecture

## DB schema
`pack_follows(user_id TEXT, pet_id UUID, created_at, UNIQUE(user_id, pet_id))`. Indexed on both columns individually. `pet_id` has ON DELETE CASCADE.

## Auto-pack rule
`POST /pets` creates the pet AND inserts `pack_follows(owner, newPet)` in a single `db.transaction`. Owner always starts in their own Pack. Backfill via seed script covers existing pets.

## API surface
- `POST /pets/:id/pack` — idempotent join (`INSERT … ON CONFLICT DO NOTHING`). Returns `PackResult { packCount, viewerInPack: true }`.
- `DELETE /pets/:id/pack` — idempotent leave. Returns `PackResult { packCount, viewerInPack: false }`.
- `GET /pets/:id` — returns `packCount` and `viewerInPack` on `PetProfile`.
- `GET /feed` — returns `viewerInPack` on each `PetSummary` (correlated EXISTS subquery, no extra JOIN).

**Why:** Adding pack_follows as a LEFT JOIN to the feed GROUP BY query is tricky; a correlated `EXISTS` avoids touching the GROUP BY.

## Cross-post consistency (feed)
`PackContext` (replaces AppContext) stores `Record<petId, boolean>`. All `AddToPackLink` instances for the same pet read `packMap[petId] ?? initialInPack`. On toggle:
1. Optimistic: `setPackState(petId, next)` — all instances for that petId update immediately.
2. Mutation fires.
3. Success: sync from server result. Error: revert.

A `useEffect` in `AddToPackLink` watches `isInPack` and syncs the `Animated.Value` for instances that didn't trigger the mutation (so following Finn from post A immediately animates posts B and C active).

**Why:** A full feed refetch after every pack toggle is too expensive; React Query cache patching is fragile; PackContext is the lightest correct solution.

## AppContext removal
AppContext (`isInPack`, `togglePack`) deleted entirely. `AppProvider` replaced by `PackProvider` in `_layout.tsx`. File deleted.

## Metro cache issue after orval codegen
After every orval run, Metro can't resolve `./generated/api` from the stale module graph — restart the mobile workflow to clear Metro's cache. This is a known Metro behavior with monorepo symlinked packages after file regeneration.

## Pack count on profile page
`pet/[id].tsx` keeps `localPackCount` state initialized from `pet.packCount`. `AddToPackLink`'s `onSuccess` callback updates it with the server-confirmed count from `PackResult`.
