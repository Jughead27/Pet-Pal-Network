/**
 * PopText — one independent reaction pop animation.
 *
 * Spawned per press. Animates: scale 0.5 → 1.1 (spring), drifts up 24px,
 * fades out. Total ~600ms then calls onDone so parent can remove it.
 * With reducedMotion: simple fade only, no movement or scale change.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

interface PopTextProps {
  word: string;
  /** Degrees of random tilt, -8 to +8 */
  rotation: number;
  onDone: () => void;
  reducedMotion: boolean;
  /** Absolute position from screen right edge (px) */
  right: number;
  /** Absolute position from screen bottom edge (px) */
  bottom: number;
}

export default function PopText({ word, rotation, onDone, reducedMotion, right, bottom }: PopTextProps) {
  const scale      = useSharedValue(reducedMotion ? 1 : 0.5);
  const translateY = useSharedValue(0);
  const opacity    = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
      { rotate: `${reducedMotion ? 0 : rotation}deg` },
    ],
    opacity: opacity.value,
  }));

  useEffect(() => {
    if (reducedMotion) {
      // Appear and fade — no movement
      opacity.value = withSequence(
        withTiming(1, { duration: 120 }),
        withTiming(1, { duration: 280 }),
        withTiming(0, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onDone)();
        }),
      );
    } else {
      // Spring in, drift up, fade out — all on independent timelines
      // Opacity: quick appear, hold, then fade
      opacity.value = withSequence(
        withTiming(1, { duration: 80 }),
        withTiming(1, { duration: 180 }),
        withTiming(0, { duration: 340 }),
      );
      // Scale: spring to 1.1 then hold
      scale.value = withSpring(1.1, { damping: 9, stiffness: 380 });
      // Translate: drift up 24px over 600ms, then call onDone
      translateY.value = withTiming(-24, { duration: 600 }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.Text
      style={[styles.pop, { right, bottom }, animStyle]}
      // @ts-ignore — React Native Web supports pointerEvents on Text
      pointerEvents="none"
    >
      {word}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  pop: {
    position: 'absolute',
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
