---
name: Crop Focus / Focal Point Architecture
description: How poster-controlled crop framing is stored, served, and rendered in Fish Book.
---

## Rule
`cropFocusX` / `cropFocusY` (real, nullable, 0–1) live on the `posts` table and flow through the full stack: DB → API → codegen → feed/pet routes → mobile render.

**Why:** The feed uses full-screen cover-fit images. Without a focal point, cover always centers, cutting off whatever the poster cares about. The poster sees a WYSIWYG framing step before posting; what they frame is exactly what the feed renders.

**How to apply:**
- Schema: `real()` columns, nullable, no default (NULL = center).
- Feed route (`routes/feed.ts`) and pets route (`routes/pets.ts`) must both SELECT and return `cropFocusX`/`cropFocusY` alongside every post.
- `FeedPost` in OpenAPI spec: both fields are `required: true`, `nullable: true`, type `number/float`.
- Mobile feed: `FocalImage` component replaces plain `<Image resizeMode="cover">`. Computes scale-to-cover, then translates the image so the focal point is centered, clamped to avoid overdraw.
- Framing step: `CropFramer` (full-screen overlay, `PanResponder` + `Animated`, no Reanimated). Pan offset convention: `panX ∈ [-overflowX/2, overflowX/2]`, centered at 0. Convert to focal point on confirm: `focusX = 0.5 - panX / overflowX`.
- Post detail route (`app/post/[id].tsx`): contain-fit, no focal point needed — shows the full uncropped image. Data sourced from feed query cache (`queryClient.getQueryData(getGetFeedQueryKey())`).
- Caption tap in `FeedPage` navigates to `/post/${postId}` (slide_from_bottom animation).
- Pet profile modal (`pet/[id].tsx`) uses `resizeMode="contain"` for the selected post image.
- `add.tsx` step machine: `'idle' → 'compressing' → 'framing' → 'form'`. Framing step renders `CropFramer` full-screen (outside scroll). Natural pixel dimensions are stored in a `useRef` (not state) to avoid re-renders.
