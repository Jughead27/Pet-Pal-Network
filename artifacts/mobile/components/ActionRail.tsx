/**
 * ActionRail — vertical right-side interaction rail.
 *
 * Counts and viewer-state are passed as props (not read from AppContext) so
 * each FeedPage page can be fully isolated.
 *
 * Four actions in order:
 *   1. Boop   — instant & optimistic; POST fires in background
 *   2. Treat  — server-confirmed; gold state/count only update on success;
 *               transient countdown on success, bone-shake on 429, nudge on 403
 *   3. Comment
 *   4. Share
 *
 * All animations use React Native's built-in Animated API — no Reanimated.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useBoopPost, useTreatPost } from '@workspace/api-client-react';

// AsyncStorage keys for one-time teaching labels (persist across reloads).
const TEACHING_KEY_BOOP  = 'fishbook:teaching:boop';
const TEACHING_KEY_TREAT = 'fishbook:teaching:treat';

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function BoopIcon({ color, size }: { color: string; size: number }) {
  return <MaterialCommunityIcons name="gesture-tap" size={size} color={color} />;
}

function TreatIcon({ color, size }: { color: string; size: number }) {
  return <MaterialCommunityIcons name="bone" size={size} color={color} />;
}

// ─── ActionItem ───────────────────────────────────────────────────────────────

interface ActionItemProps {
  renderIcon: (color: string, size: number) => React.ReactNode;
  count?: number;
  onPress: () => void;
  /** Plain accessibility label — no animation. Teaching pops now use the pop system. */
  accessibilityLabel?: string;
  activeColor?: string;
  isActive?: boolean;
  testID?: string;
}

