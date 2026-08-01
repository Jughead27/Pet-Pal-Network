---
name: Pet Delete Architecture
description: Soft-delete pets via deletedAt; isNull guards on all pet reads; purge job for hard-delete after 30 days; mobile confirm modal.
---

## Rule
Pets are soft-deleted by setting `deletedAt = now()` on the `petsTable` row. All public reads must filter `isNull(petsTable.deletedAt)`. Hard-delete after 30 days via `purgeSoftDeletedPets()` — the function exists but has no scheduled trigger yet.

**Why:** Immediate hard-delete would orphan R2 media and break any in-flight client references. The 30-day grace period also allows accidental-delete recovery if needed in the future.

**How to apply:**
- Any new route that joins or selects from `petsTable` must include `isNull(petsTable.deletedAt)` in the WHERE clause.
- Mirrors the `archivedAt` pattern on `postsTable`.
- `DELETE /pets/:id` is primary-owner-only (uses `isPetPrimaryOwner`). Co-owners get 403.
- Audit-logged as `"pet.delete"` with `{ petName }` metadata.

## Guards added (as of this session)
- `GET /pets/:id` — existence check WHERE
- `GET /pets/:id/pack-members` — existence check WHERE
- `GET /me/pets` — join WHERE (alongside `eq(petOwnersTable.userId, userId)`)
- `PATCH /pets/:id` — existence check WHERE
- `PATCH /pets/:id/avatar` — existence check WHERE
- `GET /feed` — added `isNull(petsTable.deletedAt)` alongside `isNull(postsTable.archivedAt)`

## Purge job
- `artifacts/api-server/src/lib/purgePets.ts` — `purgeSoftDeletedPets(): Promise<{ purged: number }>`
- Deletes in order: comments/boops/treats → posts → pack_follows/petOwnerInvites/petOwners → pets
- Best-effort R2 cleanup after transaction (skips `seed:*` keys)
- NO scheduler hooked up yet (Task #5 covers this)

## Mobile UI (`artifacts/mobile/app/pet/edit.tsx`)
- "delete this pet" quiet Button below a hairline divider, separated from Save/Cancel
- Confirm Modal: fade animation, semi-transparent overlay
  - 0 posts: "this removes their profile. this can't be undone."
  - N>0 posts: "this removes their profile and all {N} posts. this can't be undone."
  - `totalPosts = pet.posts.length + pet.archivedPosts.length`
  - Delete button: `variant="primary"` (hairline, no fill) with "delete" in Inter_600SemiBold + pet name in Inter_500Medium
  - On success: invalidates getMyPets + getFeed + getMyFollows, navigates to `/(tabs)/profile`
- Hook: `useDeletePet` from `@workspace/api-client-react` with `{ id: petId }`

## Schema
- `deletedAt: timestamp("deleted_at")` added to `lib/db/src/schema/pets.ts`
- Nullable — existing pets remain valid (no backfill needed)
