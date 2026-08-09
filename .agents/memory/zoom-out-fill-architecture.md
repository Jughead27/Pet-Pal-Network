---
name: Zoom-out + Sampled Fill Architecture
description: Crop rect may extend past [0,1]; solid avg-color fill (posts.crop_fill_color) renders behind photo on all surfaces.
---

# Zoom-out + Sampled Color Fill

## Rule
The compose crop editor allows zooming OUT below cover (floor = coverScale/3, gated by CropEditor's `allowZoomOut` prop — avatar path keeps the hard cover floor). When zoomed out, the crop rect fractions go outside [0,1] (negative x/y, w/h > 1). Uncovered frame space is filled with a SOLID color sampled from the photo (average color, NOT blur), stored once at compose time in `posts.crop_fill_color` so every surface renders identically.

**Why:** Canonical compose-time color guarantees WYSIWYG across editor, feed, post detail, and both share-card paths; recomputing per-surface would drift.

## How to apply
- **Rect model:** all renderers use linear rect math that generalizes to out-of-range rects unchanged. Never clamp rects to [0,1] in stateToRect. clampOffset uses `Math.abs(scale*n - crop)/2` (identical to old `max(0,…)` at ≥ cover).
- **Default zoom unchanged:** initial state and aspect-change reset use coverScale, NOT minScale. Max zoom = coverScale*8.
- **Color sampling:** `computeAverageColor(uri)` in mobile `utils/luminance.ts` (web: 1×1 canvas; native: 1×1-PNG IDAT parse). In add.tsx it's sampled async after compression with a monotonic token to discard stale results after photo swaps; submit awaits it synchronously if the rect actually extends past [0,1] and no color resolved yet.
- **Renderers:** FocalImage/ShareCard get `cropFillColor` prop → solid background behind rect-positioned image. Web canvas share path: when fill color present, fill + clip photo area and draw the FULL image at `dx - sx*scale, dy - sy*scale, nw*scale, nh*scale` (out-of-bounds 9-arg drawImage source is unreliable across browsers); keep legacy 9-arg path when no fill.
- **Validation:** openapi cropFillColor pattern `^#[0-9A-Fa-f]{6}$`; server enforces all-or-none crop tuple with positive w/h. Renderer predicates must require ALL FOUR rect fields (FocalImage silently falls back otherwise).
- **Post detail:** posts with a full crop rect render FocalImage in a container whose aspect = the rect's own aspect (needs Image.getSize natural size), capped at 75% window height — exact WYSIWYG of the rect.

## Blur-look fill upgrade (thumb stretch)
- posts.crop_fill_thumb: tiny (~24px) JPEG data URI generated at compose time (utils/fillThumb.ts native manipulator / fillThumb.web.ts canvas), sent only when the rect needs fill.
- Static surfaces (FocalImage, ShareCard native, shareCardAction web canvas) layer: solid crop_fill_color first (instant fallback), thumb stretched cover above it, photo on top. CropEditor stays solid-color for gesture perf.
- Rule: any failure in thumb generation/decoding must degrade to solid color — never blank. Legacy posts have null thumb.
- Feed hero renders rect posts in a centered rect-aspect frame (letterboxed), NOT full-bleed; pet-info chrome and action rail reposition relative to the photo's rendered bottom edge (fillSeamY) on bottom-fill posts.
