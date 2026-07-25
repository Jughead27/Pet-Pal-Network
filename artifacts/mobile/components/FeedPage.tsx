/**
 * FeedPage — one full-screen page in the vertical feed pager.
 *
 * Each page is fully self-contained:
 *   - Its own boop/treat/comment counts and viewer flags (initialized from
 *     server data, never shared with sibling pages)
 *   - Its own chrome-toggle / double-tap-boop gesture detection
 *   - Its own pop animation stack
 *
 * Gesture model:
 *   Single tap outside exclusion zones  → toggle chrome (after 280 ms debounce)
 *   Double tap anywhere                 → boop
 *   Vertical swipe                      → FlatList pager (FeedPage doesn't see it)
 *
 * Pop anchoring:
 *   Pops spawn at right: POP_RIGHT (175 px) which is well to the left of both
 *   the rail column (right: 14–54 px) and the treat countdown transient text
 *   (right: 50–170 px). They drift upward and never overlap either.
 *
 * All animations use React Native's built-in Animated API — no Reanimated.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import FocalImage from '@/components/FocalImage';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { resolveMediaKey } from '@/utils/mediaKey';
import { useBoopPost } from '@workspace/api-client-react';
import type { FeedPost } from '@workspace/api-client-react';
import ActionRail from '@/components/ActionRail';
import AddToPackLink from '@/components/AddToPackLink';
import PopText from '@/components/PopText';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Horizontal exclusion zone: taps this far from the right edge won't toggle chrome
const RAIL_TOUCH_WIDTH   = 40;
const RAIL_RIGHT_INSET   = 14;
const RAIL_MARGIN        = 24;
const RAIL_EXCLUSION_X   = SCREEN_WIDTH - RAIL_TOUCH_WIDTH - RAIL_RIGHT_INSET - RAIL_MARGIN;

// Pop anchor constants — proportional to the measured page width.
//
// Reference geometry (402 px wide, rail at right:14):
//   Rail column right edge          →  right: 54   from right
//   Transient label right edge      →  right: 64
//   Transient label left  edge      →  right: 184  (width ≈ 120 px)
//   POP_RIGHT_BASE was 200 px      →  200 / 402 ≈ 0.498 of page width
//   POP_RIGHT_TRANSIENT_EXTRA 30   →   30 / 402 ≈ 0.075 of page width
//
// Using fractions instead of fixed pixels keeps pops clear of the rail on any
// viewport width (narrow web frame, iPhone, tablet). A clamp then guarantees:
//   • right edge stays left of the transient zone (fraction handles this)
//   • left  edge stays ≥ POP_MIN_LEFT_MARGIN from the left edge at all widths
//   • right edge stays ≥ POP_MIN_RAIL_CLEARANCE from the right edge at all widths
const POP_RIGHT_FRACTION        = 200 / 402; // ≈ 0.498 — base offset from right
const POP_TRANSIENT_FRACTION    =  30 / 402; // ≈ 0.075 — extra when transient visible
const POP_MAX_EST_WIDTH         = 160;       // generous max for any word at peak scale (1.15×1.15)
const POP_MIN_LEFT_MARGIN       =  12;       // px — minimum gap from the left screen edge
const POP_MIN_RAIL_CLEARANCE    = RAIL_RIGHT_INSET + RAIL_TOUCH_WIDTH + 16; // px from right

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEXT_SHADOW: any = { textShadow: '0px 1px 3px rgba(0,0,0,0.4)' };

// ─── Pop state ────────────────────────────────────────────────────────────────

interface Pop {
  id: number;
  word: string;
  rotation: number;
  right: number;
  bottom: number;
}

let popCounter = 0;
const randRotation = () => Math.round((Math.random() * 16 - 8) * 10) / 10;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommentSheetConfig {
  postId: string;
  onCommentPosted: () => void;
}

interface FeedPageProps {
  post: FeedPost;
  /** Exact rendered height of the pager container — used for full-bleed sizing. */
  height: number;
  reducedMotion: boolean;
  onOpenCommentSheet: (config: CommentSheetConfig) => void;
  onOpenShareSheet: () => void;
}

// ─── FeedPage ─────────────────────────────────────────────────────────────────

