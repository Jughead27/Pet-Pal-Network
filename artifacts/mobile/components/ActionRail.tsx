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
 */

import React, { useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
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
  const scale = useSharedValue(1);
  const labelOpacity = useSharedValue(0);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
  }));

  const handlePress = () => {
    // Spring-bounce on press
    scale.value = withSequence(
      withSpring(0.7, { damping: 10, stiffness: 300 }),
      withSpring(1.2, { damping: 10, stiffness: 300 }),
      withSpring(1, { damping: 12, stiffness: 200 }),
    );

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Teaching label — shows only once, floats left then fades
    if (teachingLabel && !hasShownLabel.current) {
      hasShownLabel.current = true;
      labelOpacity.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(1, { duration: 900 }),
        withTiming(0, { duration: 350 }),
      );
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
          style={[styles.teachingLabel, { color: colors.foreground }, labelStyle]}
          pointerEvents="none"
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
        <Animated.View style={iconStyle}>
          {renderIcon(iconColor, 24)}
        </Animated.View>
        {countText !== undefined && (
          <Text style={[styles.count, { color: 'rgba(240,244,248,0.85)' }]}>
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
}

export default function ActionRail({
  onCommentPress,
  onSharePress,
}: ActionRailProps) {
  const colors = useColors();
  const {
    boop,
    treat,
    boopCount,
    treatCount,
    comments,
    hasBoopedOnce,
    hasTreatedOnce,
  } = useApp();

  return (
    <View style={styles.rail}>
      {/* 1. Boop */}
      <ActionItem
        renderIcon={(color, size) => <BoopIcon color={color} size={size} />}
        count={boopCount}
        onPress={boop}
        teachingLabel="Boop"
        activeColor={colors.accent}
        isActive={hasBoopedOnce}
        testID="boop-button"
      />

      {/* 2. Treat */}
      <ActionItem
        renderIcon={(color, size) => <TreatIcon color={color} size={size} />}
        count={treatCount}
        onPress={treat}
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
        count={comments.length}
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
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Absolutely positioned; never shifts the icon column
  teachingLabel: {
    position: 'absolute',
    right: 44,
    top: 4,
    fontSize: 11,
    fontWeight: '600' as const,
    // Reanimated controls opacity — start invisible
    opacity: 0,
  },
});
