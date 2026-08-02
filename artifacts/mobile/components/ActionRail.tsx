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
  Easing,
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

// ─── BoopRipple ───────────────────────────────────────────────────────────────
// A single coral ring that expands and fades from the boop icon on each press.
// Multiple instances stack so rapid presses produce overlapping ripples.

interface BoopRippleProps {
  color: string;
  onDone: () => void;
}

function BoopRipple({ color, onDone }: BoopRippleProps) {
  const scale   = useRef(new Animated.Value(0.25)).current;
  const opacity = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 3.2,
        duration: 480,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 480,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.rippleRing,
        { borderColor: color, transform: [{ scale }], opacity },
      ]}
      // pointerEvents in style (RN 0.76+)
      pointerEvents="none"
    />
  );
}

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

function BoopRailItem({
  count,
  onPress,
  isActive,
  activeColor,
  reducedMotion,
}: BoopRailItemProps) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;

  // Stack of live ripple IDs — multiple can coexist during rapid presses.
  const [ripples, setRipples] = useState<number[]>([]);
  const rippleIdRef = useRef(0);

  const removeRipple = useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r !== id));
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

      // Spawn a new coral ripple ring
      const id = ++rippleIdRef.current;
      setRipples((prev) => [...prev, id]);
    }

    // Medium impact — lands physically on a real phone
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
    }

    onPress();
  }, [reducedMotion, scale, onPress]);

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
          {/* Coral ripple rings — rendered behind the icon, overflow: visible */}
          {ripples.map((id) => (
            <BoopRipple
              key={id}
              color={activeColor}
              onDone={() => removeRipple(id)}
            />
          ))}
          <Animated.View style={{ transform: [{ scale }] }}>
            <BoopIcon color={iconColor} size={24} />
          </Animated.View>
        </View>
        <Text style={styles.count}>{countText}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── ActionItem ───────────────────────────────────────────────────────────────
// Generic rail item used for treat, comment, and share.

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
      Animated.spring(scale, { toValue: 0.7,  damping: 10, stiffness: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.2,  damping: 10, stiffness: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.0,  damping: 12, stiffness: 200, useNativeDriver: true }),
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
   * Called when the user hits the daily treat limit (429). Caller renders a
   * full-width readable toast — the narrow in-rail transient can't fit the copy.
   */
  onOutOfTreats?: () => void;
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
  /**
   * Whether the user has reduced motion enabled. When true, BoopRailItem
   * skips the spring and ripple ring (haptics are unchanged per spec).
   */
  reducedMotion?: boolean;
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
  onOutOfTreats,
  onTransientChange,
  onBoopTeaching,
  onTreatTeaching,
  reducedMotion = false,
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

  // handleBoopPress is called by BoopRailItem after it fires its own
  // animation + haptic. It handles the state/API side only.
  const handleBoopPress = useCallback(() => {
    onBoopOptimistic();
    // Teaching pop — first boop ever on this device.
    // Only ONE label may show: if this is a teaching moment, spawn the teaching
    // pop ("Boop") and suppress the regular pop ("Boop!") so they can't overlap.
    // On every subsequent boop, spawn only the regular pop.
    if (!hasBoopTeachingRef.current) {
      hasBoopTeachingRef.current = true;
      AsyncStorage.setItem(TEACHING_KEY_BOOP, 'true').catch(() => {});
      onBoopTeaching?.();
    } else {
      onBoopFired?.();
    }
    doBoopPost({ id: postId });
  }, [onBoopOptimistic, onBoopFired, onBoopTeaching, doBoopPost, postId]);

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
          // callbacks run — the pop will use the extra right offset.
          showTransient(remaining === 0 ? 'Last one!' : `${remaining} left`, 1500);
          // Teaching pop — first successful treat ever on this device.
          // Exclusive: either the teaching pop ("Treat") OR the regular pop ("Yum!")
          // fires, never both simultaneously. Matches the boop pattern exactly.
          if (!hasTreatTeachingRef.current) {
            hasTreatTeachingRef.current = true;
            AsyncStorage.setItem(TEACHING_KEY_TREAT, 'true').catch(() => {});
            onTreatTeaching?.();
          } else {
            onTreatFired?.();
          }
        },
        onError: (error) => {
          isTreatPending.current = false;
          const status = (error as { status?: number }).status;
          if (status === 403) {
            // Self-treat nudge — narrow transient is fine for this short copy.
            shakeAnimation();
            showTransient('Your own pet? Sneaky.', 2000);
          } else {
            // 429 (daily limit) or any other rejection:
            // 1. Instantly clear any lingering transient (e.g. "Last one!" from
            //    the preceding success) so the narrow label goes dark immediately.
            // 2. Fire the full-width FeedPage toast — the ONLY surface for this.
            //    The narrow ~120 px transientLabel must NEVER show the out-of-treats
            //    copy; it would clip it. We clear it first, unconditionally.
            transientOpacity.setValue(0);
            onTransientChange?.(false);
            shakeAnimation();
            onOutOfTreats?.();
          }
          // onTreatFired and onTreatTeaching are intentionally NOT called here.
          // Rejected treats must produce no pop of any kind — only the shake.
        },
      },
    );
  };

  return (
    <View style={styles.rail}>

      {/* 1. Boop — dedicated item with spring, ripple, medium haptic */}
      <BoopRailItem
        count={boopCount}
        onPress={handleBoopPress}
        isActive={viewerHasBooped}
        activeColor={colors.accent}
        reducedMotion={reducedMotion}
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
    // overflow: visible is required on iOS — RN defaults to 'hidden' for Views,
    // which would clip the ripple ring as it expands beyond the rail column.
    overflow: 'visible',
  },
  treatSection: {
    alignItems: 'center',
    position: 'relative',
  },
  // Transient label: positioned BELOW the treat icon+count (top: 44) so it sits
  // beneath the pop spawn zone. Yum! pops spawn at ~bottomOffset+143 (above the
  // treat section bottom) and float upward — placing the label below that level
  // ensures pops never float through it. right: 50 / width: 120 keeps it well
  // left of the rail column.
  transientLabel: {
    position: 'absolute',
    right: 50,
    width: 120,
    textAlign: 'right',
    top: 44,
    fontSize: 10,
    fontWeight: '600' as const,
    lineHeight: 13,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointerEvents: 'none' as any,
  },
  itemWrapper: {
    alignItems: 'center',
    position: 'relative',
    // Must be visible on iOS — default is hidden, which clips the ripple ring.
    overflow: 'visible',
  },
  itemTouchable: {
    alignItems: 'center',
    gap: 4,
    width: 40,
    paddingVertical: 2,
    // Must be visible: TouchableOpacity is a View on iOS; without this, the
    // 40px-wide touchable clips the ~102px-diameter ripple ring at the boundary.
    overflow: 'visible',
  },
  // Boop icon container — overflow: visible so ripple rings expand beyond
  // the 40×40 bounds without being clipped. Fixed size for consistent ripple
  // positioning via absolute centering.
  boopIconArea: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  // Coral ripple ring — starts at scale 0.25 (8px diameter) and expands
  // to scale 3.2 (~102px) while fading. Base ring is 32×32 with a 2.5px border.
  rippleRing: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
    // background is transparent — it's a ring, not a filled circle
    backgroundColor: 'transparent',
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
