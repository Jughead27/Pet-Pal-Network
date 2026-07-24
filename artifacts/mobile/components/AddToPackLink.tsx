/**
 * AddToPackLink — compact 3-paw-print icon toggle for Pack membership.
 *
 * Sits inline next to the pet name in the identity row.
 * Outline style when inactive, filled teal when active.
 * Tap once = add to Pack, tap again = remove (toggle).
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

// Three paw prints arranged in a compact triangle cluster.
function PawPackIcon({ active, color }: { active: boolean; color: string }) {
  const iconName = active ? 'paw' : 'paw-outline';
  return (
    // Fixed bounds so the cluster never shifts layout
    <View style={styles.pawCluster}>
      {/* Top-center paw */}
      <MaterialCommunityIcons
        name={iconName}
        size={9}
        color={color}
        style={styles.pawTop}
      />
      {/* Bottom-left paw */}
      <MaterialCommunityIcons
        name={iconName}
        size={9}
        color={color}
        style={styles.pawBottomLeft}
      />
      {/* Bottom-right paw */}
      <MaterialCommunityIcons
        name={iconName}
        size={9}
        color={color}
        style={styles.pawBottomRight}
      />
    </View>
  );
}

export default function AddToPackLink() {
  const colors = useColors();
  const { isInPack, togglePack } = useApp();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    togglePack();
  };

  const iconColor = isInPack ? colors.primary : 'rgba(240,244,248,0.55)';

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.6}
      style={styles.touchable}
      testID="add-to-pack-button"
      accessibilityRole="button"
      accessibilityLabel={isInPack ? 'Remove from Pack' : 'Add to Pack'}
    >
      <PawPackIcon active={isInPack} color={iconColor} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    padding: 4,
    marginLeft: 4,
    // Generous hit area
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fixed-size canvas for the 3-paw cluster (keeps layout stable)
  pawCluster: {
    width: 26,
    height: 22,
    position: 'relative',
  },
  pawTop: {
    position: 'absolute',
    top: 0,
    left: 8,
  },
  pawBottomLeft: {
    position: 'absolute',
    top: 11,
    left: 0,
  },
  pawBottomRight: {
    position: 'absolute',
    top: 11,
    left: 17,
  },
});
