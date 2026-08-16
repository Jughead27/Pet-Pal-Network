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
import { Animated, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatCircle, ShareNetwork } from 'phosphor-react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useBoopPost, useTreatPost } from '@workspace/api-client-react';
import { WithGlyphShadow } from './WithGlyphShadow';
import { TreatIcon } from './icons';
import { BoopRailItem } from './BoopRailItem';
import { ActionItem } from './ActionItem';
import { styles } from './styles';

// AsyncStorage keys for one-time teaching labels (persist across reloads).
const TEACHING_KEY_BOOP  = 'fishbook:teaching:boop';
const TEACHING_KEY_TREAT = 'fishbook:teaching:treat';

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
  /**
   * Species of the posting pet (case-insensitive free text, e.g. "Dog", "cat").
   * Drives the treat glyph: Dog→Bone, Cat→Fish, Rabbit/Guinea pig/Horse→Carrot,
   * everything else→Cookie.  Undefined falls back to Cookie.
   */
  petSpecies?: string;
  /**
   * True when the viewer is the author of this post.  Treats are blocked for
   * authors — the button is dimmed and pressing it shows a plain rejection toast
   * without making a network call.  Boops are unaffected.
   */
  viewerIsAuthor?: boolean;
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
  petSpecies,
  viewerIsAuthor = false,
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

    // Author gate — block upfront without a network call.
    if (viewerIsAuthor) {
      onToast?.("you can't treat your own post.");
      return;
    }

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
            onToast?.("you can't treat your own post.");
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

        {/* Bone-shake wrapper — dimmed when viewer is the post author */}
        <Animated.View style={[{ transform: [{ translateX: treatShakeX }] }, viewerIsAuthor && { opacity: 0.35 }]}>
          <ActionItem
            renderIcon={(color) => <TreatIcon color={color} size={28} species={petSpecies} />}
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
