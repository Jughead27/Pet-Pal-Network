/**
 * InterestChip — animated pill chip for species/breed interest follows.
 *
 * Pure presentation: the parent derives `followed` from FollowsContext and
 * handles all mutation logic. This component just animates when the prop changes.
 *
 * Monochrome active treatment (teal reserved for nav):
 *   Inactive  card bg + hairline border + muted text
 *   Active    foreground bg + background text (inverted) + check icon
 *
 * 150ms cross-fade via built-in Animated API. No react-native-reanimated.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface InterestChipProps {
  label:     string;
  followed:  boolean;
  onPress:   () => void;
  /** True while a mutation is in flight — prevents double-tap. */
  disabled?: boolean;
}

export default function InterestChip({ label, followed, onPress, disabled = false }: InterestChipProps) {
  const colors  = useColors();
  const progress = useRef(new Animated.Value(followed ? 1 : 0)).current;

  const inactiveOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const activeOpacity   = progress;

  // Animate whenever the followed prop changes (driven by parent/context).
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
      activeOpacity={0.75}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={followed ? `Following ${label}` : `Follow ${label}`}
      style={styles.wrapper}
    >
      {/* Inactive layer: fades out when active */}
      <Animated.View
        style={[
          styles.chip,
          {
            backgroundColor: colors.card,
            borderColor:     colors.border,
            opacity:         inactiveOpacity,
          },
        ]}
      >
        <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>

      {/* Active layer: fades in when active, positioned over inactive */}
      <Animated.View
        style={[
          styles.chip,
          styles.chipAbsolute,
          {
            backgroundColor: colors.foreground,
            borderColor:     colors.foreground,
            opacity:         activeOpacity,
          },
        ]}
        pointerEvents="none"
      >
        <Feather name="check" size={11} color={colors.background} />
        <Text style={[styles.label, { color: colors.background }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'flex-start',
  },
  chip: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 11,
    paddingVertical:   5,
    borderRadius:    20,
    borderWidth:     StyleSheet.hairlineWidth,
    gap:             4,
    minWidth:        44,   // accessibility touch target
  },
  chipAbsolute: {
    position: 'absolute',
    top:    0,
    left:   0,
    right:  0,
    bottom: 0,
  },
  label: {
    fontFamily:    'Inter_500Medium',
    fontSize:      13,
    letterSpacing: 0.1,
  },
});
