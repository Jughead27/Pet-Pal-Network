---
name: Auto-frame Architecture
description: Crop rect + contain mode stored on posts; auto-frame at compose; FrameRefiner pan+pinch; FocalImage handles both modes.
---

# Auto-frame Architecture

## Rule
All new posts carry crop_mode / crop_x / crop_y / crop_w / crop_h (nullable real columns in DB). Feed and FocalImage rendering respects these fields; legacy posts (null) fall back to cropFocusX/Y focal-point behavior.

**Why:** Users get zero-touch framing at compose time; manual refinement is opt-in; all existing posts render identically.

## How to apply

### DB columns (lib/db/src/schema/posts.ts)
- `cropMode text` — 'cover' | 'contain' | null  
- `cropX / cropY / cropW / cropH real` — 0–1 fractions of original image; null = not set

### Auto-frame engine (artifacts/mobile/utils/computeAutoFrame.ts)
- `computeAutoFrame(uri, naturalWidth, naturalHeight, targetAspect)` → `{x, y, w, h}`
- Web: lazy-import smartcrop.js via canvas; native: top-weighted floor fallback
- targetAspect must be `screenW / screenH` (full-screen portrait feed hero), NOT 1:1

### Compose flow (artifacts/mobile/app/(tabs)/add.tsx)
- After compression: call `computeAutoFrame(uri, w, h, feedAspect)`, store rect, jump to form — no manual framing step
- Preview uses FocalImage with cropRect + cropMode so it exactly matches feed rendering
- "Adjust framing" button opens FrameRefiner modal; "Show whole photo" toggle switches cropMode
- Submit sends cropMode, cropX/Y/W/H plus derived cropFocusX/Y (legacy compat)

### FrameRefiner (artifacts/mobile/components/FrameRefiner.tsx)
- Pan responder handles BOTH pan (1-finger) and pinch (2-finger) in one responder
- Pinch scales crop rect around its center; minimum size = screenW/naturalWidth (no upscaling)
- Corner handles also resize (4 PanResponder instances, one per corner)
- Live 80×80 px preview inset shows the crop result in real time

### FocalImage (artifacts/mobile/components/FocalImage.tsx)
- mode='cover' + cropX/Y/W/H: scale so rect fills container (rect-driven cover)
- mode='contain': blurred fill + contain-fit foreground image
- mode=null or no rect: legacy focal-point cover (backward compat)

### Feed route (artifacts/api-server/src/routes/feed.ts)
- Selects and returns cropMode, cropX, cropY, cropW, cropH alongside existing fields

### FeedPage (artifacts/mobile/components/FeedPage.tsx)
- Passes cropX/Y/W/H + cropMode from post data to FocalImage hero image

### OpenAPI + Orval
- FeedPost schema and CreatePostBody both include the 5 new crop fields
- Run `cd lib/api-spec && npx orval` after schema changes
