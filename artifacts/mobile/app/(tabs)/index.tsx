/**
 * Home Feed — full-bleed single pet post.
 *
 * Gestures:
 *   Single tap on media  → toggle chrome (name/rail/scrim fade 200ms)
 *   Double tap on media  → boop (same as rail Boop button)
 *   Tap "more/less"      → expand / collapse caption
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import ActionRail from '@/components/ActionRail';
import AddToPackLink from '@/components/AddToPackLink';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';
import PopText from '@/components/PopText';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Exclusion-zone geometry ───────────────────────────────────────────────────
// Right-rail strip: rail touchable (40 px) + container right inset (14 px) + left margin (24 px).
// Taps where locationX >= this threshold are in the exclusion zone when chrome is visible.
const RAIL_TOUCH_WIDTH   = 40;
const RAIL_RIGHT_INSET   = 14;
const RAIL_MARGIN        = 24;
const RAIL_EXCLUSION_X   = SCREEN_WIDTH - RAIL_TOUCH_WIDTH - RAIL_RIGHT_INSET - RAIL_MARGIN; // ≈ SCREEN_WIDTH − 78

const PET_IMAGES = {
  hero: require('@/assets/images/ripley-hero.jpg'),
  post1: require('@/assets/images/ripley-post1.jpg'),
  post2: require('@/assets/images/ripley-post2.jpg'),
} as const;

// Shared text-shadow style applied to all overlay text for legibility.
// textShadow shorthand (RN 0.76 / React Native Web) replaces the deprecated
// textShadowColor / textShadowOffset / textShadowRadius triple.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEXT_SHADOW: any = {
  textShadow: '0px 1px 3px rgba(0,0,0,0.4)',
};

// ─── Pop state ───────────────────────────────────────────────────────────────

interface Pop {
  id: number;
  word: string;
  rotation: number; // degrees -8..+8
  right: number;    // px from screen right
  bottom: number;   // px from screen bottom
}

let popCounter = 0;
const randRotation = () => Math.round((Math.random() * 16 - 8) * 10) / 10;

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { pet, boop } = useApp();

  // Reduced motion — queried via AccessibilityInfo (built-in, no Reanimated dependency)
  // so PopText's built-in Animated path receives the correct flag in Expo Go.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => sub.remove();
  }, []);

  const [commentSheetVisible, setCommentSheetVisible] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionNeedsMore, setCaptionNeedsMore] = useState(false);

  // Chrome visibility — single-tap toggles, resets to visible per post.
  // Built-in Animated.Value drives the opacity fade (200 ms); no Reanimated needed.
  const chromeVisibleRef = useRef(true);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeOpacity = useRef(new Animated.Value(1)).current;

  // Double-tap detection: toggle timer (open-area first tap)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Exclusion-zone first-tap: no toggle timer, but still participates in double-tap
  const pendingTapRef       = useRef(false);
  const pendingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measured height of the petInfo block — used for bottom exclusion zone.
  // Stored in a ref (not state) so the gesture handler closure never goes stale
  // and we avoid re-renders on layout.
  const petInfoHeightRef = useRef(120);

  // Reaction pops — each press spawns one independent element
  const [pops, setPops] = useState<Pop[]>([]);

  const featuredPost = pet.posts[0];
  const heroImage = PET_IMAGES[featuredPost.imageKey];

  // Single shared constant — same on web and native.
  const bottomOffset = insets.bottom + 110;

  // Rail geometry (approximate, based on known layout constants):
  //   4 items × ~45px + 3 gaps × 22px ≈ 246px total rail height
  //   Boop (top item) center ≈ bottomOffset + 210
  //   Treat (second item) center ≈ bottomOffset + 143
  //   right: 60 places pop just left of the 54px-wide rail column
  const BOOP_BOTTOM  = bottomOffset + 210;
  const TREAT_BOTTOM = bottomOffset + 143;
  const POP_RIGHT    = 60;

  const spawnPop = useCallback((word: string, bottom: number) => {
    const pop: Pop = {
      id: ++popCounter,
      word,
      rotation: randRotation(),
      right: POP_RIGHT,
      bottom,
    };
    setPops((prev) => [...prev, pop]);
  }, [POP_RIGHT]);

  const removePop = useCallback((id: number) => {
    setPops((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const spawnBoopPop  = useCallback(() => spawnPop('Boop!', BOOP_BOTTOM),  [spawnPop, BOOP_BOTTOM]);
  const spawnTreatPop = useCallback(() => spawnPop('Yum!',  TREAT_BOTTOM), [spawnPop, TREAT_BOTTOM]);

  // ── Gesture handler ──────────────────────────────────────────────────────────
  //
  // Exclusion zones (active only while chrome is VISIBLE):
  //   1. Right-rail strip  — full height, locationX >= RAIL_EXCLUSION_X
  //   2. Bottom overlay    — locationY >= screen bottom minus petInfo height minus 16 px margin
  //
  // In an exclusion zone a single tap does nothing (no toggle).
  // Double-tap fires boop from anywhere, including exclusion zones.
  // When chrome is hidden, all zones are disabled — full image restores chrome.
  //
  const handleMediaPress = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = e.nativeEvent;

    // Exclusion zones only apply while chrome is visible
    const bottomZoneTop = SCREEN_HEIGHT - bottomOffset - petInfoHeightRef.current - 16;
    const inZone = chromeVisibleRef.current && (
      locationX >= RAIL_EXCLUSION_X ||
      locationY >= bottomZoneTop
    );

    // ── Double-tap detection ────────────────────────────────────────────────
    // Either a pending toggle timer or a pending exclusion-zone tap counts as
    // the "first tap"; the second tap anywhere fires boop.
    if (tapTimerRef.current !== null) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      boop();
      spawnBoopPop();
      return;
    }
    if (pendingTapRef.current) {
      if (pendingClearTimerRef.current) {
        clearTimeout(pendingClearTimerRef.current);
        pendingClearTimerRef.current = null;
      }
      pendingTapRef.current = false;
      boop();
      spawnBoopPop();
      return;
    }

    // ── First tap ──────────────────────────────────────────────────────────
    if (inZone) {
      // Exclusion zone: record that a tap occurred so a second tap can boop,
      // but do NOT start a toggle timer.
      pendingTapRef.current = true;
      pendingClearTimerRef.current = setTimeout(() => {
        pendingTapRef.current = false;
        pendingClearTimerRef.current = null;
      }, 280);
    } else {
      // Open media area: start toggle timer as before.
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        const next = !chromeVisibleRef.current;
        chromeVisibleRef.current = next;
        setChromeVisible(next);
        Animated.timing(chromeOpacity, {
          toValue: next ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }, 280);
    }
  }, [boop, spawnBoopPop, bottomOffset, chromeOpacity]);

  return (
    <View style={styles.container}>
      {/* ── Full-bleed hero image ── */}
      <Image source={heroImage} style={styles.heroImage} resizeMode="cover" />

      {/* ── Media tap target — sits behind all overlays ── */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleMediaPress} />

      {/* ── Bottom legibility scrim — fades with chrome ── */}
      {/* pointerEvents in style (not prop) per RN 0.76 */}
      <Animated.View style={[styles.scrim, { opacity: chromeOpacity }]}>
        <LinearGradient
          colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.25)', 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── Right-edge rail scrim — fades with chrome ── */}
      <Animated.View style={[styles.railScrim, { opacity: chromeOpacity }]}>
        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.15)', 'transparent']}
          locations={[0, 0.6, 1]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── ActionRail — right edge ── */}
      <Animated.View
        style={[
          styles.railContainer,
          { bottom: bottomOffset, opacity: chromeOpacity },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { pointerEvents: (chromeVisible ? 'box-none' : 'none') as any },
        ]}
      >
        <ActionRail
          onCommentPress={() => setCommentSheetVisible(true)}
          onSharePress={() => setShareSheetVisible(true)}
          onBoopFired={spawnBoopPop}
          onTreatFired={spawnTreatPop}
        />
      </Animated.View>

      {/* ── Pet info — bottom-left ── */}
      <Animated.View
        style={[
          styles.petInfo,
          { bottom: bottomOffset, right: 80, opacity: chromeOpacity },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { pointerEvents: (chromeVisible ? 'box-none' : 'none') as any },
        ]}
        onLayout={(e) => { petInfoHeightRef.current = e.nativeEvent.layout.height; }}
      >
        {/* Identity row: name + pack toggle */}
        <View style={styles.identityRow}>
          <TouchableOpacity
            onPress={() => router.push(`/pet/${pet.id}`)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`View ${pet.name}'s profile`}
          >
            <Text style={styles.petName}>{pet.name}</Text>
          </TouchableOpacity>
          <AddToPackLink />
        </View>

        <Text style={[styles.petBreed, { color: 'rgba(240,244,248,0.75)' }]}>
          {pet.breed}
        </Text>

        {/* Caption with expand/collapse */}
        <View>
          {/* Hidden full-text measurement — detects whether truncation occurs */}
          <Text
            style={[styles.petCaption, styles.captionMeasure]}
            onTextLayout={(e) => setCaptionNeedsMore(e.nativeEvent.lines.length > 2)}
          >
            {featuredPost.caption}
          </Text>

          <Text
            style={[styles.petCaption, { color: 'rgba(240,244,248,0.9)' }]}
            numberOfLines={captionExpanded ? undefined : 2}
          >
            {featuredPost.caption}
          </Text>

          {captionNeedsMore && (
            <TouchableOpacity
              onPress={() => setCaptionExpanded(v => !v)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.captionMore}>
                {captionExpanded ? 'less' : 'more'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* ── Sheets ── */}
      <CommentSheet
        visible={commentSheetVisible}
        onClose={() => setCommentSheetVisible(false)}
      />
      <ShareSheet
        visible={shareSheetVisible}
        onClose={() => setShareSheetVisible(false)}
      />

      {/* ── Reaction pops — absolutely positioned, pointer-events none ── */}
      {pops.map((pop) => (
        <PopText
          key={pop.id}
          word={pop.word}
          rotation={pop.rotation}
          right={pop.right}
          bottom={pop.bottom}
          reducedMotion={reducedMotion ?? false}
          onDone={() => removePop(pop.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060B10',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  // Bottom legibility scrim — covers bottom ~45% of screen
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_HEIGHT * 0.45,
    // pointerEvents in style (RN 0.76+) — was deprecated as a prop
    pointerEvents: 'none',
  },
  // Right-edge rail scrim — 96px wide, full screen height
  railScrim: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 96,
    pointerEvents: 'none',
  },
  railContainer: {
    position: 'absolute',
    right: 14,
  },
  petInfo: {
    position: 'absolute',
    left: 18,
    gap: 3,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  petName: {
    color: '#F0F4F8',
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
    ...TEXT_SHADOW,
  },
  petBreed: {
    fontSize: 13,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
    ...TEXT_SHADOW,
  },
  petCaption: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    fontStyle: 'italic',
    ...TEXT_SHADOW,
  },
  // Hidden full-text clone used only for line-count measurement
  captionMeasure: {
    position: 'absolute',
    opacity: 0,
    color: 'transparent',
    pointerEvents: 'none',
  },
  captionMore: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600' as const,
    color: 'rgba(240,244,248,0.55)',
    ...TEXT_SHADOW,
  },
});
