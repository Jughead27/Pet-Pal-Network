import React from 'react';
import { Bone, Fish, Carrot, Cookie, HandTap, type Icon as PhosphorIcon } from 'phosphor-react-native';
import { WithGlyphShadow } from './WithGlyphShadow';

// ─── Icon helpers ─────────────────────────────────────────────────────────────

export function BoopIcon({ color, size }: { color: string; size: number }) {
  return <WithGlyphShadow icon={HandTap} color={color} size={size} />;
}

// ─── Species → treat glyph mapping ───────────────────────────────────────────
// Maps the posting pet's species string (case-insensitive) to a Phosphor icon.
// Cookie is the default fallback for any unmapped species.
// Add entries here to extend coverage without touching the component.

const SPECIES_TREAT_ICON: Record<string, PhosphorIcon> = {
  dog:          Bone,
  cat:          Fish,
  rabbit:       Carrot,
  'guinea pig': Carrot,
  horse:        Carrot,
};

function treatIconForSpecies(species: string | undefined): PhosphorIcon {
  if (!species) return Cookie;
  return SPECIES_TREAT_ICON[species.trim().toLowerCase()] ?? Cookie;
}

export function TreatIcon({ color, size, species }: { color: string; size: number; species?: string }) {
  return <WithGlyphShadow icon={treatIconForSpecies(species)} color={color} size={size} />;
}
