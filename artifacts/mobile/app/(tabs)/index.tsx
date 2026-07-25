/**
 * Home Feed — full-bleed single pet post.
 *
 * Data comes from GET /feed via useGetFeed().  The first (most recent) post
 * is featured.  Boop reactions are instant and optimistic; counts are seeded
 * from the server on first load.  Treat reactions are server-confirmed.
 *
 * Gestures:
 *   Single tap on media  → toggle chrome (name/rail/scrim fade 200ms)
 *   Double tap on media  → boop (same as rail Boop button, optimistic)
 *   Tap "more/less"      → expand / collapse caption
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import { useGetFeed, useBoopPost } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';
import ActionRail from '@/components/ActionRail';
import AddToPackLink from '@/components/AddToPackLink';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';
import PopText from '@/components/PopText';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Exclusion-zone geometry ───────────────────────────────────────────────────
const RAIL_TOUCH_WIDTH   = 40;
const RAIL_RIGHT_INSET   = 14;
const RAIL_MARGIN        = 24;
const RAIL_EXCLUSION_X   = SCREEN_WIDTH - RAIL_TOUCH_WIDTH - RAIL_RIGHT_INSET - RAIL_MARGIN;

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

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { boop, initFromServer } = useApp();

  // ── Server data ──────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useGetFeed();
  const featuredPost = data?.posts?.[0] ?? null;
  const hasInitialized = useRef(false);

  // Seed local state from server on first successful load
  useEffect(() => {
    if (data && featuredPost && !hasInitialized.current) {
      hasInitialized.current = true;
      initFromServer(
        featuredPost.boopCount,
        featuredPost.treatCount,
        featuredPost.commentCount,
        featuredPost.viewerHasBooped,
        featuredPost.viewerHasTreated,
        data.viewer.treatsRemainingToday,
      );
    }
  }, [data, featuredPost, initFromServer]);

  // ── Boop mutation for double-tap gesture (optimistic + background) ────────
  const { mutate: doBoopPost } = useBoopPost();

  // ── Reduced motion ───────────────────────────────────────────────────────
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

  // Chrome visibility
  const chromeVisibleRef = useRef(true);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeOpacity = useRef(new Animated.Value(1)).current;

  // Double-tap detection
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTapRef       = useRef(false);
  const pendingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const petInfoHeightRef = useRef(120);

  // Reaction pops
  const [pops, setPops] = useState<Pop[]>([]);

  const bottomOffset = insets.bottom + 110;
  const BOOP_BOTTOM  = bottomOffset + 210;
  const TREAT_BOTTOM = bottomOffset + 143;
  const POP_RIGHT    = 60;

  const spawnPop = useCallback((word: string, bottom: number) => {
    const pop: Pop = { id: ++popCounter, word, rotation: randRotation(), right: POP_RIGHT, bottom };
    setPops((prev) => [...prev, pop]);
  }, [POP_RIGHT]);

  const removePop = useCallback((id: number) => {
    setPops((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const spawnBoopPop  = useCallback(() => spawnPop('Boop!', BOOP_BOTTOM),  [spawnPop, BOOP_BOTTOM]);
  const spawnTreatPop = useCallback(() => spawnPop('Yum!',  TREAT_BOTTOM), [spawnPop, TREAT_BOTTOM]);

  // ── Gesture handler ──────────────────────────────────────────────────────
  const handleMediaPress = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = e.nativeEvent;
    const bottomZoneTop = SCREEN_HEIGHT - bottomOffset - petInfoHeightRef.current - 16;
    const inZone = chromeVisibleRef.current && (
      locationX >= RAIL_EXCLUSION_X || locationY >= bottomZoneTop
    );

    if (tapTimerRef.current !== null) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      // Double-tap boop: optimistic + background request
      boop();
      spawnBoopPop();
      if (featuredPost) doBoopPost({ id: featuredPost.id });
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
      if (featuredPost) doBoopPost({ id: featuredPost.id });
      return;
    }

    if (inZone) {
      pendingTapRef.current = true;
      pendingClearTimerRef.current = setTimeout(() => {
        pendingTapRef.current = false;
        pendingClearTimerRef.current = null;
      }, 280);
    } else {
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
  }, [boop, spawnBoopPop, bottomOffset, chromeOpacity, featuredPost, doBoopPost]);

  // ── Loading / error states ───────────────────────────────────────────────
  if (isLoading || (!featuredPost && !isError)) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !featuredPost) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          Unable to load feed.
        </Text>
      </View>
    );
  }

  const heroImage = resolveMediaKey(featuredPost.mediaKey);
  const petName   = featuredPost.pet.name;
  const petBreed  = featuredPost.pet.breed ?? '';
  const petId     = featuredPost.pet.id;
  const caption   = featuredPost.caption ?? '';

  return (
    <View style={styles.container}>
      {/* ── Full-bleed hero image ── */}
      <Image source={heroImage} style={styles.heroImage} resizeMode="cover" />

      {/* ── Media tap target — sits behind all overlays ── */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleMediaPress} />

      {/* ── Bottom legibility scrim ── */}
      <Animated.View style={[styles.scrim, { opacity: chromeOpacity }]}>
        <LinearGradient
          colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.25)', 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── Right-edge rail scrim ── */}
      <Animated.View style={[styles.railScrim, { opacity: chromeOpacity }]}>
        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.15)', 'transparent']}
          locations={[0, 0.6, 1]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── ActionRail ── */}
      <Animated.View
        style={[
          styles.railContainer,
          { bottom: bottomOffset, opacity: chromeOpacity },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { pointerEvents: (chromeVisible ? 'box-none' : 'none') as any },
        ]}
      >
        <ActionRail
          postId={featuredPost.id}
          onCommentPress={() => setCommentSheetVisible(true)}
          onSharePress={() => setShareSheetVisible(true)}
          onBoopFired={spawnBoopPop}
          onTreatFired={spawnTreatPop}
        />
      </Animated.View>

      {/* ── Pet info ── */}
      <Animated.View
        style={[
          styles.petInfo,
          { bottom: bottomOffset, right: 80, opacity: chromeOpacity },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { pointerEvents: (chromeVisible ? 'box-none' : 'none') as any },
        ]}
        onLayout={(e) => { petInfoHeightRef.current = e.nativeEvent.layout.height; }}
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

        {/* Caption with expand/collapse */}
        <View>
          <Text
            style={[styles.petCaption, styles.captionMeasure]}
            onTextLayout={(e) => setCaptionNeedsMore(e.nativeEvent.lines.length > 2)}
          >
            {caption}
          </Text>
          <Text
            style={[styles.petCaption, { color: 'rgba(240,244,248,0.9)' }]}
            numberOfLines={captionExpanded ? undefined : 2}
          >
            {caption}
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
        postId={featuredPost.id}
      />
      <ShareSheet
        visible={shareSheetVisible}
        onClose={() => setShareSheetVisible(false)}
      />

      {/* ── Reaction pops ── */}
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
  container: { flex: 1, backgroundColor: '#060B10' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, textAlign: 'center' },
  heroImage: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%', height: '100%',
  },
  scrim: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: SCREEN_HEIGHT * 0.45,
    pointerEvents: 'none',
  },
  railScrim: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 96,
    pointerEvents: 'none',
  },
  railContainer: { position: 'absolute', right: 14 },
  petInfo: { position: 'absolute', left: 18, gap: 3 },
  identityRow: { flexDirection: 'row', alignItems: 'center' },
  petName: {
    color: '#F0F4F8', fontSize: 22, fontWeight: '700' as const,
    letterSpacing: 0.2, ...TEXT_SHADOW,
  },
  petBreed: { fontSize: 13, fontWeight: '500' as const, letterSpacing: 0.3, ...TEXT_SHADOW },
  petCaption: { fontSize: 13, lineHeight: 18, marginTop: 2, fontStyle: 'italic', ...TEXT_SHADOW },
  captionMeasure: {
    position: 'absolute', opacity: 0, color: 'transparent', pointerEvents: 'none',
  },
  captionMore: {
    marginTop: 2, fontSize: 12, fontWeight: '600' as const,
    color: 'rgba(240,244,248,0.55)', ...TEXT_SHADOW,
  },
});
