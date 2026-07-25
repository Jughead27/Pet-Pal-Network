---
name: Write Reactions Architecture
description: Boop/treat/comment POST endpoints, per-page state isolation in paged feed, pop anchoring, daily treat limit, orval codegen duplicate-export gotcha.
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
Limit check + insert done in a single `db.transaction`. Self-treat (403) checked BEFORE the transaction.
Error shapes: `{ error: "self_treat" }` 403, `{ error: "treat_limit_reached" }` 429.

## Feed response shape
GET /feed returns `{ posts: FeedPost[], viewer: { treatsRemainingToday: number } }`.

## AppContext — stripped to isInPack/togglePack only
Per-post reaction state (boopCount, treatCount, commentCount, viewerHasBooped, viewerHasTreated) lives in each FeedPage component, not in AppContext. AppContext now only holds `isInPack` / `togglePack`.

## Paged feed architecture (FeedPage + index.tsx)
- `index.tsx`: FlatList with `pagingEnabled`, `snapToInterval={pageHeight}`, `decelerationRate="fast"`, `windowSize={3}`. Page height measured via `onLayout` on the wrapper View.
- `FeedPage.tsx`: one full-screen page per post. Manages its own boop/treat/comment counts, viewerHasBooped/viewerHasTreated, chrome toggle, double-tap, and pop animations. Initialized from `post.boopCount` etc. — not re-initialized on prop changes.
- CommentSheet and ShareSheet are lifted to index.tsx (outside FlatList) with `scrollEnabled={commentConfig === null && !shareOpen}` on the FlatList for web compat.
- CommentSheet receives `onCommentPosted?: () => void` prop (instead of AppContext call); each FeedPage provides its own closure.

## ActionRail — props-based counts
Counts and viewer flags received as props from FeedPage (not from AppContext). Callbacks: `onBoopOptimistic()` and `onTreatSuccess(newCount, remaining)`. Double-tap boop in FeedPage and button boop in ActionRail are independent mutation instances (both call `useBoopPost`) — fine since boops are unlimited.

## Pop text anchoring
Pops spawn at `right: 175` — left of the rail column (right: 14–54) AND left of the treat countdown transient label (right: 50–170). Bottom offsets: BOOP at `bottomOffset + 210`, TREAT at `bottomOffset + 143` (align with icon heights).

## TypeScript cast for req.auth
Must double-cast: `(req as unknown as { auth: { userId: string } }).auth.userId`

## Orval codegen / index.ts gotcha
Running codegen APPENDS export lines to `lib/api-client-react/src/index.ts` if not detected (single vs double quotes bypass its dupe check) → duplicates → Metro "Unable to resolve". Fix: manually restore index.ts to a single set of exports after codegen.
