---
name: RN-web initialScrollIndex is not mount-time
description: Why initialScrollIndex silently lands on the wrong item on web and the verify-and-correct pattern that fixes it
---

**Rule:** On react-native-web, `initialScrollIndex` is NOT applied before first paint. RNW's VirtualizedList fires a one-shot imperative `scrollToIndex` from the list's `onLayout` (guarded by an internal burn-once flag, no retry). If content isn't fully sized at that instant, the browser clamps `scrollTop` short, the flag burns, and the list settles on the wrong item with a visible virtualization "flash-shuffle." Native is fine — RN core positions before paint.

**Why:** Confirmed by decompiling the live pshpsh.net bundle (fix present, bug persisted) and tracing `react-native-web/dist/vendor/react-native/VirtualizedList/index.js` (~line 435: onLayout → scrollToIndex, `_hasTriggeredInitialScrollToIndex`).

**How to apply:** Keep `initialScrollIndex` + fixed-height `getItemLayout` (correct on native, best-effort on web), and layer a WEB-ONLY verify-and-correct loop: on the list's `onLayout` (web only), run a bounded rAF loop (~30 frames) that gets `ref.getScrollableNode()`, re-resolves the target index from the item ID against current data (reorder-safe), compares `scrollTop` to `idx * itemHeight` (±1px), sets `scrollTop` on mismatch, and marks done only after a re-read confirms it stuck. Refs (not state) for loop inputs. See the Sniff pager in `discovery.tsx` for the reference implementation. Also: pass item IDs (never array indexes) across grid→pager handoffs; resolve the index at mount.
