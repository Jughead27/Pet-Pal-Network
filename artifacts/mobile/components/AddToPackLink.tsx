/**
 * AddToPackLink — lightweight text toggle for following/saving a pet.
 *
 * Renders as small text, not a CTA button. Toggles between:
 *   "Add to Pack" ↔ "Added"
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

export default function AddToPackLink() {
  const colors = useColors();
  const { isInPack, togglePack } = useApp();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    togglePack();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.6}
      testID="add-to-pack-button"
      accessibilityRole="button"
      accessibilityLabel={isInPack ? 'Remove from Pack' : 'Add to Pack'}
    >
      <Text
        style={[
          styles.label,
          isInPack
            ? { color: colors.primary }
            : { color: colors.mutedForeground },
        ]}
      >
        {isInPack ? 'Added' : '+ Add to Pack'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 0.4,
  },
});
