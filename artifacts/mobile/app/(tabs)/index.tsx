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
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useGetFeed } from '@workspace/api-client-react';
import { getPostSuccessSignalTime, clearPostSuccessSignal } from '@/utils/feedScrollSignal';
import type { FeedPost } from '@workspace/api-client-react';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const navigation = useNavigation();
  const { data, dataUpdatedAt, isLoading, isError } = useGetFeed();
  const posts = data?.posts ?? [];

  // ── Window dimensions — used as the web fallback for page height ──────────
  // On web, the flex:1 chain inside Expo Router's Tabs shell never resolves to
  // a real pixel height, so onLayout fires with 0. useWindowDimensions() always
  // returns the viewport height immediately, which is the correct full-screen
  // page height on web (the tab bar is position:absolute, so it floats above
  // content rather than shrinking the scroll area).
  const { height: windowHeight } = useWindowDimensions();

  // ── Container height — measured via onLayout so snap interval is exact ────
  // On native this measurement accounts for status-bar / navigation-bar insets
  // that useWindowDimensions does not. On web we fall back to windowHeight.
  const [pageHeight, setPageHeight] = useState(0);

  // Effective height: on web use window height immediately (never wait for
  // onLayout which resolves to 0); on native use the onLayout measurement.
  const effectivePageHeight = Platform.OS === 'web' ? windowHeight : pageHeight;

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

  // ── Tab-press scroll-to-top ───────────────────────────────────────────────
  // Tapping the Home tab (even when already focused) always scrolls the feed
  // back to the latest post.  Uses tabPress rather than useFocusEffect because
  // useFocusEffect silently no-ops on tab screens.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (navigation as any).addListener('tabPress', () => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, [navigation]);

  // ── Post-success scroll-to-top ────────────────────────────────────────────
  // When the Add flow posts successfully it stamps a signal timestamp.
  // We watch dataUpdatedAt: once it exceeds the stamp the refetch has landed
  // (the new post is at index 0), and only then do we scroll and clear the
  // signal — avoiding any flash of the old top post before new data arrives.
  // Normal tab switches and app reopens never set the signal, so they are
  // completely unaffected.
  useEffect(() => {
    const signalTime = getPostSuccessSignalTime();
    if (signalTime === 0) return;           // no pending signal
    if (dataUpdatedAt <= signalTime) return; // refetch hasn't landed yet
    // Fresh feed data is here — scroll the pager to the new post at index 0.
    clearPostSuccessSignal();
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [dataUpdatedAt]);

  // ── Render helpers ────────────────────────────────────────────────────────

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

  // ── Loading / error states ────────────────────────────────────────────────

  // ── Web-aware container style ─────────────────────────────────────────────
  // On web the Expo Router Tabs shell does not propagate a pixel height down
  // through flex:1, so the root View measures as 0 px and onLayout fires with
  // height:0. We pin the container to windowHeight on web so the background
  // renders and the FlatList has a real height to work with.
  const containerStyle = Platform.OS === 'web'
    ? [styles.fill, { height: windowHeight, backgroundColor: colors.background }]
    : [styles.fill, { backgroundColor: colors.background }];

  if (isLoading) {
    return (
      <View style={[containerStyle, styles.centered]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || posts.length === 0) {
    return (
      <View style={[containerStyle, styles.centered]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          {isError ? 'Unable to load feed.' : 'Nothing here yet.'}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={containerStyle}
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

        Guard: effectivePageHeight is windowHeight on web (always > 0) and the
        onLayout measurement on native (wait until nonzero before rendering).
      */}
      {effectivePageHeight > 0 && (
        <FlatList
          ref={flatListRef}
          data={posts}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          // Paging
          pagingEnabled
          snapToInterval={effectivePageHeight}
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
