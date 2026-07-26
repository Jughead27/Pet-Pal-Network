---
name: expo-router blur listener pattern
description: Why useFocusEffect silently no-ops in tab screens and the correct alternative for blur-triggered resets.
---

# expo-router `useFocusEffect` silent no-op on tabs

## The rule
Never use `useFocusEffect` from `expo-router` for blur-triggered resets on tab screens. Use `navigation.addListener('blur', ...)` via `useNavigation` instead.

**Why:** expo-router's `useFocusEffect` (v6) guards its entire body with `if (!optionalNavigation) return`. `useOptionalNavigation()` returns null during the initial render of a tab screen, so the blur/focus listeners are never registered — the hook is a silent no-op. The bug manifests as blur callbacks never firing even though typecheck passes and no runtime error appears.

**How to apply:** Any tab screen that needs to respond to the user switching away should use:

```tsx
import { useNavigation } from 'expo-router';

const navigation = useNavigation();
useEffect(() => {
  const unsubscribe = navigation.addListener('blur', () => {
    // reset state here
  });
  return unsubscribe;
}, [navigation]);
```

This bypasses the `optionalNavigation` guard and subscribes directly to the navigation event, which fires reliably on every tab switch.

## Applied in
`nursery.tsx` — blur resets `viewMode` to `'grid'` via `closePost()` so re-entering the Nursery tab always shows the grid at the preserved scroll position.
