/**
 * AddToPackLink — filled solid paw print inside a circular toggle button.
 *
 * States:
 *   Inactive  outlined ring, paw in light foreground (dim)
 *   Active    solid light-filled ring, paw in dark background (inverted)
 *
 * Transition: 150ms cross-fade driven by a Reanimated shared value.
 * Touch target: 40×40.  Visible circle: 26×26.
 */

import React, { useRef } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Ellipse, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/context/AppContext';

// ─── PawIcon ─────────────────────────────────────────────────────────────────
// Filled solid paw print (4 toes + pad). No strokes. fill = color prop.

interface PawIconProps {
  size?: number;
  color?: string;
}

function PawIcon({ size = 24, color = '#F0F4F8' }: PawIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      {/* Outer toes */}
      <Ellipse cx={7.2}  cy={9.4} rx={1.9} ry={2.4} transform="rotate(-20, 7.2, 9.4)" />
      <Ellipse cx={16.8} cy={9.4} rx={1.9} ry={2.4} transform="rotate(20, 16.8, 9.4)" />
      {/* Inner toes */}
      <Ellipse cx={10} cy={6.4} rx={1.8} ry={2.3} transform="rotate(-8, 10, 6.4)" />
      <Ellipse cx={14} cy={6.4} rx={1.8} ry={2.3} transform="rotate(8, 14, 6.4)" />
      {/* Main pad */}
      <Path d="M12 11c-2.6 0-4.9 2-4.9 4.3 0 1.6 1.2 2.7 2.8 2.7 1 0 1.5-.4 2.1-.4s1.1.4 2.1.4c1.6 0 2.8-1.1 2.8-2.7C16.9 13 14.6 11 12 11Z" />
    </Svg>
  );
}

// ─── AddToPackLink ────────────────────────────────────────────────────────────

export default function AddToPackLink() {
  const { isInPack, togglePack } = useApp();

  // Track current state in a ref so the animation fires before context re-renders
  const activeRef = useRef(isInPack);
  const progress = useSharedValue(isInPack ? 1 : 0);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !activeRef.current;
    activeRef.current = next;
    progress.value = withTiming(next ? 1 : 0, { duration: 150 });
    togglePack();
  };

  // Ring: transparent outline → solid light fill
  const ringStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ['transparent', '#F0F4F8'],
    ),
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      ['rgba(240,244,248,0.35)', '#F0F4F8'],
    ),
  }));

  // Light paw (inactive): fades out as progress → 1
  const lightPawStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  // Dark paw (active): fades in as progress → 1
  const darkPawStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={styles.touchable}
      testID="add-to-pack-button"
      accessibilityRole="button"
      accessibilityLabel={isInPack ? 'In your Pack' : 'Add to Pack'}
    >
      <Animated.View style={[styles.ring, ringStyle]}>
        {/* Light paw — shown when inactive */}
        <Animated.View style={[styles.pawLayer, lightPawStyle]} pointerEvents="none">
          <PawIcon size={14} color="rgba(240,244,248,0.80)" />
        </Animated.View>

        {/* Dark paw — shown when active (circle is light, paw inverts) */}
        <Animated.View style={[styles.pawLayer, darkPawStyle]} pointerEvents="none">
          <PawIcon size={14} color="#060B10" />
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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
    overflow: 'hidden',
  },
  // Both paw layers sit in the same spot; only opacity differs
  pawLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
