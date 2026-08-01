/**
 * One source of truth for the feed cell's rendered dimensions.
 *
 * FeedPage writes the measured width + its received height prop on every
 * onLayout tick.  The compose screen (add.tsx) reads the aspect before
 * opening the refiner or rendering the preview, so the crop frame and
 * preview always match the actual feed cell exactly.
 *
 * Intentionally module-level (not React state) — no re-renders, no context.
 * Reads that happen before the feed has ever rendered get null and fall back
 * to the formula in add.tsx.
 */

let _w = 0;
let _h = 0;

/** Called by FeedPage in its onLayout. Ignores zero-size readings. */
export function setFeedCellDimensions(w: number, h: number): void {
  if (w > 0 && h > 0) {
    _w = w;
    _h = h;
  }
}

/**
 * Returns the last measured feed cell dimensions, or null if the feed has
 * never rendered (e.g. the user opened Add before viewing the home feed).
 */
export function getFeedCellDimensions(): { w: number; h: number } | null {
  return _w > 0 && _h > 0 ? { w: _w, h: _h } : null;
}
