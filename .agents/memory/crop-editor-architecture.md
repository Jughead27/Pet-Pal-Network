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
- Touch: `PanResponder` handles single-finger pan and two-finger pinch-to-zoom.
- Web: same PanResponder (pointer events), plus native `wheel` listener attached to the outer `View` ref for scroll-to-zoom toward cursor.
- State: refs for gesture math (`scaleRef`, `offsetRef`), `useState` for re-render.
- Returns `CropRect` (0–1 fractions of natural image) + mode via `onConfirm`.

### Key geometry helpers
- `clampOffset` — prevents image being pulled off the crop window (no gaps).
- `stateToRect(scale, offset, cropW, cropH, nw, nh)` → CropRect for confirm.
- `rectToState(rect, cropW, cropH, nw, nh, minScale, maxScale)` → initial scale+offset from an existing CropRect.

### Zoom range
`minScale = max(cropW/naturalWidth, cropH/naturalHeight)` (just covers the crop window)  
`maxScale = minScale * 8` (8× range)

### Orientation/resize handling
`useEffect` on `[minScale, maxScale, cropW, cropH]` re-clamps state so the image stays valid after orientation flip or window resize.

---

## WYSIWYG fix for avatar

**Problem:** CropFramer saved `focusX/focusY` (legacy focal-point). FocalImage's focal-point formula is aspect-dependent — it renders differently in containers with different widths (e.g., `screenW` in the editor vs `columnWidth` in the profile hero on web).

**Fix:** Add crop rect columns to the `pets` table and save the rect instead.

### DB schema added (nullable reals)
```
avatar_crop_x, avatar_crop_y, avatar_crop_w, avatar_crop_h
```
Migration: `ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_crop_x real` (×4).

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

## Compose integration (add.tsx)

`FrameRefiner` replaced by `CropEditor` with `targetAspect={feedAspect}`. 
`handleRefineConfirm(rect, mode)` signature unchanged — CropEditor's `onConfirm` matches it exactly.

---

## What was removed
`CropFramer` and `FrameRefiner` are still in the codebase (no files deleted) but no longer used by any screens. They can be removed in a future cleanup.
