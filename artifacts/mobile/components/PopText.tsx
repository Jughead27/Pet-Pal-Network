/**
 * PopText — one independent reaction pop animation.
 *
 * Spawned per press. Animates:
 *   Scale   — 0 → 1.25 (overshoot, 160ms) → 1.0 (settle, 140ms)
 *   Drift   — up 70px over 650ms (Easing.out quad)
 *   Opacity — appear 80ms, hold 170ms, fade 400ms → ~650ms total
 *
 * Each pop carries its own stable sizeFactor (±15%) generated on mount,
 * so rapid-fire boops produce varied sizes rather than identical stamps.
 * The caller may supply sizeMult (>1) for rapid-fire escalation — each
 * successive boop within a window gets slightly bigger, compounding the
 * applause feel on a physical phone.
 *
 * Base font size is 44px on native (clearly legible at arm's length) and
 * 32px on web (web viewports are typically further from the user's eyes).
 *
 * With reducedMotion: simple fade pops, no movement, no scale overshoot.
 *
 * Implemented with React Native's built-in Animated API (NOT Reanimated) so it
 * works in Expo Go regardless of the bundled Reanimated version.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text } from 'react-native';

// Base font size — larger on native where the phone is held close and the
// pop needs to read at arm's length; slightly smaller on web.
// Effective native range with ±15% sizeFactor: 44 × [0.85, 1.15] ≈ 37–51px.
const BASE_FONT_SIZE = Platform.OS === 'web' ? 32 : 44;

interface PopTextProps {
  word: string;
  /** Degrees of random tilt, -8 to +8 */
  rotation: number;
  onDone: () => void;
  reducedMotion: boolean;
  /** Absolute position from right edge of the page (px) */
  right: number;
  /** Absolute position from bottom edge of the page (px) */
  bottom: number;
  /**
   * Rapid-fire escalation multiplier (default 1.0).
   * Each successive boop within the combo window passes a larger value
   * (e.g. 1.07, 1.14, 1.20) so enthusiasm visibly compounds.
   */
  sizeMult?: number;
}

export default function PopText({
  word,
  rotation,
  onDone,
  reducedMotion,
  right,
  bottom,
  sizeMult = 1,
}: PopTextProps) {
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
      // All three timelines run in parallel (~650ms total):
      //
      //   Opacity    — quick appear (80ms), hold (170ms), fade out (400ms)
      //   Scale      — pop in with overshoot:
      //                  0 → 1.25 over 160ms (cubic ease-out, punchy)
      //                  1.25 → 1.0 over 140ms (settle back)
      //   TranslateY — drift up 70px over 650ms (ease-out quad)
      //
      // The scale sequence (300ms) completes well inside the opacity hold,
      // so the settled size is visible for most of the lifetime.
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 80,  useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 170, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          // Punch up past target — stronger overshoot for a more physical feel
          Animated.timing(scale, {
            toValue: 1.25,
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
          toValue: -70,
          duration: 650,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) onDone();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Final font size = base × per-instance size variance × rapid-fire multiplier
  const fontSize = BASE_FONT_SIZE * sizeFactor * sizeMult;

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
    // Strong shadow so chunky text holds against bright media.
    //
    // Platform split is required: React Native Web understands the CSS
    // shorthand string, but the iOS/Android native bridge silently drops any
    // style key it doesn't recognise — so white text on a bright photo becomes
    // invisible without the three-prop form on native.
    ...(Platform.OS === 'web'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ({ textShadow: '0px 2px 12px rgba(0,0,0,0.95)' } as any)
      : ({
          textShadowColor: 'rgba(0,0,0,0.95)',
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 12,
        } as any)),
  },
});
