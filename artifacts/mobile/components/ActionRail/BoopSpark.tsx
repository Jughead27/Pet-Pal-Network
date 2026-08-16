import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

// ─── BoopSpark ────────────────────────────────────────────────────────────────
// "Boop landed" burst: 5 short tapered coral rays that radiate outward from the
// icon center and fade in ~300 ms.  Replaces the generic expanding-ring ripple —
// this is the signature boop moment at the finger, distinct from the "Boop!"
// scatter pops that float over the photo.
//
// Transform order: [{rotate}, {translateY}] → translateY moves along the already-
// rotated Y-axis, so each ray springs in its own outward direction automatically.
//
// Cap: SPARK_CAP concurrent bursts; extra taps are silently dropped so rapid
// tapping stays smooth with no runaway React state growth.

const SPARK_ANGLES = [0, 72, 144, 216, 288]; // 5 evenly distributed directions (°)
export const SPARK_CAP    = 4;                        // max live bursts at once
export const RING_CAP     = 6;                        // max live rings at once

interface BoopSparkProps {
  color: string;
  onDone: () => void;
}

export function BoopSpark({ color, onDone }: BoopSparkProps) {
  // One travel value per ray — all share a single opacity envelope.
  const travels = useRef(SPARK_ANGLES.map(() => new Animated.Value(2))).current;
  const opacity  = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      // Each ray springs from 2 (inside icon) to -22 (clear of icon edge).
      ...travels.map((t) =>
        Animated.timing(t, {
          toValue: -22,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      ),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 310,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFillObject, { opacity }]}
      pointerEvents="none"
    >
      {SPARK_ANGLES.map((angle, i) => (
        <Animated.View
          key={angle}
          style={[
            sparkStyles.ray,
            {
              backgroundColor: color,
              transform: [
                // 1. Orient ray in its outward direction.
                { rotate: `${angle}deg` },
                // 2. Translate along the now-rotated Y-axis (negative = outward).
                { translateY: travels[i] },
              ],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

// Each ray: a short pill centered within boopIconArea (width:40, height:32).
// left = (40 - 3) / 2 = 18.5 → 18;  top = (32 - 10) / 2 = 11
const sparkStyles = StyleSheet.create({
  ray: {
    position: 'absolute',
    width: 3,
    height: 10,
    borderRadius: 1.5,
    left: 18,
    top: 11,
  },
});
