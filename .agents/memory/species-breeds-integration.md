---
name: Species + Breeds Integration
description: Architecture decisions, known pitfalls, and patterns from the species/breeds catalogue feature.
---

# Species + Breeds Integration

## Schema
- `speciesTable` and `breedsTable` live in `lib/db/src/schema/species.ts`; both are exported from the schema index.
- `petsTable` gains nullable `speciesId` and `breedId` FK columns; legacy `species` (not null) and `breed` (nullable) text columns are kept unchanged — all existing display code reads text columns only.
- When FKs are set, the server mirrors FK names into text columns so display code needs no changes.

## Dist rebuild requirement
After any schema change in `lib/db/src/schema/`, run `pnpm run typecheck:libs` (root) to rebuild the dist `.d.ts` files. The api-server uses the dist types, not the source directly. Skipping this causes "no exported member 'X'" TypeScript errors in api-server.

**Why:** Project references (`tsc --build`) compile `lib/db` to `lib/db/dist/`. The api-server's tsconfig picks up types from there.

## api-zod index.ts rule
`lib/api-zod/src/index.ts` must export ONLY from `./generated/api`. Exporting from `./generated/types` (a directory orval generates for TypeScript interfaces) causes duplicate-export collisions with the zod schemas.

**Why:** Orval generates zod schemas in `generated/api.ts` and TypeScript interfaces in `generated/types/`. Both export the same names. Only the zod schemas are needed.

## useGetSpeciesByIdBreeds — enabled pattern
TanStack Query v5 `UseQueryOptions` requires `queryKey` when passed as an object. Do NOT pass `{ query: { enabled: bool } }` directly to the hook — TypeScript will reject it.

Correct pattern:
```tsx
import { useQuery } from '@tanstack/react-query';
import { getGetSpeciesByIdBreedsQueryOptions } from '@workspace/api-client-react';

const { data } = useQuery({
  ...getGetSpeciesByIdBreedsQueryOptions(speciesId ?? ''),
  enabled: !!speciesId,
});
```

## Seed script
Run with: `cd lib/db && pnpm exec tsx src/seed.ts`
Requires `tsx` as a dev dep in `lib/db` — not present by default.
Script is idempotent (`ON CONFLICT DO NOTHING`). Backfill logic joins on `lower(name) = lower(free_text)`.

## "Not listed" breed path
Free-text breeds (user's "Not listed — enter my own" input) are stored in the legacy `breed` text column with `breedId = null`. These are future candidates for the admin-moderated breed queue — they accumulate but are not automatically added to the `breeds` table.

## POST /pets server logic
- At least one of `speciesId` (FK) or `species` (text) must be present (server validates).
- When `speciesId` is provided, server looks up the name and overwrites any client-supplied `species` text — server is authoritative for FK-resolved names.
- Same for `breedId` → `breed` text field.
