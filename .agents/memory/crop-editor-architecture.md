---
name: CropEditor Architecture
description: Unified crop/frame editor replacing CropFramer (avatar) and FrameRefiner (compose); avatar WYSIWYG fix via DB crop rect columns.
---

## The component: CropEditor.tsx

Location: `artifacts/mobile/components/CropEditor.tsx`

Model: **fixed crop window, image pans/zooms underneath** (Instagram model).
- `targetAspect` prop drives the crop window shape — compose passes `feedAspect`, avatar passes `columnWidth / HERO_HEIGHT`.
- `hideModetoggle` — hides the Crop/Fit toggle; always true for avatar.
- `cancelIcon` — 'back' (←) or 'cancel' (×); avatar uses 'back'.
- Returns `CropRect` (0–1 fractions of natural image) + mode via `onConfirm`.

### Gesture layer (current: RNGH + Reanimated)

Uses **react-native-gesture-handler** `GestureDetector` + **react-native-reanimated** shared values.
Both packages were already installed (`rngh@2.28.0`, `reanimated@4.1.7`).
`GestureHandlerRootView` is already in `app/_layout.tsx` — no additional setup needed.
`babel-preset-expo` in Expo 54 includes the Reanimated worklet transform automatically — **no babel.config.js change needed**.

- **Pan**: `Gesture.Pan().minPointers(1).maxPointers(1)` — single-finger drag, all directions.
- **Pinch**: `Gesture.Pinch()` — two-finger zoom toward the focal midpoint. Uses `onStart` (not `onBegin`) to capture initial focalX/focalY once both fingers are tracked.
- **Composed**: `Gesture.Simultaneous(pan, pinch)` — maxPointers(1) on Pan makes them naturally exclusive by finger count; no conflict logic needed.
- **Animated image**: `Animated.Image` from `react-native-reanimated` + `useAnimatedStyle` — runs on UI thread (no JS-bridge jank).
- **Shared values**: `scale`, `offsetX`, `offsetY` for live state; `savedScale/X/Y`, `pinchFocalX/Y` for gesture-base; layout constants (`cropWV`, `cropHV`, `minSV`, `maxSV`, etc.) updated in `useEffect` so worklets can read current geometry.
- **Web wheel**: native `wheel` listener writes directly to shared values (JS thread write is fine in Reanimated v4).
- **Safari pinch fix**: `gesturestart` + `gesturechange` non-passive listeners calling `preventDefault()` — required because Safari ignores `touch-action:none` for pinch at the OS level.

### replit.md rule exception

`replit.md` has a "NO react-native-reanimated imports" rule (the package is a peer dep). CropEditor is the **explicit approved exception** — user approved direct import of both reanimated and gesture-handler in this component.

### Worklet-safe helpers

`clamp` and `clampOffset` have `'worklet'` directive — callable from both UI thread (gesture callbacks) and JS thread (useEffect re-clamp, wheel handler). `stateToRect` and `rectToState` are JS-thread only.

### Key geometry helpers
- `clampOffset(ox, oy, scale, cropW, cropH, nw, nh)` — prevents image being pulled off the crop window (no gaps). Takes scalars not an object (minimises worklet allocation).
- `stateToRect(scale, offset, cropW, cropH, nw, nh)` → CropRect for confirm.
- `rectToState(rect, cropW, cropH, nw, nh, minScale, maxScale)` → initial scale+offset from an existing CropRect.

### Zoom range
`minScale = max(cropW/naturalWidth, cropH/naturalHeight)` (just covers the crop window)
`maxScale = minScale * 8` (8× range)

### Orientation/resize handling
`useEffect` on `[minScale, maxScale, cropW, cropH, cropCX, cropCY]` syncs layout shared values and re-clamps state after orientation flip or window resize.

---

## WYSIWYG fix for avatar

**Problem:** CropFramer saved `focusX/focusY` (legacy focal-point). FocalImage's focal-point formula is aspect-dependent — it renders differently in containers with different widths (e.g., `screenW` in the editor vs `columnWidth` in the profile hero on web).

**Fix:** Add crop rect columns to the `pets` table and save the rect instead.

### DB schema added (nullable reals)
```
avatar_crop_x, avatar_crop_y, avatar_crop_w, avatar_crop_h
```
Migration: `ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_crop_x real` (×4).
These guards live at the top of `main()` in `lib/db/src/seed.ts` — required because seed runs in BUILD phase before drizzle-kit push (PROMOTE phase).

### API changes (additive)
- `PATCH /pets/:id/avatar` body: new optional `cropX, cropY, cropW, cropH` fields.
- `GET /pets/:id` and `GET /api/me/pets` responses: include `avatarCropX/Y/W/H`.
- `focusX/focusY` kept for backward compat; new avatar saves send `focusX: null, focusY: null, cropX: ..., cropY: ...`.

