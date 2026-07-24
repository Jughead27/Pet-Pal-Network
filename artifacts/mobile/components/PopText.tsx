/**
 * PopText — one independent reaction pop animation.
 *
 * Spawned per press. Animates: scale 0.5 → 1.1 (elastic bounce), drifts up
 * 24 px, fades out. Total ~600 ms then calls onDone so parent can remove it.
 * With reducedMotion: simple fade only, no movement or scale change.
 *
 * Implemented with React Native's built-in Animated API (NOT Reanimated) so it
 * works in Expo Go regardless of the bundled Reanimated version. Reanimated
 * shared values start at their initial value and never animate when there is a
 * version mismatch between the bundled and installed Reanimated — which causes
 * pops to stay invisible (opacity starts at 0).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';

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
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale      = useRef(new Animated.Value(reducedMotion ? 1 : 0.5)).current;

  useEffect(() => {
    if (reducedMotion) {
      // Appear and fade — no movement or scale change
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onDone();
      });
    } else {
      // All three timelines run in parallel:
      //   Opacity  — quick appear (80ms), hold (180ms), fade out (340ms) → 600ms total
      //   Scale    — elastic bounce from 0.5 to 1.1 over 200ms
      //   TranslateY — drift up 24px over 600ms
      // onDone fires when the parallel composite finishes (~600ms).
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 80,  useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 340, useNativeDriver: true }),
        ]),
        Animated.timing(scale, {
          toValue: 1.1,
          duration: 200,
          easing: Easing.elastic(2),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -24,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) onDone();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { right, bottom },
        {
          opacity,
          transform: [
            { translateY },
            { scale },
            { rotate: reducedMotion ? '0deg' : `${rotation}deg` },
          ],
        },
      ]}
    >
      <Text style={styles.text}>{word}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  text: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
