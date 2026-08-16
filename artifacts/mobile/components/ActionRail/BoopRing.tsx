import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

// ─── BoopRing ─────────────────────────────────────────────────────────────────
// Expanding coral ring that fires on each boop press — the "impact" layer that
// sits underneath the spark burst and text pops.
//
// Starts at the icon's own diameter (28 px) and scales to 3× (~84 px) while
// fading from 0.6 → 0 over 450 ms with an ease-out curve (fast start / slow
// finish — the classic ripple feel).
//
// Each press spawns its own independent ring instance (same stacking pattern
// as BoopSpark) so rapid tapping produces overlapping rings without glitching.
// Cap: RING_CAP concurrent rings; extras are silently dropped.

interface BoopRingProps {
  color: string;
  onDone: () => void;
}

export function BoopRing({ color, onDone }: BoopRingProps) {
  const ringScale   = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(ringScale, {
        toValue: 3,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(ringOpacity, {
        toValue: 0,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        ringStyles.ring,
        {
          borderColor: color,
          opacity: ringOpacity,
          transform: [{ scale: ringScale }],
        },
      ]}
      pointerEvents="none"
    />
  );
}

// Ring: 28×28 circle centered in boopIconArea (40×32).
// left = (40 - 28) / 2 = 6;  top = (32 - 28) / 2 = 2
const ringStyles = StyleSheet.create({
  ring: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    left: 6,
    top: 2,
  },
});
