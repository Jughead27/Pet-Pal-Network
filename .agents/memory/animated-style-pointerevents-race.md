---
name: Animated style pointerEvents race (RN-web)
description: Never put pointerEvents inside an Animated.View's animated style array — web JS driver rewrites the flattened style per frame and can re-apply a stale value.
---

Rule: `pointerEvents` must never live in the same style array as an animated value (e.g. opacity) on an `Animated.View`.

**Why:** On web, `useNativeDriver` falls back to the JS driver, which rewrites the FULL flattened style every animation frame. A state change to pointerEvents ('none' → 'box-none') races the in-flight frames; a late frame re-applies the stale 'none', leaving the element visible but untappable until hard refresh. Bit the feed pager's ActionRail/pet-info chrome toggle (visible rail, dead boop/treat/comment buttons). Native is unaffected (native driver doesn't touch the style bag).

**How to apply:** Put `pointerEvents="box-none"` as a plain prop on the outer Animated.View (so it stays pass-through when hidden), and toggle interactivity via a plain inner `<View pointerEvents={visible ? 'box-none' : 'none'}>` wrapper. The Animated.View animates opacity only. Both halves matter: without the outer box-none, the invisible overlay's rectangle blocks taps to the media Pressable underneath.
