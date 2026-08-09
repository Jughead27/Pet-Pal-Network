---
name: RN-web initialScrollIndex is not mount-time
description: Why initialScrollIndex silently lands on the wrong item on web and the verify-and-correct pattern that fixes it
---

**Rule:** On react-native-web, `initialScrollIndex` is NOT applied before first paint. RNW's VirtualizedList fires a one-shot imperative `scrollToIndex` from the list's `onLayout` (guarded by an internal burn-once flag, no retry). If content isn't fully sized at that instant, the browser clamps `scrollTop` short, the flag burns, and the list settles on the wrong item with a visible virtualization "flash-shuffle." Native is fine — RN core positions before paint.

**Why:** Confirmed by decompiling the live pshpsh.net bundle (fix present, bug persisted) and tracing `react-native-web/dist/vendor/react-native/VirtualizedList/index.js` (~line 435: onLayout → scrollToIndex, `_hasTriggeredInitialScrollToIndex`).

**How to apply:** Keep `initialScrollIndex` + fixed-height `getItemLayout` (correct on native, best-effort on web), and layer a WEB-ONLY verify-and-correct loop on the list's `onLayout`: bounded rAF loop that gets `ref.getScrollableNode()`, re-resolves the target index from the item ID against current data each frame, compares `scrollTop` to `idx * itemHeight` (±1px), sets `scrollTop` on mismatch. Refs (not state) for loop inputs. Pass item IDs (never indexes) across grid→pager handoffs. See the Sniff pager in `discovery.tsx` for the reference implementation.

**Three traps confirmed by instrumented repro (mockup-sandbox `PagerRepro.tsx`):**
1. **Never clamp findIndex(-1) to 0 in the loop.** If the target ID is absent from data at check time, expected offset becomes 0, trivially matching scrollTop 0 at mount → false success, loop burns, wrong item. Keep watching (larger total frame cap, ~120) until the target is resolvable.
2. **`pagingEnabled` on web = CSS `scroll-snap-type: y mandatory`.** A correction that jumps beyond the committed render window lands mid-spacer (not a snap point) and the browser yanks it back to the nearest rendered cell edge a few frames later. Suppress snap during landing (`node.style.scrollSnapType = 'none'`), require ~12 consecutive stable frames at the expected offset, then restore (`= ''`) on EVERY exit path.
3. **Guard against stale loops with a monotonic run token** bumped on every pager open/close. A stale tick must restore its own snap node and exit without touching the newer run's done flag — otherwise rapid close/reopen lets the old run kill the new landing.
