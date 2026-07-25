/**
 * ActionRail — vertical right-side interaction rail.
 *
 * Contains exactly four actions in this order:
 *   1. Boop
 *   2. Treat
 *   3. Comment
 *   4. Share
 *
 * Boop and Treat icons are isolated in swappable wrapper components
 * (BoopIcon / TreatIcon) — replace their contents to use custom assets.
 *
 * Teaching labels: on the very first tap of Boop or Treat, a small text
 * label briefly appears to the left of the icon then disappears permanently.
 *
 * Animations use React Native's built-in Animated API — no Reanimated needed.
 */

import React, { useRef } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

// ─── Swappable Icon Components ───────────────────────────────────────────────
// Replace the contents of these components to use custom Boop / Treat icons.

function BoopIcon({ color, size }: { color: string; size: number }) {
  // SWAP: replace with your custom Boop icon — currently a pointing/tap finger
  return (
    <MaterialCommunityIcons name="gesture-tap" size={size} color={color} />
  );
}

function TreatIcon({ color, size }: { color: string; size: number }) {
  // SWAP: replace with your custom Treat icon — currently a dog bone outline
  return (
    <MaterialCommunityIcons name="bone" size={size} color={color} />
  );
}

// ─── ActionItem ───────────────────────────────────────────────────────────────

interface ActionItemProps {
  renderIcon: (color: string, size: number) => React.ReactNode;
  count?: number;
  onPress: () => void;
  /** If provided, shows this text label once on the first press */
  teachingLabel?: string;
  activeColor?: string;
  isActive?: boolean;
  testID?: string;
}

function ActionItem({
  renderIcon,
  count,
  onPress,
  teachingLabel,
  activeColor,
  isActive,
  testID,
}: ActionItemProps) {
  const colors = useColors();
  const hasShownLabel = useRef(false);

  // Built-in Animated.Value — works in Expo Go regardless of Reanimated version.
  const scale = useRef(new Animated.Value(1)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    // Spring-bounce sequence on press: compress → overshoot → settle
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.7, damping: 10, stiffness: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.2, damping: 10, stiffness: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.0, damping: 12, stiffness: 200, useNativeDriver: true }),
    ]).start();

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Teaching label — shows only once, fades in then out
    if (teachingLabel && !hasShownLabel.current) {
      hasShownLabel.current = true;
      Animated.sequence([
        Animated.timing(labelOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(labelOpacity, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(labelOpacity, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]).start();
    }

    onPress();
  };

  const iconColor = isActive
    ? (activeColor ?? colors.primary)
    : colors.foreground;

  const countText = count !== undefined ? formatCount(count) : undefined;

  return (
    <View style={styles.itemWrapper}>
      {/* Teaching label — absolutely positioned to the left, never affects layout */}
      {teachingLabel ? (
        <Animated.Text
          style={[styles.teachingLabel, { color: colors.foreground, opacity: labelOpacity }]}
        >
          {teachingLabel}
        </Animated.Text>
      ) : null}

      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.7}
        style={styles.itemTouchable}
        testID={testID}
        accessibilityLabel={teachingLabel ?? undefined}
        accessibilityRole="button"
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          {renderIcon(iconColor, 24)}
        </Animated.View>
        {countText !== undefined && (
          <Text style={styles.count}>
            {countText}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── ActionRail ───────────────────────────────────────────────────────────────

interface ActionRailProps {
  onCommentPress: () => void;
  onSharePress: () => void;
  /** Called on every Boop press, after state update — use to spawn a pop */
  onBoopFired?: () => void;
  /** Called on every Treat press, after state update — use to spawn a pop */
  onTreatFired?: () => void;
}

export default function ActionRail({
  onCommentPress,
  onSharePress,
  onBoopFired,
  onTreatFired,
}: ActionRailProps) {
  const colors = useColors();
  const {
    boop,
    treat,
    boopCount,
    treatCount,
    comments,
    serverCommentCount,
    hasBoopedOnce,
    hasTreatedOnce,
  } = useApp();

  const handleBoopPress = () => {
    // Web haptic: one short tick
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
    boop();
    onBoopFired?.();
  };

  const handleTreatPress = () => {
    // Web haptic: double tick — distinct from boop
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([10, 40, 10]);
    }
    // Native haptic: two light impacts ~60ms apart so treats feel distinct from boops
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 60);
    }
    treat();
    onTreatFired?.();
  };

  // Comment count = server baseline + locally added comments (optimistic)
  const commentCount = serverCommentCount + comments.length;

  return (
    <View style={styles.rail}>
      {/* 1. Boop */}
      <ActionItem
        renderIcon={(color, size) => <BoopIcon color={color} size={size} />}
        count={boopCount}
        onPress={handleBoopPress}
        teachingLabel="Boop"
        activeColor={colors.accent}
        isActive={hasBoopedOnce}
        testID="boop-button"
      />

      {/* 2. Treat */}
      <ActionItem
        renderIcon={(color, size) => <TreatIcon color={color} size={size} />}
        count={treatCount}
        onPress={handleTreatPress}
        teachingLabel="Treat"
        activeColor="#F4C542"
        isActive={hasTreatedOnce}
        testID="treat-button"
      />

      {/* 3. Comment */}
      <ActionItem
        renderIcon={(color) => (
          <Ionicons name="chatbubble-outline" size={20} color={color} />
        )}
        count={commentCount}
        onPress={onCommentPress}
        testID="comment-button"
      />

      {/* 4. Share */}
      <ActionItem
        renderIcon={(color) => (
          <Ionicons name="paper-plane-outline" size={20} color={color} />
        )}
        onPress={onSharePress}
        testID="share-button"
      />
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  rail: {
    alignItems: 'center',
    gap: 22,
    paddingVertical: 4,
  },
  // Each item: icon + count centered, teaching label floats left absolutely
  itemWrapper: {
    alignItems: 'center',
    position: 'relative',
  },
  itemTouchable: {
    alignItems: 'center',
    gap: 4,
    // Consistent 40px wide touch target keeps the rail visually tight
    width: 40,
    paddingVertical: 2,
  },
  count: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
    textAlign: 'center',
    color: 'rgba(240,244,248,0.85)',
    // textShadow shorthand (RN 0.76 / React Native Web) — replaces deprecated
    // textShadowColor / textShadowOffset / textShadowRadius triple.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ textShadow: '0px 1px 3px rgba(0,0,0,0.4)' } as any),
  },
  // Absolutely positioned; never shifts the icon column.
  // pointerEvents in style (RN 0.76+) — was deprecated as a prop.
  teachingLabel: {
    position: 'absolute',
    right: 44,
    top: 4,
    fontSize: 11,
    fontWeight: '600' as const,
    pointerEvents: 'none',
  },
});
