/**
 * InterestChip — typographic follow toggle for species/breed interests.
 *
 * Design system: plain text states, no capsule/pill, no background, no border,
 * no checkmark. Follows the same convention as "Add to Pack" (plain text).
 *
 *   Inactive  muted-foreground color, Inter_400Regular
 *   Active    foreground color, Inter_700Bold
 *
 * The transition is a 150ms cross-fade between two overlaid Animated.Text
 * nodes — the active text fades in as the inactive text fades out.
 *
 * Touch target: ≥44px via invisible paddingVertical — no visible capsule.
 * No truncation: numberOfLines is not set so text wraps freely.
 *
 * No react-native-reanimated.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface InterestChipProps {
  label:     string;
  followed:  boolean;
  onPress:   () => void;
  /** True while a mutation is in flight — prevents double-tap. */
  disabled?: boolean;
}

export default function InterestChip({ label, followed, onPress, disabled = false }: InterestChipProps) {
  const colors   = useColors();
  const progress = useRef(new Animated.Value(followed ? 1 : 0)).current;

  const inactiveOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const activeOpacity   = progress;

  // Animate whenever the followed prop changes.
  useEffect(() => {
    Animated.timing(progress, {
      toValue:         followed ? 1 : 0,
      duration:        150,
      useNativeDriver: true,
    }).start();
  }, [followed, progress]);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={followed ? `Following ${label}` : `Follow ${label}`}
      // paddingVertical pads the invisible tap target to ≥44px.
      // paddingHorizontal gives slight breathing room without visual border.
      style={styles.wrapper}
    >
      {/*
        Two Animated.Text nodes stacked in the same space.
        The inactive layer sits in normal flow and sizes the wrapper.
        The active layer is absolute, aligned to the same bounds.
        Both have identical font size so they occupy the same height;
        the bold weight may be fractionally wider but never clips (no overflow:hidden).
      */}
      <View style={styles.textArea}>
        {/* Inactive: muted, regular weight — fades out when followed */}
        <Animated.Text
          style={[styles.labelInactive, { color: colors.mutedForeground, opacity: inactiveOpacity }]}
        >
          {label}
        </Animated.Text>

        {/* Active: full foreground, bold — fades in when followed */}
        <Animated.Text
          style={[styles.labelActive, styles.labelAbsolute, { color: colors.foreground, opacity: activeOpacity }]}
          // pointerEvents="none" so taps pass through to the TouchableOpacity
          pointerEvents="none"
        >
          {label}
        </Animated.Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    // Invisible padding reaches the ≥44px WCAG tap target.
    // alignSelf: 'flex-start' prevents the wrapper from stretching in a row.
    alignSelf:       'flex-start',
    paddingVertical: 12,   // 12 + 12 + ~20px line height ≈ 44px tap target
    paddingHorizontal: 2,
  },
  textArea: {
    // Positions the active label over the inactive one.
    position: 'relative',
  },
  labelInactive: {
    fontFamily:    'Inter_400Regular',
    fontSize:      14,
    letterSpacing: 0.1,
    lineHeight:    20,
  },
  labelAbsolute: {
    // Covers the inactive text exactly.
    position: 'absolute',
    top:      0,
    left:     0,
    right:    0,
  },
  labelActive: {
    fontFamily:    'Inter_700Bold',
    fontSize:      14,
    letterSpacing: 0.1,
    lineHeight:    20,
  },
});
