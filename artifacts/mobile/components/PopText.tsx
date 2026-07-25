/**
 * PopText — one independent reaction pop animation.
 *
 * Spawned per press. Animates:
 *   Scale   — 0 → 1.15 (overshoot, 160ms) → 1.0 (settle, 140ms)
 *   Drift   — up 50px over 600ms (Easing.out quad)
 *   Opacity — appear 80ms, hold 170ms, fade 350ms → ~600ms total
 *
 * Each pop carries its own stable sizeFactor (±15%) generated on mount,
 * so rapid-fire boops produce varied sizes rather than identical stamps.
 *
 * With reducedMotion: simple fade only — no movement, no scale overshoot.
 *
 * Implemented with React Native's built-in Animated API (NOT Reanimated) so it
 * works in Expo Go regardless of the bundled Reanimated version.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';

// Base font size. Effective range: BASE × [0.85, 1.15] = ~27–37px.
const BASE_FONT_SIZE = 32;

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
  const scale      = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  // Stable random size multiplier: 0.85–1.15.
  // Generated once on mount via useRef — never causes re-renders.
  const sizeFactor = useRef(0.85 + Math.random() * 0.30).current;

  useEffect(() => {
    if (reducedMotion) {
      // Appear and fade — no movement or scale change, no overshoot
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onDone();
      });
    } else {
      // All three timelines run in parallel (~600ms total):
      //
      //   Opacity  — quick appear (80ms), hold (170ms), fade out (350ms)
      //   Scale    — pop in with overshoot:
      //                0 → 1.15 over 160ms (cubic ease-out, fast punch)
      //                1.15 → 1.0 over 140ms (settle back)
      //   TranslateY — drift up 50px over 600ms (ease-out quad)
      //
      // The scale sequence (300ms) completes well inside the opacity hold,
      // so the settled size is visible for most of the lifetime.
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 80,  useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 170, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
        Animated.sequence([
          // Punch up past target
          Animated.timing(scale, {
            toValue: 1.15,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          // Settle back to natural size
          Animated.timing(scale, {
            toValue: 1.0,
            duration: 140,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(translateY, {
          toValue: -50,
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

  const fontSize = BASE_FONT_SIZE * sizeFactor;

  return (
    <Animated.View
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
      <Text style={[styles.text, { fontSize }]}>{word}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    // pointerEvents in style (RN 0.76+) — was deprecated as a prop
    pointerEvents: 'none',
  },
  text: {
    // Inter Bold loaded via expo-google-fonts in the root layout
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
    color: '#FFFFFF',
    // Stronger shadow so the chunky text holds against bright media.
    // textShadow shorthand (RN 0.76 / React Native Web)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ textShadow: '0px 2px 10px rgba(0,0,0,0.9)' } as any),
  },
});
