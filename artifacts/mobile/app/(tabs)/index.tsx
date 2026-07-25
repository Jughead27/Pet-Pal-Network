/**
 * Home Feed — vertical paged feed, one post per full-screen page.
 *
 * Uses a FlatList with pagingEnabled + snapToInterval so each swipe
 * snaps exactly to the next post on iOS, Android, and web.
 *
 * Per-page state (boop/treat counts, chrome toggle, pops) lives inside
 * each FeedPage — no state bleeds between pages on swipe.
 *
 * CommentSheet and ShareSheet are lifted here so they don't re-mount on
 * every page and the FlatList can disable its own scroll when they are open
 * (important for web where the Modal is not a native layer).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useGetFeed } from '@workspace/api-client-react';
import type { FeedPost } from '@workspace/api-client-react';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const { data, isLoading, isError } = useGetFeed();
  const posts = data?.posts ?? [];

  // ── Container height — measured via onLayout so snap interval is exact ────
  const [pageHeight, setPageHeight] = useState(0);

  // ── Reduced motion — read once, passed to every FeedPage ─────────────────
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => sub.remove();
  }, []);

  // ── Lifted sheet state ────────────────────────────────────────────────────
  // CommentSheet: tracks which post's sheet is open + its onCommentPosted cb
  const [commentConfig, setCommentConfig] = useState<CommentSheetConfig | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const openCommentSheet = useCallback((config: CommentSheetConfig) => {
    setCommentConfig(config);
  }, []);
  const closeCommentSheet = useCallback(() => setCommentConfig(null), []);
  const openShareSheet  = useCallback(() => setShareOpen(true),  []);
  const closeShareSheet = useCallback(() => setShareOpen(false), []);

  // ── FlatList refs ─────────────────────────────────────────────────────────
  const flatListRef = useRef<FlatList<FeedPost>>(null);

  // ── Render helpers ────────────────────────────────────────────────────────

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: pageHeight,
      offset: pageHeight * index,
      index,
    }),
    [pageHeight],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <FeedPage
        post={item}
        height={pageHeight}
        reducedMotion={reducedMotion}
        onOpenCommentSheet={openCommentSheet}
        onOpenShareSheet={openShareSheet}
      />
    ),
    [pageHeight, reducedMotion, openCommentSheet, openShareSheet],
  );

  const keyExtractor = useCallback((item: FeedPost) => item.id, []);

  // ── Loading / error states ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={[styles.fill, styles.centered]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || posts.length === 0) {
    return (
      <View style={[styles.fill, styles.centered]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          {isError ? 'Unable to load feed.' : 'Nothing here yet.'}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={styles.fill}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h > 0) setPageHeight(h);
      }}
    >
      {/*
        pagingEnabled  — native snap per full page (iOS; also maps to CSS
                         scroll-snap on web via Expo's FlatList implementation)
        snapToInterval — ensures exact snapping on Android and as a web fallback
        decelerationRate="fast" — crisp momentum feel
        scrollEnabled  — disabled while a modal sheet is open so wheel/trackpad
                         events on web don't scroll the feed behind the sheet
      */}
      {pageHeight > 0 && (
        <FlatList
          ref={flatListRef}
          data={posts}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          // Paging
          pagingEnabled
          snapToInterval={pageHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          // Prevent feed scroll when a modal is open
          scrollEnabled={commentConfig === null && !shareOpen}
          // Visual
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          // Windowing — render current + 1 above + 1 below
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={1}
          removeClippedSubviews
        />
      )}

      {/*
        Sheets rendered outside the FlatList so they sit above it in the
        z-stack and are not clipped by the windowed FlatList renderer.
      */}
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
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, textAlign: 'center' },
});
