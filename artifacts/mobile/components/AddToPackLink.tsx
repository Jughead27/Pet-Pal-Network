/**
 * AddToPackLink — compact 3-paw-print icon toggle for Pack membership.
 *
 * Sits inline next to the pet name in the identity row.
 * Enclosed in a thin circular outline so it reads as an actionable control.
 *
 * Inactive: very subtle outline ring, dim paw prints.
 * Active:   slightly brighter stroke + faint teal fill, teal paw prints.
 *
 * Tap target is generous (40×40) even though the visible circle is small.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

// Three paw prints arranged in a compact triangle cluster.
function PawPackIcon({ active, pawColor }: { active: boolean; pawColor: string }) {
  const iconName = active ? 'paw' : 'paw-outline';
  return (
    <View style={styles.pawCluster}>
      {/* Top-center paw */}
      <MaterialCommunityIcons
        name={iconName}
        size={8}
        color={pawColor}
        style={styles.pawTop}
      />
      {/* Bottom-left paw */}
      <MaterialCommunityIcons
        name={iconName}
        size={8}
        color={pawColor}
        style={styles.pawBottomLeft}
      />
      {/* Bottom-right paw */}
      <MaterialCommunityIcons
        name={iconName}
        size={8}
        color={pawColor}
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

  // Inactive: dim ring, dim paws
  // Active: teal ring + very faint teal fill, teal paws
  const ringColor      = isInPack ? colors.primary : 'rgba(240,244,248,0.30)';
  const ringBackground = isInPack ? 'rgba(32,178,170,0.10)' : 'transparent';
  const pawColor       = isInPack ? colors.primary : 'rgba(240,244,248,0.45)';

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.6}
      style={styles.touchable}
      testID="add-to-pack-button"
      accessibilityRole="button"
      accessibilityLabel={isInPack ? 'Remove from Pack' : 'Add to Pack'}
    >
      {/* Thin circular outline ring */}
      <View
        style={[
          styles.ring,
          {
            borderColor: ringColor,
            backgroundColor: ringBackground,
          },
        ]}
      >
        <PawPackIcon active={isInPack} pawColor={pawColor} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    marginLeft: 6,
    // Generous hit area
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Thin circle that frames the paw cluster
  ring: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fixed-size canvas for the 3-paw cluster
  pawCluster: {
    width: 22,
    height: 19,
    position: 'relative',
  },
  pawTop: {
    position: 'absolute',
    top: 0,
    left: 7,
  },
  pawBottomLeft: {
    position: 'absolute',
    top: 10,
    left: 0,
  },
  pawBottomRight: {
    position: 'absolute',
    top: 10,
    left: 14,
  },
});
