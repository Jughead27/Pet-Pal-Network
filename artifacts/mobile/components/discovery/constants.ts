// ─── Layout constants ──────────────────────────────────────────────────────────

// THUMBNAIL_SIZE is computed dynamically inside the component from useColumnWidth()
// so it reflects the 430-px column width on web desktop, not the full window width.
export const NUM_COLS       = 3;
export const CELL_GAP       = 2;
export const CHIP_HEIGHT     = 36; // height of the chip/sort row band
// Approximate width of the "Fresh | Popular" control — chips get right-padding
// to prevent them scrolling underneath it.
export const SORT_CTRL_WIDTH = 116;
// Height of the masthead row — drives the chip-row top offset and grid paddingTop.
// = lineHeight(25) + paddingBottom(4) from SectionMasthead's row style.
export const MASTHEAD_HEIGHT = 30;