export default function FeedPage({
  post,
  height,
  reducedMotion,
  onOpenCommentSheet,
  onOpenShareSheet,
}: FeedPageProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // ── Per-page reaction state (initialized from server, never shared) ────────
  const [boopCount,        setBoopCount]        = useState(post.boopCount);
  const [treatCount,       setTreatCount]        = useState(post.treatCount);
  const [commentCount,     setCommentCount]      = useState(post.commentCount);
  const [viewerHasBooped,  setViewerHasBooped]   = useState(post.viewerHasBooped);
  const [viewerHasTreated, setViewerHasTreated]  = useState(post.viewerHasTreated);

  // ── Boop mutation for double-tap gesture ──────────────────────────────────
  const { mutate: doBoopPost } = useBoopPost();

  // ── Chrome visibility ─────────────────────────────────────────────────────
  const chromeVisibleRef = useRef(true);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeOpacity = useRef(new Animated.Value(1)).current;

  // ── Caption ───────────────────────────────────────────────────────────────
  const [captionExpanded,    setCaptionExpanded]    = useState(false);
  const [captionNeedsMore,   setCaptionNeedsMore]   = useState(false);
  const petInfoHeightRef = useRef(120);

  // ── Pop animations ────────────────────────────────────────────────────────
  const [pops, setPops] = useState<Pop[]>([]);
  // Measured page width — updated on every layout change so the pop anchor
  // is always proportional to the actual rendered width, not a stale module-
  // level Dimensions.get() snapshot that doesn't track web resize.
  const pageWidthRef = useRef(SCREEN_WIDTH);
  const bottomOffset = insets.bottom + 110;
  // Pops spawn to the left of the rail column and transient label.
  // Boop icon is item 1 in the rail (higher up); treat is item 2.
  const BOOP_BOTTOM  = bottomOffset + 210;
  const TREAT_BOTTOM = bottomOffset + 143;

  // Tracks whether ActionRail has a transient label visible right now.
  // Stored in a ref (not state) so spawnPop's useCallback never needs to
  // re-create, yet always reads the current value at call time.
  const isTransientVisibleRef = useRef(false);
  const handleTransientChange = useCallback((visible: boolean) => {
    isTransientVisibleRef.current = visible;
  }, []);

  const spawnPop = useCallback(
    (word: string, bottom: number) => {
      const pw       = pageWidthRef.current;
      // Proportional base offset + transient bias, both scaling with page width.
      const base     = pw * POP_RIGHT_FRACTION;
      const extra    = isTransientVisibleRef.current ? pw * POP_TRANSIENT_FRACTION : 0;
      // Clamp: keep the pop's left edge ≥ POP_MIN_LEFT_MARGIN from the left
      // edge (maxRight), and its right edge clear of the rail (minRight).
      const maxRight = pw - POP_MAX_EST_WIDTH - POP_MIN_LEFT_MARGIN;
      const right    = Math.max(POP_MIN_RAIL_CLEARANCE, Math.min(maxRight, base + extra));
      const pop: Pop = {
        id: ++popCounter,
        word,
        rotation: randRotation(),
        right,
        bottom,
      };
      setPops((prev) => [...prev, pop]);
    },
    [],
  );

  const removePop = useCallback((id: number) => {
    setPops((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const spawnBoopPop  = useCallback(() => spawnPop('Boop!', BOOP_BOTTOM),  [spawnPop, BOOP_BOTTOM]);
  const spawnTreatPop = useCallback(() => spawnPop('Yum!',  TREAT_BOTTOM), [spawnPop, TREAT_BOTTOM]);

  // Teaching pops — shown once per device (AsyncStorage flag in ActionRail).
  // Use the same spawnPop so they get the transient-aware right offset, the
  // same size variance, and the same overshoot animation as reaction pops.
  const spawnBoopTeachingPop  = useCallback(() => spawnPop('Boop',  BOOP_BOTTOM),  [spawnPop, BOOP_BOTTOM]);
  const spawnTreatTeachingPop = useCallback(() => spawnPop('Treat', TREAT_BOTTOM), [spawnPop, TREAT_BOTTOM]);

  // ── Reaction callbacks (passed to ActionRail) ─────────────────────────────

  const handleBoopOptimistic = useCallback(() => {
    setBoopCount((n) => n + 1);
    setViewerHasBooped(true);
  }, []);

  const handleTreatSuccess = useCallback((newTreatCount: number) => {
    setTreatCount(newTreatCount);
    setViewerHasTreated(true);
  }, []);

  const handleCommentPosted = useCallback(() => {
    setCommentCount((n) => n + 1);
  }, []);

  // ── Double-tap boop (gesture handler) ────────────────────────────────────
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDoubleTapBoop = useCallback(() => {
    setBoopCount((n) => n + 1);
    setViewerHasBooped(true);
    spawnBoopPop();
    doBoopPost({ id: post.id });
  }, [doBoopPost, post.id, spawnBoopPop]);

  // ── Media press: single tap → chrome toggle; double tap → boop ──────────
  const handleMediaPress = useCallback(
    (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      const { locationX, locationY } = e.nativeEvent;

      // Exclusion zone: rail column (right) or bottom overlay (below petInfo)
      const bottomZoneTop = height - bottomOffset - petInfoHeightRef.current - 16;
      const inExclusionZone =
        chromeVisibleRef.current &&
        (locationX >= RAIL_EXCLUSION_X || locationY >= bottomZoneTop);

      if (tapTimerRef.current !== null) {
        // Second tap within window → double-tap → boop
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
        handleDoubleTapBoop();
        return;
      }

      // First tap — wait to see if a second arrives
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        if (inExclusionZone) return; // tapped interactive area — don't toggle chrome
        const next = !chromeVisibleRef.current;
        chromeVisibleRef.current = next;
        setChromeVisible(next);
        Animated.timing(chromeOpacity, {
          toValue: next ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }, 280);
    },
    [bottomOffset, chromeOpacity, handleDoubleTapBoop, height],
  );

  // ── Derived display values ────────────────────────────────────────────────
  const heroImage = resolveMediaKey(post.mediaKey, post.mediaUrl);
  const petName   = post.pet.name;
  const petBreed  = post.pet.breed ?? '';
  const petId     = post.pet.id;
  const caption   = post.caption ?? '';

  return (
    <View
      style={[styles.page, { height }]}
      onLayout={(e) => { pageWidthRef.current = e.nativeEvent.layout.width; }}
    >
      {/* Full-bleed hero image — respects poster's focal point */}
      <FocalImage
        source={heroImage}
        style={styles.heroImage}
        focusX={post.cropFocusX}
        focusY={post.cropFocusY}
      />

      {/* Media tap target (sits below all interactive overlays) */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleMediaPress} />

      {/* Bottom legibility scrim */}
      <Animated.View style={[styles.scrim, { opacity: chromeOpacity }]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.25)', 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* Right-edge rail scrim */}
      <Animated.View style={[styles.railScrim, { opacity: chromeOpacity }]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.15)', 'transparent']}
          locations={[0, 0.6, 1]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ActionRail */}
      <Animated.View
        style={[
          styles.railContainer,
          { bottom: bottomOffset, opacity: chromeOpacity },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { pointerEvents: (chromeVisible ? 'box-none' : 'none') as any },
        ]}
      >
        <ActionRail
          postId={post.id}
          boopCount={boopCount}
          treatCount={treatCount}
          commentCount={commentCount}
          viewerHasBooped={viewerHasBooped}
          viewerHasTreated={viewerHasTreated}
          onBoopOptimistic={handleBoopOptimistic}
          onTreatSuccess={handleTreatSuccess}
          onCommentPress={() =>
            onOpenCommentSheet({ postId: post.id, onCommentPosted: handleCommentPosted })
          }
          onSharePress={onOpenShareSheet}
          onBoopFired={spawnBoopPop}
          onTreatFired={spawnTreatPop}
          onTransientChange={handleTransientChange}
          onBoopTeaching={spawnBoopTeachingPop}
          onTreatTeaching={spawnTreatTeachingPop}
        />
      </Animated.View>

      {/* Pet info overlay */}
      <Animated.View
        style={[
          styles.petInfo,
          { bottom: bottomOffset, opacity: chromeOpacity },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { pointerEvents: (chromeVisible ? 'box-none' : 'none') as any },
        ]}
        onLayout={(e) => {
          petInfoHeightRef.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.identityRow}>
          <TouchableOpacity
            onPress={() => router.push(`/pet/${petId}`)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`View ${petName}'s profile`}
          >
            <Text style={styles.petName}>{petName}</Text>
          </TouchableOpacity>
          <AddToPackLink />
        </View>

        <Text style={[styles.petBreed, { color: 'rgba(240,244,248,0.75)' }]}>
          {petBreed}
        </Text>

        {/* Caption with expand/collapse + tap-to-detail */}
        <View>
          {/* Off-screen measure to detect truncation */}
          <Text
            style={[styles.petCaption, styles.captionMeasure]}
            onTextLayout={(e) =>
              setCaptionNeedsMore(e.nativeEvent.lines.length > 2)
            }
          >
            {caption}
          </Text>
          <TouchableOpacity
            onPress={() => router.push(`/post/${post.id}`)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="View full post"
            hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
          >
            <Text
              style={[styles.petCaption, { color: 'rgba(240,244,248,0.9)' }]}
              numberOfLines={captionExpanded ? undefined : 2}
            >
              {caption || 'View full photo'}
            </Text>
          </TouchableOpacity>
          {captionNeedsMore && (
            <TouchableOpacity
              onPress={() => setCaptionExpanded((v) => !v)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.captionMore}>
                {captionExpanded ? 'less' : 'more'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* Reaction pop texts */}
      {pops.map((pop) => (
        <PopText
          key={pop.id}
          word={pop.word}
          rotation={pop.rotation}
          right={pop.right}
          bottom={pop.bottom}
          reducedMotion={reducedMotion}
          onDone={() => removePop(pop.id)}
        />
      ))}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#060B10',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 300,
  },
  railScrim: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 96,
  },
  railContainer: {
    position: 'absolute',
    right: 14,
  },
  petInfo: {
    position: 'absolute',
    left: 18,
    right: 80,
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
  captionMeasure: {
    position: 'absolute',
    opacity: 0,
    color: 'transparent',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointerEvents: 'none' as any,
  },
  captionMore: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600' as const,
    color: 'rgba(240,244,248,0.55)',
    ...TEXT_SHADOW,
  },
});
