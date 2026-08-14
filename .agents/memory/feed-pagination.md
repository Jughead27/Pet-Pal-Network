---
name: Feed cursor pagination
description: /feed keyset pagination design, orval infinite-hook wiring, and the invalidation/queryKey + timestamp-precision gotchas.
---

# Feed cursor pagination

/feed (Home, Sniff, Nursery — one endpoint) is keyset-paginated: default 20, max 50, opaque base64url JSON cursor. Fresh order keys on (created_at, id) desc; Popular keys on (7-day score, created_at, id) desc via SQL row comparison in WHERE (sound because aggregates live only in SELECT). Fetch limit+1 as the has-more probe; response includes required nullable `nextCursor`.

**Timestamp precision rule:** never build a keyset cursor from `Date.toISOString()` — Postgres timestamps are microsecond-precision and ms truncation skips rows at page boundaries. Select `to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.US')` per row and cast back with `::timestamp` in the predicate.

**Popular drift:** score changes between page fetches can duplicate/skip a post across pages — accepted tradeoff (live score, no snapshot).

**Orval infinite hooks:** enabled per-operation in orval.config.ts via `override.operations.getFeed.query = { useInfinite: true, useInfiniteQueryParam: "cursor" }`. Generated `useGetFeedInfinite` needed one hand-fix after codegen (like the index-file restores): cast `pageParam as string | undefined` in the generated queryFn or lib typecheck fails.

**queryKey invalidation rule:** the generated infinite key starts with 'infinite', which breaks every existing `invalidateQueries(getGetFeedQueryKey(...))` prefix match. Screens override the key to `[...getGetFeedQueryKey(params), 'infinite']` (prefix FIRST). Keep this pattern for any future infinite hooks.

**Screen conventions:** full-screen snap pagers use `onEndReachedThreshold={2}` and NO footer (a short footer breaks snap alignment); grids use 0.5 + ActivityIndicator footer gated on isFetchingNextPage. Chip-derivation calls (Sniff/Nursery species chips) are NOT paginated — plain useGetFeed with `limit: 50` (they only enumerate species among recent posts). Screens must pass `initialPageParam: undefined` + `getNextPageParam` (react-query v5) — the `as never` cast on query options is known type debt.
