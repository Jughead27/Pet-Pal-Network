/**
 * SpotlightBanner — featured pet strip on the Sniff screen.
 *
 * Sits below the species-chip/sort band, above the grid. Typographic register
 * (muted label + semibold name), no pills/capsules — matches the existing
 * design system. Renders nothing when GET /spotlight returns pet: null.
 *
 * Two states:
 *   default  — "spotlight · <photo> <Name>"  → tap engages the pet filter
 *   filtered — "Viewing <Name> · clear"      → tap clears the filter
 *
 * Never shows treat counts or rank — selection criteria are invisible.
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useGetSpotlight } from '@workspace/api-client-react';

export interface SpotlightPetRef {
  id:   string;
  name: string;
}

interface Props {
  colors: {
    foreground:      string;
    mutedForeground: string;
    border:          string;
  };
  /** Non-null when the grid is currently filtered to a single pet. */
  activePetFilter: SpotlightPetRef | null;
  onEngage: (pet: SpotlightPetRef) => void;
  onClear:  () => void;
}

export default function SpotlightBanner({ colors, activePetFilter, onEngage, onClear }: Props) {
  const { data } = useGetSpotlight();
  const pet = data?.pet ?? null;

  // Active filter state — shown even if the filtered pet is not the current
  // spotlight pet (state is owned by the parent; banner is the control).
  if (activePetFilter) {
    return (
      <Pressable
        onPress={onClear}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Stop viewing ${activePetFilter.name}`}
      >
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          Viewing{' '}
          <Text style={[styles.name, { color: colors.foreground }]}>{activePetFilter.name}</Text>
          {'  ·  '}
          <Text style={[styles.clear, { color: colors.mutedForeground }]}>clear</Text>
        </Text>
      </Pressable>
    );
  }

  if (!pet) return null;

  return (
    <Pressable
      onPress={() => onEngage({ id: pet.id, name: pet.name })}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`Spotlight: view ${pet.name}'s posts`}
    >
      <Text style={[styles.spotlightLabel, { color: colors.mutedForeground }]}>Spotlight</Text>
      {pet.coverPhotoUrl ? (
        <Image source={{ uri: pet.coverPhotoUrl }} style={[styles.photo, { borderColor: colors.border }]} />
      ) : null}
      <Text style={[styles.name, { color: colors.foreground }]}>{pet.name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    // Horizontal padding comes from the parent sub-filter row on Sniff.
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    paddingBottom: 8,
  },
  spotlightLabel: {
    fontFamily:    'Inter_400Regular',
    fontSize:      12,
    letterSpacing: 0.6,
  },
  photo: {
    width:        22,
    height:       22,
    borderRadius: 11,
    borderWidth:  StyleSheet.hairlineWidth,
  },
  label: {
    fontFamily:    'Inter_400Regular',
    fontSize:      13,
    letterSpacing: -0.1,
  },
  name: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      13,
    letterSpacing: -0.1,
  },
  clear: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
  },
});
