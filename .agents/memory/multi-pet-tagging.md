---
name: Multi-Pet Tagging Architecture
description: How multi-pet tagging works — post_pets table, ownership rules, notifications, and mobile compose flow.
---

## Core rule
`posts.pet_id` is kept for backward compat (the "primary" pet). `post_pets` is the canonical source for all tagged-pet display and pet-profile post grids.

## Ownership
- Caller must own `petIds[0]` (primary). Additional pets need no ownership check — anyone's pet can be tagged.
- `DELETE /posts/:id/pets/:petId` — only that pet's owner may remove the tag. Returns 400 if it's the last tag.

## Key constraints
- `GET /pets/search` MUST be registered before `GET /pets/:id` in the Express router to avoid `:id = "search"` matching.
- `post_pets` backfill runs in `startupBackfill.ts` via INSERT … ON CONFLICT DO NOTHING for all existing posts.
- Notifications table: lightweight in-app only, type = `pet_tagged`.

## Feed / pets route taggedPets
Both routes add `taggedPetRaw` as a SQL `COALESCE(json_agg(...), '[]'::json)` correlated subquery. The TypeScript post-processing converts `avatarKey` → `avatarUrl` using `mediaTokenUrl`.

**Why:** JSON_AGG in a correlated subquery is cleaner than a GROUP BY join that would inflate rows.

## Pet profile post queries
Changed from `eq(postsTable.petId, id)` to `sql\`EXISTS(SELECT 1 FROM post_pets pp WHERE pp.post_id = ... AND pp.pet_id::text = ...)\`` so tagged posts appear in a pet's profile grid even when that pet isn't the primary.

## Mobile compose (add.tsx)
- `selectedPetIds: Set<string>` (plural) — own pets toggle, others' pets come from `useSearchPets`.
- Own pets go first in `petIds[]` to ensure `petIds[0]` is caller-owned.
- `hasOwnPetSelected` guards submit and "choose a pet" hint.

## api-zod index.ts
Only export from `./generated/api` — the generated `types/` directory has duplicate TypeScript interfaces that conflict with the zod schema exports in api.ts.
