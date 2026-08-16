// ─── Constants ────────────────────────────────────────────────────────────────

// Horizontal exclusion zone constants — taps this far from the right edge won't toggle chrome.
// RAIL_EXCLUSION_X is computed dynamically inside handleMediaPress from pageWidthRef.current
// so it stays correct inside the 430-px web column (Dimensions.get returns the full window
// width on web, not the column width).

export const RAIL_TOUCH_WIDTH   = 40;
export const RAIL_RIGHT_INSET   = 14;
export const RAIL_MARGIN        = 24;

// ─── Reaction pop — scatter geometry ─────────────────────────────────────────
// Right clearance: rail at right:14, touch width 40px, 12px margin.
export const POP_RAIL_CLEARANCE     = RAIL_RIGHT_INSET + RAIL_TOUCH_WIDTH + 12; // ~66px from right
// Max pop text width — generous for "Boop boop!" at largest size (44×1.4).
export const POP_EST_MAX_WIDTH      = 210;
// Min gap from the left screen edge.
export const POP_LEFT_MARGIN        = 12;
// How far above `bottomOffset` the scatter floor sits (clears petInfo + caption).
export const POP_SCATTER_FLOOR      = 160;
// How far below the top edge pops are kept (status bar / nav clearance).
export const POP_SCATTER_TOP_MARGIN = 90;
// Max simultaneous pops; oldest is recycled when the cap is hit.
export const POP_MAX_COUNT          = 8;

// Accent colors — locked semantics: boop = coral, treat = gold.
export const BOOP_COLOR  = '#FF7A5C'; // matches colors.accent
export const TREAT_COLOR = '#F4C542'; // matches ActionRail treat activeColor

// Word sets — weighted toward primary word; variants add surprise, not noise.
export const BOOP_WORDS = [
  { word: 'Boop!',      weight: 7 },
  { word: 'Boop boop!', weight: 2 },
  { word: 'Booped!',    weight: 1 },
] as const;
export const TREAT_WORDS = [
  { word: 'Yum!',      weight: 7 },
  { word: 'Yummy!',    weight: 1 },
  { word: 'Tasty!',    weight: 1 },
  { word: 'Nom nom!',  weight: 1 },
] as const;

/** Weighted random pick from a word set. */
export function pickWord(words: ReadonlyArray<{ word: string; weight: number }>): string {
  const total = words.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of words) {
    r -= w.weight;
    if (r <= 0) return w.word;
  }
  return words[0].word;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEXT_SHADOW: any = { textShadow: '0px 1px 3px rgba(0,0,0,0.4)' };
