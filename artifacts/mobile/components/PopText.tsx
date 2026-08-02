/**
 * PopText — one independent reaction pop animation.
 *
 * Spawned per press. Animates:
 *   Scale   — 0 → 1.25 (overshoot, 160ms) → 1.0 (settle, 140ms)
 *   Drift   — up 70px over 650ms (Easing.out quad)
 *   Opacity — appear 80ms, hold 170ms, fade 400ms → ~650ms total
 *
 * Each pop carries its own stable sizeFactor (0.8–1.4×) generated on mount,
 * producing varied sizes across a rapid-fire burst without any external input.
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
const BASE_FONT_SIZE = Platform.OS === 'web' ? 32 : 44;

interface PopTextProps {
  word: string;
  /** Accent color for the pop text — coral for boop, gold for treat. */
  color: string;
  /** Degrees of random tilt, ±15 */
  rotation: number;
  onDone: () => void;
  reducedMotion: boolean;
  /** Absolute position from right edge of the page (px) */
  right: number;
  /** Absolute position from bottom edge of the page (px) */
  bottom: number;
}

export default function PopText({
  word,
  color,
  rotation,
  onDone,
  reducedMotion,
  right,
  bottom,
}: PopTextProps) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale      = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  // Stable random size factor in 0.8–1.4× — wider range than before for
  // more visual variety across a burst. Generated once on mount via useRef.
  const sizeFactor = useRef(0.8 + Math.random() * 0.60).current;

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
      <Text style={[styles.text, { fontSize, color }]}>{word}</Text>
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
    // Strong shadow so chunky text holds against bright media.
    //
    // Platform split is required: React Native Web understands the CSS
    // shorthand string, but the iOS/Android native bridge silently drops any
    // style key it doesn't recognise — so colored text on a bright photo
    // becomes invisible without the three-prop form on native.
    ...(Platform.OS === 'web'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ({ textShadow: '0px 2px 12px rgba(0,0,0,0.90)' } as any)
      : ({
          textShadowColor: 'rgba(0,0,0,0.90)',
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 12,
        } as any)),
  },
});
