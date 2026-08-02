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
import { HandTap, Bone, ChatCircle, ShareNetwork } from 'phosphor-react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useBoopPost, useTreatPost } from '@workspace/api-client-react';

// AsyncStorage keys for one-time teaching labels (persist across reloads).
const TEACHING_KEY_BOOP  = 'fishbook:teaching:boop';
const TEACHING_KEY_TREAT = 'fishbook:teaching:treat';

// ─── Glyph shadow helper ──────────────────────────────────────────────────────
// Wraps each rail glyph in a View that applies a soft, blurred drop-shadow:
//
//   Web  — CSS `filter: drop-shadow(…)` follows the SVG outline exactly, so
//           there is no rectangle and no hard double-image.  This is the same
//           technique Instagram / TikTok use for their over-photo rail icons.
//
//   iOS / Android — React Native View shadow props produce a Gaussian-blurred
//           shadow with a real shadowRadius; it is not perfectly glyph-shaped
//           but is tight and soft enough to look equivalent in practice.
//
// No duplicate glyph, no background rect, no box-shadow tile.

interface GlyphShadowProps {
  // The Phosphor icon component (e.g. HandTap, Bone, ChatCircle …)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  color: string;
  size: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
}

function WithGlyphShadow({ icon: Icon, color, size, weight = 'regular' }: GlyphShadowProps) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <View style={Platform.OS === 'web' ? (glyphShadowStyles.web as any) : glyphShadowStyles.native}>
      <Icon color={color} size={size} weight={weight} />
    </View>
  );
}

const glyphShadowStyles = StyleSheet.create({
  // Web: CSS filter drop-shadow follows the SVG glyph shape — no box.
  // `filter` is not in RN's StyleSheet types; cast at call-site via (as any).
  web: {
    // @ts-ignore — valid CSS property, not in RN types
    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.60))',
  },
  // Native: blurred View shadow — closest achievable without react-native-svg
  // filter wiring.  shadowRadius gives the Gaussian blur on iOS; elevation
  // maps to Material shadow on Android.
  native: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.55,
    shadowRadius: 3,
    elevation: 4,
  },
});

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function BoopIcon({ color, size }: { color: string; size: number }) {
  return <WithGlyphShadow icon={HandTap} color={color} size={size} />;
}

function TreatIcon({ color, size }: { color: string; size: number }) {
  return <WithGlyphShadow icon={Bone} color={color} size={size} />;
}

// ─── BoopSpark ────────────────────────────────────────────────────────────────
// "Boop landed" burst: 5 short tapered coral rays that radiate outward from the
// icon center and fade in ~300 ms.  Replaces the generic expanding-ring ripple —
// this is the signature boop moment at the finger, distinct from the "Boop!"
// scatter pops that float over the photo.
//
// Transform order: [{rotate}, {translateY}] → translateY moves along the already-
// rotated Y-axis, so each ray springs in its own outward direction automatically.
//
// Cap: SPARK_CAP concurrent bursts; extra taps are silently dropped so rapid
// tapping stays smooth with no runaway React state growth.

const SPARK_ANGLES = [0, 72, 144, 216, 288]; // 5 evenly distributed directions (°)
const SPARK_CAP    = 4;                        // max live bursts at once

interface BoopSparkProps {
  color: string;
  onDone: () => void;
}

function BoopSpark({ color, onDone }: BoopSparkProps) {
  // One travel value per ray — all share a single opacity envelope.
  const travels = useRef(SPARK_ANGLES.map(() => new Animated.Value(2))).current;
  const opacity  = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      // Each ray springs from 2 (inside icon) to -22 (clear of icon edge).
      ...travels.map((t) =>
        Animated.timing(t, {
          toValue: -22,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      ),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 310,
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
      style={[StyleSheet.absoluteFillObject, { opacity }]}
      pointerEvents="none"
    >
      {SPARK_ANGLES.map((angle, i) => (
        <Animated.View
          key={angle}
          style={[
            sparkStyles.ray,
            {
              backgroundColor: color,
              transform: [
                // 1. Orient ray in its outward direction.
                { rotate: `${angle}deg` },
                // 2. Translate along the now-rotated Y-axis (negative = outward).
                { translateY: travels[i] },
              ],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

// Each ray: a short pill centered within boopIconArea (width:40, height:32).
// left = (40 - 3) / 2 = 18.5 → 18;  top = (32 - 10) / 2 = 11
const sparkStyles = StyleSheet.create({
  ray: {
    position: 'absolute',
    width: 3,
    height: 10,
    borderRadius: 1.5,
    left: 18,
    top: 11,
  },
});

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

  // Stack of live spark burst IDs — capped at SPARK_CAP for rapid-tap safety.
  const [sparks, setSparks] = useState<number[]>([]);
  const sparkIdRef = useRef(0);

  const removeSpark = useCallback((id: number) => {
    setSparks((prev) => prev.filter((s) => s !== id));
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
          {/* Coral spark bursts — rendered behind the icon, overflow: visible */}
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
          {renderIcon(iconColor, 24 /* size arg unused — each icon sets its own */)}
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
   * Called on any treat rejection (429 daily limit, 403 self-treat) with the
   * message to display. Caller renders a full-width readable toast — the narrow
   * in-rail transient can't fit either message without clipping.
   */
  onToast?: (message: string) => void;
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
  onToast,
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
          // All rejections route through the full-width FeedPage toast.
          // The narrow ~120 px transientLabel would clip either message.
          // 1. Instantly clear any lingering transient (e.g. "Last one!" from
          //    the preceding success) so the narrow label goes dark immediately.
          // 2. Shake the treat icon.
          // 3. Delegate copy rendering to the caller's full-width toast.
          transientOpacity.setValue(0);
          onTransientChange?.(false);
          shakeAnimation();
          if (status === 403) {
            onToast?.('Your own pet? Sneaky. 🐾');
          } else {
            // 429 (daily treat limit) or any other unexpected rejection.
            onToast?.("You're all out of treats for today 🐾");
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
            renderIcon={(color) => <TreatIcon color={color} size={28} />}
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
          <WithGlyphShadow icon={ChatCircle} color={color} size={24} />
        )}
        count={commentCount}
        onPress={onCommentPress}
        testID="comment-button"
      />

      {/* 4. Share */}
      <ActionItem
        renderIcon={(color) => (
          <WithGlyphShadow icon={ShareNetwork} color={color} size={24} />
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
    // No background or box-shadow here — shadow is applied per-glyph via
    // WithGlyphShadow so it follows the icon outline, not a rectangle.
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