function ActionItem({
  renderIcon,
  count,
  onPress,
  accessibilityLabel,
  activeColor,
  isActive,
  testID,
}: ActionItemProps) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.7, damping: 10, stiffness: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.2, damping: 10, stiffness: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.0, damping: 12, stiffness: 200, useNativeDriver: true }),
    ]).start();

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    onPress();
  };

  const iconColor = isActive ? (activeColor ?? colors.primary) : colors.foreground;
  const countText = count !== undefined ? formatCount(count) : undefined;

  return (
    <View style={styles.itemWrapper}>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.7}
        style={styles.itemTouchable}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          {renderIcon(iconColor, 24)}
        </Animated.View>
        {countText !== undefined && (
          <Text style={styles.count}>{countText}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── ActionRail ───────────────────────────────────────────────────────────────

interface ActionRailProps {
  postId: string;
  // Per-page counts and viewer state (controlled by FeedPage)
  boopCount: number;
  treatCount: number;
  commentCount: number;
  viewerHasBooped: boolean;
  viewerHasTreated: boolean;
  // State-update callbacks — FeedPage applies these to its own useState
  onBoopOptimistic: () => void;
  onTreatSuccess: (newTreatCount: number, treatsRemaining: number) => void;
  // UI callbacks
  onCommentPress: () => void;
  onSharePress: () => void;
  /** Called after boop optimistic update — use to spawn a "Boop!" pop. */
  onBoopFired?: () => void;
  /**
   * Called after treat server-confirmed SUCCESS only — use to spawn a "Yum!" pop.
   * Intentionally never called on 429 / 403 so rejected treats produce no pop.
   */
  onTreatFired?: () => void;
  /**
   * Fired with true when a transient label becomes visible, false when it fades
   * out. Lets FeedPage shift pop spawn points away from the label area.
   */
  onTransientChange?: (visible: boolean) => void;
  /**
   * Called on the very first boop (per device, persisted in AsyncStorage) so
   * FeedPage can spawn a large "Boop" teaching pop via the unified pop system.
   * Boops are optimistic, so this fires immediately on press like onBoopFired.
   */
  onBoopTeaching?: () => void;
  /**
   * Called on the very first SUCCESSFUL treat (per device, persisted in
   * AsyncStorage). Only fires in onSuccess — never on 429 / 403.
   */
  onTreatTeaching?: () => void;
}

export default function ActionRail({
  postId,
  boopCount,
  treatCount,
  commentCount,
  viewerHasBooped,
  viewerHasTreated,
  onBoopOptimistic,
  onTreatSuccess,
  onCommentPress,
  onSharePress,
  onBoopFired,
  onTreatFired,
  onTransientChange,
  onBoopTeaching,
  onTreatTeaching,
}: ActionRailProps) {
  const colors = useColors();

  // ── Boop mutation (fire-and-forget after optimistic update) ────────────────
  const { mutate: doBoopPost } = useBoopPost();

  // ── Treat mutation with server-confirmed flow ──────────────────────────────
  const { mutate: doTreatPost } = useTreatPost();
  const isTreatPending = useRef(false);

  // Bone-shake animation for 429 / 403
  const treatShakeX = useRef(new Animated.Value(0)).current;

  // Transient message (countdown, limit warning, self-treat nudge)
  const transientOpacity = useRef(new Animated.Value(0)).current;
  const [transientMsg, setTransientMsg] = useState('');

  // ── Teaching-label has-seen flags (persisted per device via AsyncStorage) ──
  // Refs mean we never re-render on flag change and the callback closures stay
  // stable. AsyncStorage is read once on mount; writes are fire-and-forget.
  const hasBoopTeachingRef  = useRef(false);
  const hasTreatTeachingRef = useRef(false);

  useEffect(() => {
    AsyncStorage.multiGet([TEACHING_KEY_BOOP, TEACHING_KEY_TREAT])
      .then(([[, boop], [, treat]]) => {
        if (boop  === 'true') hasBoopTeachingRef.current  = true;
        if (treat === 'true') hasTreatTeachingRef.current = true;
      })
      .catch(() => { /* ignore storage errors — teaching labels are best-effort */ });
  }, []);

  const showTransient = useCallback(
    (msg: string, holdMs = 1500) => {
      setTransientMsg(msg);
      transientOpacity.setValue(0);
      // Notify parent so it can shift pop spawn points away from this label.
      onTransientChange?.(true);
      Animated.sequence([
        Animated.timing(transientOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(transientOpacity, { toValue: 1, duration: holdMs, useNativeDriver: true }),
        Animated.timing(transientOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onTransientChange?.(false);
      });
    },
    [transientOpacity, onTransientChange],
  );

  const shakeAnimation = useCallback(() => {
    treatShakeX.setValue(0);
    Animated.sequence([
      Animated.timing(treatShakeX, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(treatShakeX, { toValue:  6, duration: 50, useNativeDriver: true }),
      Animated.timing(treatShakeX, { toValue: -4, duration: 50, useNativeDriver: true }),
      Animated.timing(treatShakeX, { toValue:  4, duration: 50, useNativeDriver: true }),
      Animated.timing(treatShakeX, { toValue:  0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [treatShakeX]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleBoopPress = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
    onBoopOptimistic();
    onBoopFired?.();
    // Teaching pop — first boop ever on this device. Boops are optimistic so
    // this fires immediately alongside onBoopFired.
    if (!hasBoopTeachingRef.current) {
      hasBoopTeachingRef.current = true;
      AsyncStorage.setItem(TEACHING_KEY_BOOP, 'true').catch(() => {});
      onBoopTeaching?.();
    }
    doBoopPost({ id: postId });
  };

  const handleTreatPress = () => {
    if (isTreatPending.current) return;

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([10, 40, 10]);
    }
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 60);
    }

    isTreatPending.current = true;
    doTreatPost(
      { id: postId },
      {
        onSuccess: (data) => {
          isTreatPending.current = false;
          onTreatSuccess(data.treatCount, data.treatsRemainingToday);
          const remaining = data.treatsRemainingToday;
          // showTransient FIRST so isTransientVisibleRef is true before any pop
          // callbacks run — both Yum! and teaching pops will use the extra offset.
          showTransient(remaining === 0 ? 'Last one!' : `${remaining} left`, 1500);
          onTreatFired?.();
          // Teaching pop — first successful treat ever on this device.
          // onError never reaches here, so this is success-gated by construction.
          if (!hasTreatTeachingRef.current) {
            hasTreatTeachingRef.current = true;
            AsyncStorage.setItem(TEACHING_KEY_TREAT, 'true').catch(() => {});
            onTreatTeaching?.();
          }
        },
        onError: (error) => {
          isTreatPending.current = false;
          const status = (error as { status?: number }).status;
          if (status === 429) {
            shakeAnimation();
            showTransient('Out of treats until tomorrow', 2500);
          } else if (status === 403) {
            // Shake on self-treat too — same shake+message pattern, no pop.
            shakeAnimation();
            showTransient('Your own pet? Sneaky.', 2000);
          }
          // onTreatFired and onTreatTeaching are intentionally NOT called here.
          // Rejected treats (429 / 403) must produce no pop of any kind — only
          // the shake and transient message above.
        },
      },
    );
  };

  return (
    <View style={styles.rail}>

      {/* 1. Boop */}
      <ActionItem
        renderIcon={(color, size) => <BoopIcon color={color} size={size} />}
        count={boopCount}
        onPress={handleBoopPress}
        accessibilityLabel="Boop"
        activeColor={colors.accent}
        isActive={viewerHasBooped}
        testID="boop-button"
      />

      {/* 2. Treat — wrapped for bone-shake and transient message */}
      <View style={styles.treatSection}>
        {/* Transient label floats to the left — positioned well clear of the rail column */}
        <Animated.Text
          style={[
            styles.transientLabel,
            { color: colors.foreground, opacity: transientOpacity },
          ]}
          numberOfLines={2}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pointerEvents={'none' as any}
        >
          {transientMsg}
        </Animated.Text>

        {/* Bone-shake wrapper */}
        <Animated.View style={{ transform: [{ translateX: treatShakeX }] }}>
          <ActionItem
            renderIcon={(color, size) => <TreatIcon color={color} size={size} />}
            count={treatCount}
            onPress={handleTreatPress}
            accessibilityLabel="Treat"
            activeColor="#F4C542"
            isActive={viewerHasTreated}
            testID="treat-button"
          />
        </Animated.View>
      </View>

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
  treatSection: {
    alignItems: 'center',
    position: 'relative',
  },
  // Transient label: right: 50 puts its right edge 50px from the treat icon's
  // right edge; width: 120 extends it leftward — safely left of the rail column.
  transientLabel: {
    position: 'absolute',
    right: 50,
    width: 120,
    textAlign: 'right',
    top: 2,
    fontSize: 10,
    fontWeight: '600' as const,
    lineHeight: 13,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointerEvents: 'none' as any,
  },
  itemWrapper: {
    alignItems: 'center',
    position: 'relative',
  },
  itemTouchable: {
    alignItems: 'center',
    gap: 4,
    width: 40,
    paddingVertical: 2,
  },
  count: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
    textAlign: 'center',
    color: 'rgba(240,244,248,0.85)',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ textShadow: '0px 1px 3px rgba(0,0,0,0.4)' } as any),
  },
});