### OpenAPI schemas updated
`PetProfile`, `AvatarPatchBody`, `AvatarPatchResponse`, `Pet` schemas all have new crop rect fields.

### Hero avatar rendering (pet/[id].tsx)
FocalImage now receives `cropX/Y/W/H` from `pet.avatarCropX/Y/W/H ?? null`. FocalImage uses the rect branch when crop fields are non-null; falls back to legacy focal-point cover for older avatars (null).

---

## handleAvatarFrameConfirm signature

Changed from `(focusX, focusY)` → `(rect: CropRect, _mode: 'cover' | 'contain')`.
Sends `{ avatarKey, focusX: null, focusY: null, cropX: rect.x, cropY: rect.y, cropW: rect.w, cropH: rect.h }`.

**Why:** `_mode` is discarded because avatar is always cover; mode toggle is hidden.

---

## Aspect-ratio picker (compose only)

`showAspectPicker` prop (bool, default false). When true, CropEditor manages `activeAspect` state internally and ignores `targetAspect` for crop-window sizing.

Three fixed options: `1:1`, `4:5`, `Original` (naturalWidth/naturalHeight).  
Smart default: landscape photo (ratio > 1) → Original; portrait/square → 4:5.

Control: row of text labels (`TouchableOpacity`) floating 10px below the crop-frame border inside a dark pill scrim (`rgba(0,0,0,0.45)` background, `borderRadius:20`, `paddingHorizontal:16`, `paddingVertical:6`). Active label at full opacity + semibold; inactive at 45% opacity.

Ratio change (`handleAspectChange`): primes all shared values immediately (cropWV/cropHV/minSV/maxSV + scale/offset) before `setActiveAspect`, so worklets have correct geometry without waiting for re-render. Resets to minScale, centered.

**Why:** `targetAspect` stays required (avatar uses it as a lock); `showAspectPicker=true` overrides it for compose. The `useEffect` sync is a no-op after `handleAspectChange` since shared values are already primed.

## Avatar: NOT 1:1 square

Avatar CropEditor uses `targetAspect={columnWidth / HERO_HEIGHT}` — the full-width profile hero banner aspect (wide rectangle). Spec assumed "1:1 square" which does not apply to this app. Avatar stays locked at hero-banner aspect. No picker.

## Compose integration (add.tsx)

`FrameRefiner` replaced by `CropEditor` with `targetAspect={feedAspect}` and `showAspectPicker`.
`handleRefineConfirm(rect, mode)` signature unchanged — CropEditor's `onConfirm` matches it exactly.

---

---

## Feed / Preview WYSIWYG rendering (FocalImage)

**Problem (pre-existing, surfaced by ratio picker):** FocalImage `mode='cover'` + cropRect used *rect-driven cover* (`scale = max(cw/cropPxW, ch/cropPxH)`), which scales the crop rect to FILL the feed container. Since the crop window aspect (1:1, Original, etc.) rarely matches the feed container's portrait aspect, this further crops the user's chosen framing → WYSIWYG break.

**Fix:** `isCropContain = !isContain && hasCropRect && mode === 'cover'` — new branch in FocalImage.

When `isCropContain`:
- Scale: `s = min(cw / cropPxW, ch / cropPxH)` (contain-fit of crop rect)
- Position: `imgLeft = (cw - cropPxW*s) / 2 - cropX * imgW`, same for top
- Rendering: blur background + positioned image (same JSX as `isContain`)
- Result: the user's exact framing is preserved; gaps filled with blur letterboxing

**Backward compat:** avatar uses `mode=null` (no mode prop) → `isCropContain=false` → stays on rect-driven cover. FeedPage `railBottom` also applies `FIT_RAIL_LIFT` for crop-contain posts (`cropMode === 'cover' && cropX != null`).

**Key rule:** `mode='cover'` + cropRect = WYSIWYG blur letterbox (feed/preview). `mode=null` + cropRect = rect-driven cover (avatar). `mode='contain'` = full-image blur letterbox.

**Overlay anchoring (isCropContain):** `containAlignBottom` is now respected in the isCropContain useMemo branch. Formula: `anchoredTop = ch - containAlignBottom - cropY*imgH - displayCropH`; `centeredTop = (ch - displayCropH)/2 - cropY*imgH`; `imgTop = Math.max(anchoredTop, centeredTop)`. This anchors the photo content above the overlay for letterboxed posts and falls back to centering when the photo is too tall to shift further. Allows the overlay to sit cleanly in the blur pad.

---

## What was removed
`CropFramer` and `FrameRefiner` are still in the codebase (no files deleted) but no longer used by any screens. They can be removed in a future cleanup.
