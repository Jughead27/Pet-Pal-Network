import React, { useCallback, useRef, useState } from 'react';
import { Animated, Platform, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { formatCount } from '@/utils/formatCount';
import { BoopSpark, SPARK_CAP, RING_CAP } from './BoopSpark';
import { BoopRing } from './BoopRing';
import { BoopIcon } from './icons';
import { styles } from './styles';

// ─── BoopRailItem ─────────────────────────────────────────────────────────────
// Dedicated boop button with:
//   • Spring squash-and-bounce: 0.85 → 1.25 → 1.0
//   • Coral ripple ring per press (overlapping on rapid presses)
//   • Medium impact haptic (physical weight on a real phone)
//   • Reduced-motion: no ring, no spring, haptic unchanged

interface BoopRailItemProps {
  count: number;
  onPress: () => void;
  isActive: boolean;
  activeColor: string;
  reducedMotion: boolean;
}

export function BoopRailItem({
  count,
  onPress,
  isActive,
  activeColor,
  reducedMotion,
}: BoopRailItemProps) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;

  // Stack of live spark burst IDs — capped at SPARK_CAP for rapid-tap safety.
  const [sparks, setSparks] = useState<number[]>([]);
  const sparkIdRef = useRef(0);

  const removeSpark = useCallback((id: number) => {
    setSparks((prev) => prev.filter((s) => s !== id));
  }, []);

  // Stack of live ring IDs — capped at RING_CAP for rapid-tap safety.
  const [rings, setRings] = useState<number[]>([]);
  const ringIdRef = useRef(0);

  const removeRing = useCallback((id: number) => {
    setRings((prev) => prev.filter((r) => r !== id));
  }, []);

  const handlePress = useCallback(() => {
    if (!reducedMotion) {
      // Spring: quick squash → energetic overshoot → springy settle
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 0.85,
          damping: 6,
          stiffness: 500,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1.25,
          damping: 4,
          stiffness: 380,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1.0,
          damping: 12,
          stiffness: 180,
          useNativeDriver: true,
        }),
      ]).start();

      // Spawn a coral spark burst (capped so rapid tapping stays smooth).
      if (sparks.length < SPARK_CAP) {
        const id = ++sparkIdRef.current;
        setSparks((prev) => [...prev, id]);
      }

      // Spawn an expanding coral ring — the impact layer behind the sparks.
      if (rings.length < RING_CAP) {
        const id = ++ringIdRef.current;
        setRings((prev) => [...prev, id]);
      }
    }

    // Medium impact — lands physically on a real phone
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
    }

    onPress();
  }, [reducedMotion, scale, sparks, rings, onPress]);

  const iconColor = isActive ? activeColor : colors.foreground;
  const countText = formatCount(count);

  return (
    <View style={styles.itemWrapper}>
      {/*
        Icon area: a fixed-size relative container so ripple rings (absolute,
        centered) expand outward from the icon's midpoint without clipping the
        count label below.
      */}
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.7}
        style={styles.itemTouchable}
        testID="boop-button"
        accessibilityLabel="Boop"
        accessibilityRole="button"
      >
        <View style={styles.boopIconArea}>
          {/* Expanding ring — impact layer, rendered below sparks and icon */}
          {rings.map((id) => (
            <BoopRing
              key={id}
              color={activeColor}
              onDone={() => removeRing(id)}
            />
          ))}
          {/* Coral spark bursts — rendered above ring, below icon */}
          {sparks.map((id) => (
            <BoopSpark
              key={id}
              color={activeColor}
              onDone={() => removeSpark(id)}
            />
          ))}
          <Animated.View style={{ transform: [{ scale }] }}>
            <BoopIcon color={iconColor} size={28} />
          </Animated.View>
        </View>
        <Text style={styles.count}>{countText}</Text>
      </TouchableOpacity>
    </View>
  );
}
