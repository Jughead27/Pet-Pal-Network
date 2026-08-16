import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { Pet } from '@workspace/api-client-react';
import PetAvatar from '@/components/PetAvatar';

// ── PetChip ───────────────────────────────────────────────────────────────────

interface PetChipProps {
  pet: Pet;
  selected: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}

function PetChip({ pet, selected, colors, onPress }: PetChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        chipStyles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.secondary,
          borderColor:     selected ? colors.primary : colors.border,
        },
      ]}
    >
      <PetAvatar
        url={pet.thumbnailUrl}
        size={44}
        backgroundColor={selected ? 'rgba(255,255,255,0.25)' : colors.border}
        pawColor={selected ? colors.primaryForeground : colors.mutedForeground}
      />
      <Text style={[
        chipStyles.name,
        { color: selected ? colors.primaryForeground : colors.foreground },
      ]}>
        {pet.name}
      </Text>
    </TouchableOpacity>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    alignItems: 'center',
    minWidth: 70,
    gap: 6,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    textAlign: 'center',
  },
});

export default PetChip;
