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
 * Pop system:
 *   Reaction pops scatter across the image area (word + accent color vary by
 *   reaction type). They spring in, float up, and fade. Capped at POP_MAX_COUNT
 *   simultaneous pops; oldest is recycled when the cap is hit.
 *
 * All animations use React Native's built-in Animated API — no Reanimated.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
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
import { COLUMN_MAX_WIDTH } from '@/hooks/useColumnWidth';
import { resolveMediaKey } from '@/utils/mediaKey';
import { useBoopPost } from '@workspace/api-client-react';
import type { FeedPost, PackResult } from '@workspace/api-client-react';
import ActionRail from '@/components/ActionRail';
import ShareCard from '@/components/ShareCard';
import AddToPackLink from '@/components/AddToPackLink';
import { executeShareCard } from '@/utils/shareCardAction';
import PopText from '@/components/PopText';
import { setFeedCellDimensions } from '@/utils/feedCellDimensions';

// ─── Constants ────────────────────────────────────────────────────────────────

// Horizontal exclusion zone constants — taps this far from the right edge won't toggle chrome.
// RAIL_EXCLUSION_X is computed dynamically inside handleMediaPress from pageWidthRef.current
// so it stays correct inside the 430-px web column (Dimensions.get returns the full window
// width on web, not the column width).
const RAIL_TOUCH_WIDTH   = 40;
const RAIL_RIGHT_INSET   = 14;
const RAIL_MARGIN        = 24;

// ─── Reaction pop — scatter geometry ─────────────────────────────────────────
// Right clearance: rail at right:14, touch width 40px, 12px margin.
const POP_RAIL_CLEARANCE     = RAIL_RIGHT_INSET + RAIL_TOUCH_WIDTH + 12; // ~66px from right
// Max pop text width — generous for "Boop boop!" at largest size (44×1.4).
const POP_EST_MAX_WIDTH      = 210;
// Min gap from the left screen edge.
const POP_LEFT_MARGIN        = 12;
// How far above `bottomOffset` the scatter floor sits (clears petInfo + caption).
const POP_SCATTER_FLOOR      = 160;
// How far below the top edge pops are kept (status bar / nav clearance).
const POP_SCATTER_TOP_MARGIN = 90;
// Max simultaneous pops; oldest is recycled when the cap is hit.
const POP_MAX_COUNT          = 8;

// Accent colors — locked semantics: boop = coral, treat = gold.
const BOOP_COLOR  = '#FF7A5C'; // matches colors.accent
const TREAT_COLOR = '#F4C542'; // matches ActionRail treat activeColor

// Word sets — weighted toward primary word; variants add surprise, not noise.
const BOOP_WORDS = [
  { word: 'Boop!',      weight: 7 },
  { word: 'Boop boop!', weight: 2 },
  { word: 'Booped!',    weight: 1 },
] as const;
const TREAT_WORDS = [
  { word: 'Yum!',      weight: 7 },
  { word: 'Yummy!',    weight: 1 },
  { word: 'Tasty!',    weight: 1 },
  { word: 'Nom nom!',  weight: 1 },
] as const;

/** Weighted random pick from a word set. */
function pickWord(words: ReadonlyArray<{ word: string; weight: number }>): string {
  const total = words.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of words) {
    r -= w.weight;
    if (r <= 0) return w.word;
  }
  return words[0].word;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEXT_SHADOW: any = { textShadow: '0px 1px 3px rgba(0,0,0,0.4)' };

// ─── Pop state ────────────────────────────────────────────────────────────────

interface Pop {
  id: number;
  word: string;
  /** Accent color — coral for boop, gold for treat. */
  color: string;
  rotation: number;
  right: number;
  bottom: number;
}

let popCounter = 0;

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
}

// ─── FeedPage ─────────────────────────────────────────────────────────────────

