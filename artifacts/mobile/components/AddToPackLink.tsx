/**
 * AddToPackLink — single paw print inside a thin circular outline.
 *
 * Sits inline next to the pet name. Reads as a tappable Pack toggle.
 * Tap target is generous (40×40); visible circle is compact and quiet.
 *
 * Inactive: dim ring, dim paw.
 * Active:   teal ring + faint teal fill, teal paw.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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

  const ringColor      = isInPack ? colors.primary : 'rgba(240,244,248,0.35)';
  const ringBackground = isInPack ? 'rgba(32,178,170,0.12)' : 'transparent';
  const pawColor       = isInPack ? colors.primary : 'rgba(240,244,248,0.50)';
  const iconName       = isInPack ? 'paw' : 'paw-outline';

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.6}
      style={styles.touchable}
      testID="add-to-pack-button"
      accessibilityRole="button"
      accessibilityLabel={isInPack ? 'Remove from Pack' : 'Add to Pack'}
    >
      <View
        style={[
          styles.ring,
          { borderColor: ringColor, backgroundColor: ringBackground },
        ]}
      >
        <MaterialCommunityIcons name={iconName} size={12} color={pawColor} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    marginLeft: 6,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
