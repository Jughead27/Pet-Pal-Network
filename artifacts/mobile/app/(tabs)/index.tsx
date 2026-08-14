/**
 * Home Feed — vertical paged feed, one post per full-screen page.
 *
 * Uses a FlatList with pagingEnabled + snapToInterval so each swipe
 * snaps exactly to the next post on iOS, Android, and web.
 *
 * Per-page state (boop/treat counts, chrome toggle, pops) lives inside
 * each FeedPage — no state bleeds between pages on swipe.
 *
 * CommentSheet is lifted here so it doesn't re-mount on every page and the
 * FlatList can disable its own scroll while it is open (important for web
 * where the Modal is not a native layer).  Share card generation runs inside
 * each FeedPage instance and needs no lifted state.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useGetFeedInfinite, getGetFeedQueryKey } from '@workspace/api-client-react';
import type { FeedResponse } from '@workspace/api-client-react';
import type { InfiniteData } from '@tanstack/react-query';
import { getPostSuccessSignalTime, clearPostSuccessSignal } from '@/utils/feedScrollSignal';
import type { FeedPost } from '@workspace/api-client-react';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const navigation = useNavigation();
  // refetchOnWindowFocus disabled for the feed ONLY: a passive refocus refetch
  // can replace the posts array mid-scroll (prepends shift every index while
  // pixel scrollTop stays put → visual jump). Deliberate invalidations from
  // add/edit/pet screens still mark this query stale and refetch as before.
  // Cursor pagination via useGetFeedInfinite. The queryKey keeps the
  // '/api/feed' prefix FIRST so every existing invalidateQueries(
  // getGetFeedQueryKey()) call elsewhere still prefix-matches this cache entry.
  const {
    data, dataUpdatedAt, isLoading, isError,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useGetFeedInfinite<InfiniteData<FeedResponse>>(undefined, {
    query: {
      queryKey: [...getGetFeedQueryKey(), 'infinite'],
      refetchOnWindowFocus: false,
      initialPageParam: undefined,
      getNextPageParam: (last: FeedResponse) => last.nextCursor ?? undefined,
    } as never,
  });
  const posts = useMemo(
    () => data?.pages.flatMap((p) => p.posts) ?? [],
    [data],
  );

  // Fetch the next page well before the user reaches the last full-screen
  // page. No footer cell here: the pager snaps to full-page intervals, and a
  // short footer would break snap alignment — prefetching ahead means the
  // end is normally never seen.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  const openCommentSheet = useCallback((config: CommentSheetConfig) => {
    setCommentConfig(config);
  }, []);

  // ── FlatList refs ─────────────────────────────────────────────────────────
  const flatListRef = useRef<FlatList<FeedPost>>(null);

  // ── Web-only restore-on-close for the comment sheet ───────────────────────
  // While the sheet is open on mobile web, the on-screen keyboard shrinks
  // useWindowDimensions().height, which resizes every pager cell while the
  // pixel scrollTop stays put — mandatory CSS scroll-snap then re-commits the
  // feed to a DIFFERENT index. When the sheet closes we must land back on the
  // exact post whose comments were being viewed. Same bounded verify-and-
  // correct loop proven on the Sniff/Nursery pagers: never matches while the
  // target ID is absent, suppresses scroll-snap during the landing window,
  // and uses a run token so a stale loop from a rapid close/reopen exits
  // cleanly. Native is untouched (the feed cannot drift under the modal).
  const webRestoreDone     = useRef(true);
  const webRestoreToken    = useRef(0);
  const restoreTargetIdRef = useRef<string | null>(null);
  const postsForRestoreRef = useRef<FeedPost[]>([]);
  const pageHeightForRestoreRef = useRef(0);
  postsForRestoreRef.current      = posts;
  pageHeightForRestoreRef.current = effectivePageHeight;

  const runWebFeedRestore = useCallback(() => {
    if (Platform.OS !== 'web' || webRestoreDone.current) return;
    const runToken = webRestoreToken.current;
    const MAX_TOTAL_FRAMES  = 120; // ~2s hard cap
    const MAX_SETTLE_FRAMES = 30;
    const STABLE_FRAMES     = 12;  // ~200ms of confirmed-correct position
    let totalFrames  = 0;
    let settleFrames = 0;
    let stableFrames = 0;
    let snapNode: HTMLElement | null = null;
    const restoreSnap = () => {
      if (snapNode) {
        snapNode.style.scrollSnapType = ''; // back to RNW's mandatory snap
        snapNode = null;
      }
    };
    const finish = () => {
      webRestoreDone.current = true;
      restoreSnap();
    };
    const tick = () => {
      if (webRestoreToken.current !== runToken) {
        restoreSnap(); // stale run — restore own snap node, don't touch flags
        return;
      }
      if (webRestoreDone.current) {
        restoreSnap();
        return;
      }
      const list = flatListRef.current as unknown as {
        getScrollableNode?: () => HTMLElement | null;
      } | null;
      const node  = list?.getScrollableNode?.() ?? null;
      const pageH = pageHeightForRestoreRef.current;
      if (node && pageH > 0) {
        if (!snapNode) {
          snapNode = node;
          node.style.scrollSnapType = 'none';
        }
        // Never match while the target post is absent — findIndex(-1) keeps
        // the loop watching instead of falsely matching index 0.
        const idx = postsForRestoreRef.current.findIndex(
          (p) => p.id === restoreTargetIdRef.current,
        );
        if (idx >= 0) {
          const expected = idx * pageH;
          if (Math.abs(node.scrollTop - expected) <= 1) {
            stableFrames += 1;
            if (stableFrames >= STABLE_FRAMES) {
              finish();
              return;
            }
          } else {
            stableFrames = 0;
            node.scrollTop = expected;
            settleFrames += 1;
            if (settleFrames >= MAX_SETTLE_FRAMES) {
              finish();
              return;
            }
          }
        }
      }
      totalFrames += 1;
      if (totalFrames < MAX_TOTAL_FRAMES) {
        requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    requestAnimationFrame(tick);
  }, []);

  // Explicit back out of a comment thread must land on the EXACT post whose
  // comments were being viewed.
  const commentSheetPostIdRef = useRef<string | null>(null);
  commentSheetPostIdRef.current = commentConfig?.postId ?? null;

  const closeCommentSheet = useCallback(() => {
    const targetId = commentSheetPostIdRef.current;
    setCommentConfig(null);
    if (Platform.OS === 'web' && targetId) {
      restoreTargetIdRef.current = targetId;
      webRestoreToken.current += 1; // invalidate any stale loop
      webRestoreDone.current = false;
      runWebFeedRestore();
    }
  }, [runWebFeedRestore]);

  // ── Web viewport-height re-anchoring ─────────────────────────────────────
  // On mobile web the browser URL bar collapsing/expanding during normal
  // scrolling changes windowHeight, which resizes EVERY pager cell while the
  // pixel scrollTop stays put — mandatory scroll-snap then re-commits the feed
  // to a different index (rapid multi-post "auto-scroll"). Same failure class
  // as the keyboard resize; same correction: compute which post the user was
  // on from the PRE-change height, then arm the existing verify-and-correct
  // loop to re-anchor to that post at the new height.
  // Debounced (180ms): on mobile web the URL-bar collapse/expand animates over
  // several frames, so windowHeight ticks through multiple intermediate values
  // in quick succession. Firing a correction loop per tick made overlapping
  // loops fight the user's momentum scroll (rapid-scroll bug). We wait until
  // windowHeight has been stable for 180ms before running the existing
  // re-anchor logic — the timer is cleared and restarted on every change.
  // prevWebHeightRef is only advanced when the settled body runs, so the
  // scrollTop→index math still divides by the true pre-transition height.
  const prevWebHeightRef = useRef(windowHeight);
  const webHeightSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (webHeightSettleTimerRef.current !== null) {
      clearTimeout(webHeightSettleTimerRef.current);
      webHeightSettleTimerRef.current = null;
    }
    if (windowHeight === prevWebHeightRef.current) return;
    webHeightSettleTimerRef.current = setTimeout(() => {
      webHeightSettleTimerRef.current = null;
      const prevH = prevWebHeightRef.current;
      if (windowHeight === prevH) return;
      prevWebHeightRef.current = windowHeight;
      // Comment sheet open → keyboard-driven resize; handled by the existing
      // restore-on-close path. Don't fight it.
      if (commentSheetPostIdRef.current) return;
      // A restore already in flight re-reads pageHeightForRestoreRef each frame,
      // so it adapts to the new height on its own.
      if (!webRestoreDone.current) return;
      const node = (flatListRef.current as unknown as {
        getScrollableNode?: () => HTMLElement | null;
      } | null)?.getScrollableNode?.() ?? null;
      if (!node || prevH <= 0) return;
      const list = postsForRestoreRef.current;
      if (list.length === 0) return;
      // scrollTop is divided by the OLD (pre-transition) height to recover the
      // post the user was actually viewing.
      const idx = Math.min(Math.max(Math.round(node.scrollTop / prevH), 0), list.length - 1);
      const target = list[idx];
      if (!target) return;
      restoreTargetIdRef.current = target.id;
      webRestoreToken.current += 1; // invalidate any stale loop
      webRestoreDone.current = false;
      runWebFeedRestore();
    }, 180);
    return () => {
      if (webHeightSettleTimerRef.current !== null) {
        clearTimeout(webHeightSettleTimerRef.current);
        webHeightSettleTimerRef.current = null;
      }
    };
  }, [windowHeight, runWebFeedRestore]);

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
      />
    ),
    [effectivePageHeight, reducedMotion, openCommentSheet],
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
          scrollEnabled={commentConfig === null}
          // Visual
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          // Windowing — render current + 1 above + 1 below
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={1}
          // removeClippedSubviews has known RNW glitches: it can unmount
          // visible items during rapid scroll-position changes (blank/black
          // frames). Keep it on native only.
          removeClippedSubviews={Platform.OS !== 'web'}
          // Pagination — purely additive: appends to the data array only.
          onEndReached={handleEndReached}
          onEndReachedThreshold={2}
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, textAlign: 'center' },
});
