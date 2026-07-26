---
name: FocalImage source-reset + pager renderItem stability
description: Why nursery (and any grid→pager screen) crashed with "Too many re-renders" after the FocalImage retry mechanism was added, and how to prevent it recurring.
---

## The rule

Every pager screen's `renderItem` function **must** be wrapped in `useCallback`. `FocalImage`'s source-reset `useEffect` must depend on a **URI string key**, not the `source` object itself. `FeedPage`'s `heroImage` must be wrapped in `useMemo`.

## Why

The FocalImage retry mechanism (added with stable media URLs) introduced:

```tsx
useEffect(() => {
  setNatural({ w: 0, h: 0 }); // always creates a new object → always schedules re-render
}, [source]);                   // ← was object identity, not URI string
```

`resolveMediaKey()` returns a **new `{uri}` object** on every call, even for the same URI.
`FeedPage` called it inline in the render body (not in `useMemo`).

When `renderItem` is **not** in `useCallback`, every parent re-render (e.g. `onLayout` firing on
the pager container) produces a new function reference → FlatList re-renders all visible items →
FeedPage re-renders → new `heroImage` object → FocalImage sees a new `source` identity →
`useEffect` fires → `setNatural({w:0,h:0})` queues another re-render → repeat.

React's 25-render safety limit was hit, throwing "Too many re-renders", caught by ErrorBoundary.
The home feed was unaffected because its `renderItem` was already in `useCallback`.

## How to apply

1. **`FocalImage.tsx`** — derive a stable `sourceKey` string and use it as the effect dep:
   ```tsx
   const sourceKey =
     typeof source === 'number' ? String(source) : ((source as { uri?: string }).uri ?? '');
   useEffect(() => { setRetries(0); setNatural({ w: 0, h: 0 }); ... }, [sourceKey]);
   ```

2. **`FeedPage.tsx`** — memoize `heroImage`:
   ```tsx
   const heroImage = useMemo(
     () => resolveMediaKey(post.mediaKey, post.mediaUrl),
     [post.mediaKey, post.mediaUrl],
   );
   ```

3. **Any screen with a pager FlatList** — hoist `renderItem` into `useCallback` in the hook
   section (before any conditional returns), not inline inside an `if` block:
   ```tsx
   const renderPagerItem = useCallback(
     ({ item }) => <FeedPage post={item} height={effectivePageHeight} ... />,
     [effectivePageHeight, reducedMotion, openCommentSheet, openShareSheet],
   );
   ```
