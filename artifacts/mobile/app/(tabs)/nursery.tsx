/**
 * Nursery Feed — vertical paged feed showing only is_nursery posts.
 *
 * Structurally identical to the Home feed (index.tsx) — same FlatList pager,
 * same FeedPage component, same lifted CommentSheet/ShareSheet pattern.
 * The only difference is the query: useGetFeed({ nursery: true }).
 *
 * Scroll position is independent from Home's (separate FlatList ref + state).
 * No post-success scroll-to-top (nursery filter makes it irrelevant).
 *
 * Empty state: hatchling motif + copy explaining the nursery flag.
 *
 * No react-native-reanimated imports.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { useGetFeed } from '@workspace/api-client-react';
import type { FeedPost } from '@workspace/api-client-react';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';

// ─── HatchlingIcon ─────────────────────────────────────────────────────────────
// A cracked egg with a tiny chick head peeking out — the hatchling motif.

function HatchlingIcon({ size = 72, color }: { size?: number; color: string }) {
  const s = size / 72; // scale factor
  return (
    <Svg width={size} height={size} viewBox="0 0 72 72" fill="none">
      {/* Egg body (lower half) */}
      <Ellipse
        cx={36} cy={46}
        rx={20} ry={22}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* Egg top (upper half, slightly narrower) */}
      <Path
        d={`M16 46 C16 28 56 28 56 46`}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* Crack line — zigzag across the equator */}
      <Path
        d="M16 46 L24 42 L30 48 L38 41 L44 47 L50 43 L56 46"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Chick head peeking out above the crack */}
      <Circle cx={36} cy={30} r={9} fill="none" stroke={color} strokeWidth={2.5} />
      {/* Eyes */}
      <Circle cx={32.5} cy={28.5} r={1.5} fill={color} />
      <Circle cx={39.5} cy={28.5} r={1.5} fill={color} />
      {/* Beak */}
      <Path
        d="M34.5 32 L36 34 L37.5 32"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── NurseryScreen ────────────────────────────────────────────────────────────

export default function NurseryScreen() {
  const colors = useColors();
  const { data, isLoading, isError } = useGetFeed({ nursery: true });
  const posts = data?.posts ?? [];

  const { height: windowHeight } = useWindowDimensions();
  const [pageHeight, setPageHeight] = useState(0);
  const effectivePageHeight = Platform.OS === 'web' ? windowHeight : pageHeight;

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => sub.remove();
  }, []);

  // Lifted sheet state — same pattern as Home
  const [commentConfig, setCommentConfig] = useState<CommentSheetConfig | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const openCommentSheet  = useCallback((cfg: CommentSheetConfig) => setCommentConfig(cfg), []);
  const closeCommentSheet = useCallback(() => setCommentConfig(null), []);
  const openShareSheet    = useCallback(() => setShareOpen(true),  []);
  const closeShareSheet   = useCallback(() => setShareOpen(false), []);

  const flatListRef = useRef<FlatList<FeedPost>>(null);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: effectivePageHeight,
      offset: effectivePageHeight * index,
      index,
    }),
    [effectivePageHeight],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <FeedPage
        post={item}
        height={effectivePageHeight}
        reducedMotion={reducedMotion}
        onOpenCommentSheet={openCommentSheet}
        onOpenShareSheet={openShareSheet}
      />
    ),
    [effectivePageHeight, reducedMotion, openCommentSheet, openShareSheet],
  );

  const keyExtractor = useCallback((item: FeedPost) => item.id, []);

  const containerStyle = Platform.OS === 'web'
    ? [styles.fill, { height: windowHeight, backgroundColor: colors.background }]
    : [styles.fill, { backgroundColor: colors.background }];

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[containerStyle, styles.centered]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <View style={[containerStyle, styles.centered]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          Unable to load nursery feed.
        </Text>
      </View>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (posts.length === 0) {
    return (
      <View style={[containerStyle, styles.centered]}>
        <View style={styles.emptyContent}>
          <HatchlingIcon size={72} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No nursery posts yet
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Flag baby moments when you post and they'll{'\n'}hatch right here.
          </Text>
        </View>
      </View>
    );
  }

  // ── Feed ───────────────────────────────────────────────────────────────────
  return (
    <View
      style={containerStyle}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h > 0) setPageHeight(h);
      }}
    >
      {effectivePageHeight > 0 && (
        <FlatList
          ref={flatListRef}
          data={posts}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          pagingEnabled
          snapToInterval={effectivePageHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          scrollEnabled={commentConfig === null && !shareOpen}
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={1}
          removeClippedSubviews
        />
      )}

      <CommentSheet
        visible={commentConfig !== null}
        onClose={closeCommentSheet}
        postId={commentConfig?.postId ?? null}
        onCommentPosted={commentConfig?.onCommentPosted}
      />
      <ShareSheet
        visible={shareOpen}
        onClose={closeShareSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, textAlign: 'center' },

  emptyContent: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      18,
    letterSpacing: -0.2,
    textAlign:     'center',
  },
  emptyBody: {
    fontFamily:  'Inter_400Regular',
    fontSize:    14,
    lineHeight:  21,
    textAlign:   'center',
  },
});
