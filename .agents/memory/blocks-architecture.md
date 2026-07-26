---
name: Blocks Architecture
description: User blocking — schema, centralized exclusion helper, API, and UI surfaces.
---

## Rule
All public content reads use the centralized helpers from `artifacts/api-server/src/lib/excludeBlocked.ts`.
**Never inline block logic per-route** — import the helper so future surfaces inherit it automatically.

**Why:** App Store guideline 1.2. Symmetric: if A blocked B, neither sees the other's content.

## How to apply
- Post-context queries: import `notBlockedPostOwner(viewerId)` — requires `petsTable` inner-joined.
- Comment-context queries: import `notBlockedCommentAuthor(viewerId)` — requires `commentsTable` in scope.
- New feed/list surface: add `notBlockedPostOwner(userId)` to the `.where()` AND clause.
- Pet profile (GET /pets/:id): block checked at the handler level (one query) → returns `posts: []`.

## Key files
- Schema: `lib/db/src/schema/blocks.ts` — `blocksTable` with UNIQUE(blocker_id, blocked_id) + FK→users both ways
- Helper: `artifacts/api-server/src/lib/excludeBlocked.ts` — `notBlockedPostOwner`, `notBlockedCommentAuthor`
- Route: `artifacts/api-server/src/routes/blocks.ts` — POST /blocks, DELETE /blocks/:userId, GET /blocks
- ReportFlow: `artifacts/mobile/components/ReportFlow.tsx` — `ownerUserId` prop; "block this owner" whisper in done step
- Pet profile: `artifacts/mobile/app/pet/[id].tsx` — `BlockOwnerWhisper` local component, non-owner only
- Profile tab: `artifacts/mobile/app/(tabs)/profile.tsx` — "Blocked Owners" section with `useQuery` + `handleUnblock`

## Data flow for ownerUserId
- Feed posts: `ownerId` added to `pet` object in feed.ts response; read via `(post.pet as any).ownerId` in mobile.
- Comments: `authorId` added to comment rows in posts.ts comments response; read via type assertion.
- Pet profile: `ownerId` added to GET /pets/:id response JSON; read via `(pet as any).ownerId`.
  None of these fields are in the api-zod generated types — always use type assertions.

## Double-block
Unique constraint (blocker_id, blocked_id) fires code 23505. Route catches it → 200 `{ ok: true, duplicate: true }`.

## Unblock
DELETE /blocks/:blockedUserId — idempotent 204 even if no block exists.
Profile tab refetches `['my-blocks']` query after each unblock.
