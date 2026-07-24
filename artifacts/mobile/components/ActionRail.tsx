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
 * label briefly appears next to the icon then disappears permanently.
 */

import React, { useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

// ─── Swappable Icon Components ───────────────────────────────────────────────
// Replace the contents of these components to use custom Boop / Treat icons.

function BoopIcon({ color, size }: { color: string; size: number }) {
  // SWAP: replace <Feather> with your custom Boop icon component
  return <Feather name="heart" size={size} color={color} />;
}

function TreatIcon({ color, size }: { color: string; size: number }) {
  // SWAP: replace <Feather> with your custom Treat icon component
  return <Feather name="star" size={size} color={color} />;
}

// ─── ActionItem ───────────────────────────────────────────────────────────────

interface ActionItemProps {
  /** Renders the icon at the given color/size */
  renderIcon: (color: string, size: number) => React.ReactNode;
  count?: number;
  onPress: () => void;
  /** If provided, shows this text label once on the first press */
  teachingLabel?: string;
  /** Accent color when active */
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
  const labelTranslateX = useSharedValue(0);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ translateX: labelTranslateX.value }],
  }));

  const handlePress = () => {
    // Scale bounce
    scale.value = withSequence(
      withSpring(0.7, { damping: 10, stiffness: 300 }),
      withSpring(1.2, { damping: 10, stiffness: 300 }),
      withSpring(1, { damping: 12, stiffness: 200 }),
    );

    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Teaching label — show only on very first tap
    if (teachingLabel && !hasShownLabel.current) {
      hasShownLabel.current = true;
      labelTranslateX.value = 0;
      labelOpacity.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(1, { duration: 1000 }),
        withTiming(0, { duration: 300 }),
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
      {/* Teaching label — positioned to the left of the icon */}
      {teachingLabel ? (
        <Animated.Text
          style={[
            styles.teachingLabel,
            { color: colors.foreground },
            labelStyle,
          ]}
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
          <Text style={[styles.count, { color: colors.mutedForeground }]}>
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
  const { boop, treat, boopCount, treatCount, comments, hasBoopedOnce, hasTreatedOnce } = useApp();

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
        renderIcon={(color, size) => (
          <Ionicons name="chatbubble-outline" size={size} color={color} />
        )}
        count={comments.length}
        onPress={onCommentPress}
        testID="comment-button"
      />

      {/* 4. Share */}
      <ActionItem
        renderIcon={(color, size) => (
          <Ionicons name="paper-plane-outline" size={size} color={color} />
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
    gap: 24,
    paddingVertical: 8,
  },
  itemWrapper: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  itemTouchable: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  count: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
  teachingLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    marginRight: 6,
    opacity: 0,
    // Positioned inline; Animated controls actual opacity
  },
});
