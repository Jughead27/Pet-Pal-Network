---
name: RN-web pager viewport-height instability
description: Pager cells sized from useWindowDimensions on mobile web resize when the browser URL bar collapses/expands, causing scroll-snap to re-commit to a different post mid-scroll.
---

Rule: any full-page pager on web whose cell height = `useWindowDimensions().height` must re-anchor to the current item whenever that height changes — the keyboard is NOT the only trigger; the mobile browser URL bar collapse/expand during normal scrolling changes it too.

**Why:** cells resize while pixel `scrollTop` stays put → position maps to a different index (error scales with scroll depth) → RN-web's mandatory CSS scroll-snap re-commits, appearing as unprompted rapid auto-scroll through many posts. Not reproducible on demand because it depends on browser chrome behavior.

**How to apply:** compute the pre-change index from `round(scrollTop / prevHeight)` (capture prev height in a ref), then arm the existing bounded verify-and-correct rAF loop (snap suppressed, run token, target-ID match) to land on that post at the new height. Skip when the comment sheet is open (keyboard case is handled by restore-on-close) or a restore is already in flight. Companion fix: disable `refetchOnWindowFocus` on the feed query only (orval options require an explicit `queryKey` — pass `getGetFeedQueryKey()`, which matches the generated key so invalidations still hit).
