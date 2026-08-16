// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewMode = 'grid' | 'pager';

export interface SpeciesChip {
  id: string;   // species UUID from catalogue
  name: string; // display label
}