export default function FeedPage({
  post,
  height,
  reducedMotion,
  onOpenCommentSheet,
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

  // ── Full-width treat-rejection toast ─────────────────────────────────────
  // Used for BOTH 429 (out-of-treats) and 403 (self-treat nudge).
  // Surfaces as a centered banner — the narrow in-rail transient can't fit
  // either message without clipping, so all rejection copy routes here.
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [toastMsg, setToastMsg] = useState('');
  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 2200, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [toastOpacity]);

  // ── Share card state ──────────────────────────────────────────────────────
  // isSharing: true while the card is being composited + handed to the OS
  // cardRef: ref on the off-screen ShareCard view (native only)
  // cardImageLoaded*: track when the photo inside ShareCard has loaded so we
  //   can delay capture on native until the image is ready
  const [isSharing, setIsSharing] = useState(false);
  const cardRef                   = useRef<View>(null);
  const cardImageLoadedRef        = useRef(false);
  const cardImageReadyResolveRef  = useRef<(() => void) | null>(null);

  const handleCardImageLoaded = useCallback(() => {
    cardImageLoadedRef.current = true;
    cardImageReadyResolveRef.current?.();
    cardImageReadyResolveRef.current = null;
  }, []);

  // ── Caption ───────────────────────────────────────────────────────────────
  // Always truncated to 2 lines in the feed; full caption lives on the detail screen.
  const petInfoHeightRef = useRef(120);

  // ── Pop animations ────────────────────────────────────────────────────────
  const [pops, setPops] = useState<Pop[]>([]);
  // Measured page width — updated on every layout change so scatter positions
  // are proportional to the actual rendered width, not a stale snapshot.
  // Initial value: COLUMN_MAX_WIDTH is a safe default (430 px).
  const pageWidthRef = useRef(COLUMN_MAX_WIDTH);
  const bottomOffset = insets.bottom + 110;

  // In Fit (contain) mode the photo tucks just above the name/caption overlay.
  // Lift the rail so all four icons sit on the photo, not straddling the blur.
  // 120 = nominal petInfo height, 16 = containAlignBottom gap, 8 = margin.
  const FIT_RAIL_LIFT = 144;
  // Lift the reaction rail off the bottom for posts that show blur letterboxing
  // (explicit contain / Fit-mode posts only — cover posts are always full-bleed).
  const railBottom = post.cropMode === 'contain'
    ? bottomOffset + FIT_RAIL_LIFT
    : bottomOffset;

  // Live refs for values used inside the stable spawnPop callback.
  // Written every render so the callback always reads the current value.
  const bottomOffsetRef = useRef(bottomOffset);
  bottomOffsetRef.current = bottomOffset;
  const pageHeightRef = useRef(height);
  pageHeightRef.current = height;

  // Tracks whether ActionRail has a transient label visible right now.
  // Kept for ActionRail wiring — no longer affects pop scatter position.
  const isTransientVisibleRef = useRef(false);
  const handleTransientChange = useCallback((visible: boolean) => {
    isTransientVisibleRef.current = visible;
  }, []);

  // ── Scatter pop spawner ───────────────────────────────────────────────────
  // Each pop lands at a random position within the safe image zone:
  //   Horizontal — between rail clearance (right side) and left-edge margin.
  //   Vertical   — above the caption/petInfo zone, below the top edge.
  // Word and accent color are caller-supplied (boop=coral, treat=gold).
  // Recycles the oldest pop when the cap is hit so the screen stays snappy.
  const spawnPop = useCallback(
    (word: string, color: string) => {
      const pw = pageWidthRef.current;
      const ph = pageHeightRef.current;

      // Horizontal: pop can land anywhere from just left of the rail to near
      // the left edge. right = distance from the right edge of the page.
      const minRight = POP_RAIL_CLEARANCE;
      const maxRight = Math.max(minRight, pw - POP_EST_MAX_WIDTH - POP_LEFT_MARGIN);
      const right = minRight + Math.random() * (maxRight - minRight);

      // Vertical: safe zone between bottom exclusion and top exclusion.
      const safeFloor = bottomOffsetRef.current + POP_SCATTER_FLOOR;
      const safeCeil  = ph - POP_SCATTER_TOP_MARGIN;
      const bottom    = safeFloor + Math.random() * Math.max(0, safeCeil - safeFloor);

      const pop: Pop = {
        id: ++popCounter,
        word,
        color,
        rotation: Math.round((Math.random() * 30 - 15) * 10) / 10, // ±15°
        right,
        bottom,
      };

      // Cap: drop oldest when at limit so the screen never looks cluttered.
      setPops((prev) => {
        const trimmed = prev.length >= POP_MAX_COUNT ? prev.slice(1) : prev;
        return [...trimmed, pop];
      });
    },
    [],
  );

  const removePop = useCallback((id: number) => {
    setPops((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Reaction spawners — word variety + accent color ───────────────────────
  const spawnBoopPop = useCallback(
    () => spawnPop(pickWord(BOOP_WORDS), BOOP_COLOR),
    [spawnPop],
  );
  const spawnTreatPop = useCallback(
    () => spawnPop(pickWord(TREAT_WORDS), TREAT_COLOR),
    [spawnPop],
  );
  // Teaching pops — first-ever interaction per device. Same scatter; plain word.
  const spawnBoopTeachingPop  = useCallback(() => spawnPop('Boop',  BOOP_COLOR),  [spawnPop]);
  const spawnTreatTeachingPop = useCallback(() => spawnPop('Treat', TREAT_COLOR), [spawnPop]);

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

      // Exclusion zone: rail column (right) or bottom overlay (below petInfo).
      // Computed from pageWidthRef.current so it tracks the actual rendered
      // column width on web desktop (not the full window width).
      const pw = pageWidthRef.current;
      const railExclusionX = pw - RAIL_TOUCH_WIDTH - RAIL_RIGHT_INSET - RAIL_MARGIN;
      const bottomZoneTop = height - bottomOffset - petInfoHeightRef.current - 16;
      const inExclusionZone =
        chromeVisibleRef.current &&
        (locationX >= railExclusionX || locationY >= bottomZoneTop);

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
  // useMemo keeps the {uri} object reference stable across re-renders so that
  // FocalImage's source-reset effect doesn't fire when nothing has changed.
  const heroImage = useMemo(
    () => resolveMediaKey(post.mediaKey, post.mediaUrl),
    [post.mediaKey, post.mediaUrl],
  );

  // ── Derived display values for share card overlay ─────────────────────────
  // Declared before handleSharePress so they can appear in its dep array.
  const caption     = post.caption ?? '';
  const allPetNames = (post.taggedPets ?? []).length > 0
    ? (post.taggedPets ?? []).map((tp) => tp.name)
    : [post.pet.name];
  const displayName = allPetNames.length === 1 ? allPetNames[0]
    : allPetNames.length === 2 ? `${allPetNames[0]} & ${allPetNames[1]}`
    : `${allPetNames[0]} + ${allPetNames.length - 1} more`;

  // ── Share press handler ───────────────────────────────────────────────────
  // Defined after heroImage so the dep array references the memoised value.
  const handleSharePress = useCallback(async () => {
    // Extract a URI string from the resolved image source.
    // heroImage is ImageSourcePropType — we need the raw URI for sharing.
    const src = heroImage as { uri?: string } | number;
    const mediaUri = typeof src === 'object' && src !== null && 'uri' in src
      ? (src as { uri: string }).uri
      : null;
    if (!mediaUri) return; // seed/bundled assets — not shareable

    setIsSharing(true);
    try {
      // On native: wait for the off-screen card image to finish loading
      // before react-native-view-shot captures it.
      if (Platform.OS !== 'web' && !cardImageLoadedRef.current) {
        await Promise.race([
          new Promise<void>(resolve => { cardImageReadyResolveRef.current = resolve; }),
          new Promise<void>(resolve => setTimeout(resolve, 2000)),
        ]);
      }
      await executeShareCard({
        mediaUri, cardRef, showToast,
        petNames:    allPetNames,
        displayName,
        caption,
        cropX: post.cropX ?? null,
        cropY: post.cropY ?? null,
        cropW: post.cropW ?? null,
        cropH: post.cropH ?? null,
      });
    } catch (err) {
      // User dismissed the share sheet — not an error worth surfacing.
      // Any other failure (fetch, canvas, sharing API) gets a toast so the
      // user knows something went wrong instead of seeing a silent spinner.
      const msg = err instanceof Error ? err.message : '';
      const userCancelled = msg.includes('cancel') || msg.includes('abort') || msg.includes('share');
      if (!userCancelled) {
        showToast("couldn't create share card — try again 🐾");
      }
    } finally {
      setIsSharing(false);
    }
  }, [heroImage, showToast, allPetNames, displayName, caption, post.cropX, post.cropY, post.cropW, post.cropH]);

  const petName   = post.pet.name;
  const petBreed  = post.pet.breed ?? '';
  const petId     = post.pet.id;

  return (
    <View
      style={[styles.page, { height }]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        pageWidthRef.current = w;
        // Write the exact rendered cell size so the compose screen can lock its
        // crop frame and preview to the same aspect without guessing.
        setFeedCellDimensions(w, height);
      }}
    >
      {/* Full-bleed hero image — respects poster's crop rect/mode or focal point */}
      <FocalImage
        source={heroImage}
        style={styles.heroImage}
        focusX={post.cropFocusX}
        focusY={post.cropFocusY}
        cropX={post.cropX ?? null}
        cropY={post.cropY ?? null}
        cropW={post.cropW ?? null}
        cropH={post.cropH ?? null}
        mode={post.cropMode ?? null}
        containAlignBottom={bottomOffset + petInfoHeightRef.current + 16}
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
          { bottom: railBottom, opacity: chromeOpacity },
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
          onSharePress={handleSharePress}
          onBoopFired={spawnBoopPop}
          onTreatFired={spawnTreatPop}
          onToast={showToast}
          onTransientChange={handleTransientChange}
          onBoopTeaching={spawnBoopTeachingPop}
          onTreatTeaching={spawnTreatTeachingPop}
          reducedMotion={reducedMotion}
          petSpecies={post.pet.species}
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
            style={styles.petNameBtn}
          >
            <Text style={styles.petName} numberOfLines={1} ellipsizeMode="tail">{petName}</Text>
          </TouchableOpacity>
          <AddToPackLink
            petId={petId}
            initialInPack={post.pet.viewerInPack}
          />
        </View>

        {/* Tagged-with row — only when other pets are in the post */}
        {(post.taggedPets ?? []).filter(tp => tp.id !== petId).length > 0 && (
          <Text style={[styles.taggedWith, { color: 'rgba(240,244,248,0.7)' }]} numberOfLines={1} ellipsizeMode="tail">
            {'with '}
            {(post.taggedPets ?? []).filter(tp => tp.id !== petId).map((tp, i, arr) => (
              <Text key={tp.id} onPress={() => router.push(`/pet/${tp.id}` as never)} style={styles.taggedPetName}>
                {tp.name}{i < arr.length - 1 ? ', ' : ''}
              </Text>
            ))}
          </Text>
        )}

        <Text style={[styles.petBreed, { color: 'rgba(240,244,248,0.75)' }]} numberOfLines={1} ellipsizeMode="tail">
          {petBreed}
        </Text>

        {/* Caption — truncated to 2 lines in the feed; full caption on the detail screen */}
        <TouchableOpacity
          onPress={() => router.push(`/post/${post.id}`)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="View full post"
          hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
        >
          <Text
            style={[styles.petCaption, { color: 'rgba(240,244,248,0.9)' }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {`${caption || 'View full photo'}\u00A0`}
            {/* Non-breaking space keeps the glyph with the last word — prevents orphaning. */}
            <Text style={styles.captionExpand}>{'↗'}</Text>
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Reaction pop texts */}
      {pops.map((pop) => (
        <PopText
          key={pop.id}
          word={pop.word}
          color={pop.color}
          rotation={pop.rotation}
          right={pop.right}
          bottom={pop.bottom}
          reducedMotion={reducedMotion}
          onDone={() => removePop(pop.id)}
        />
      ))}

      {/* Treat-rejection toast — centered banner, wide enough for any rejection copy.
          Handles both 429 (out-of-treats) and 403 (self-treat nudge). */}
      <Animated.View
        style={[
          styles.outOfTreatsToast,
          { bottom: bottomOffset + 80, opacity: toastOpacity },
        ]}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pointerEvents={'none' as any}
      >
        <Text style={styles.outOfTreatsText}>{toastMsg}</Text>
      </Animated.View>

      {/*
       * ── OFF-SCREEN SHARE CARD (native only) ─────────────────────────────
       * Rendered outside the visible area via left:-9999 so react-native-view-shot
       * can capture it.  On web we compose via Canvas API instead — no view needed.
       */}
      {Platform.OS !== 'web' && (
        <ShareCard
          ref={cardRef}
          source={heroImage}
          cropX={post.cropX ?? null}
          cropY={post.cropY ?? null}
          cropW={post.cropW ?? null}
          cropH={post.cropH ?? null}
          displayName={displayName}
          caption={caption}
          onImageLoaded={handleCardImageLoaded}
        />
      )}

      {/*
       * ── SHARE GENERATION OVERLAY ─────────────────────────────────────────
       * A brief translucent dimmer with a spinner while the card is being
       * composited.  pointerEvents:none so gestures pass through if dismissed.
       */}
      {isSharing && (
        <View
          style={styles.sharingOverlay}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pointerEvents={'none' as any}
        >
          <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
        </View>
      )}
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
  petNameBtn: {
    // flexShrink:1 lets a long name truncate without eating all row space,
    // so AddToPackLink always stays visible inline next to the name.
    flexShrink: 1,
    overflow: 'hidden',
    marginRight: 6,
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
  taggedWith: {
    fontSize: 12,
    marginTop: 2,
    ...TEXT_SHADOW,
  },
  taggedPetName: {
    fontWeight: '600' as const,
    textDecorationLine: 'underline' as const,
  },
  petCaption: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    fontStyle: 'italic',
    ...TEXT_SHADOW,
  },
  // Out-of-treats toast — centered, wide, sits just above the rail.
  // Warm copy, no harsh error styling. pointerEvents:none so it never
  // intercepts taps on the content beneath.
  // zIndex/elevation ensure it renders above every other absolute layer
  // (Pressable tap-target, scrims, rail) so nothing can bury or clip it.
  outOfTreatsToast: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(16,20,28,0.88)',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    zIndex: 999,
    elevation: 999,
    overflow: 'visible',
  },
  outOfTreatsText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: 'rgba(240,244,248,0.95)',
    textAlign: 'center',
    letterSpacing: 0.1,
    ...TEXT_SHADOW,
  },
  // Expand glyph — inline hint that the text block is tappable.
  // fontStyle: 'normal' overrides the parent petCaption's italic so ↗ renders upright.
  // Opacity ~60 % makes it secondary to the caption without disappearing.
  captionExpand: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'normal' as const,
    color: 'rgba(240,244,248,0.60)',
    ...TEXT_SHADOW,
  },
  // Share-card generation overlay — brief translucent dimmer while the card
  // is being composited and handed to the OS share sheet.
  // pointerEvents:none lets through any taps underneath.
  sharingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex:          1000,
    elevation:       1000,
  },
});
