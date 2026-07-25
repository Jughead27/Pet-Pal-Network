---
name: Write Reactions Architecture
description: Boop/treat/comment POST endpoints, viewer flags seeded from server, daily treat limit pattern, orval codegen duplicate-export gotcha.
---

## Viewer flags in SQL
Feed and pets routes add `viewerHasBooped` / `viewerHasTreated` to the GROUP BY query via:
```sql
coalesce(bool_or(<table>.user_id = $userId), false)
```
Drizzle: `sql<boolean>\`coalesce(bool_or(${boopsTable.userId} = ${userId}), false)\``
Works correctly with LEFT JOINs: NULL rows produce false via coalesce.

## Daily treat limit
Config table key: `daily_treat_limit` (text). Server defaults to 5 if row is absent.
Limit check + insert done in a single `db.transaction`. Self-treat (403) checked BEFORE the transaction (it's a permanent condition).
Error shapes: `{ error: "self_treat" }` 403, `{ error: "treat_limit_reached" }` 429.

## Feed response shape changed
GET /feed now returns `{ posts: FeedPost[], viewer: { treatsRemainingToday: number } }` (was `FeedPost[]`).
index.tsx seeds AppContext via `data.posts[0]` and `data.viewer.treatsRemainingToday`.

## AppContext changes
Removed: `comments[]`, `addComment`, `hasBoopedOnce`, `hasTreatedOnce`, `treat()`.
Added: `viewerHasBooped`, `viewerHasTreated`, `treatsRemainingToday`, `onTreatSuccess(count, remaining)`, `onCommentPosted()`.
`initFromServer` now takes 6 args: boops, treats, commentCount, viewerHasBooped, viewerHasTreated, treatsRemainingToday.

## ActionRail treat flow
Treat is server-confirmed. Mutation `useTreatPost({ id: postId })`. Gold state/count only update via `onTreatSuccess` in onSuccess.
Bone shake uses `Animated.timing` sequence on `treatShakeX`. Transient message uses `Animated.Value` opacity sequence.
`isTreatPending` ref guards against duplicate rapid taps.
`onTreatFired` (spawns Yum! pop) called ONLY from mutation onSuccess.

## Comment flow
`useCreateComment({ id, data: { text } })`. On success: `queryClient.setQueryData(getGetPostCommentsQueryKey(postId), ...)` appends returned `PostComment`. Then `onCommentPosted()` bumps `serverCommentCount` in AppContext.

## TypeScript cast for req.auth
Express `Request` type doesn't overlap `{ auth: ... }`. Must double-cast:
```ts
const userId = (req as unknown as { auth: { userId: string } }).auth.userId;
```

## Orval codegen / index.ts gotcha
Running `pnpm --filter @workspace/api-spec run codegen` APPENDS export lines to `lib/api-client-react/src/index.ts` if they don't exist yet — resulting in duplicates if the file already had them. Metro fails with "Unable to resolve" when duplicates are present. Fix: manually restore index.ts to the single set of exports after codegen if duplicates appear.

**Why:** Orval's `input.override.mutator` uses an `indexFiles` option that checks for the exports and appends if missing — but with single vs double quotes it doesn't detect them as duplicates.
