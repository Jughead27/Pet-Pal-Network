/**
 * Nursery Tab — two-layer browsing experience.
 *
 * LAYER 1 (default): 3-column thumbnail grid of is_nursery posts, newest first.
 *   • Square cells, FocalImage cover-fit honouring focal points.
 *   • Hatchling empty state when no nursery posts exist.
 *   • Scroll position preserved across grid ↔ pager transitions.
 *
 * LAYER 2 (on tap): full-screen vertical pager opening at the tapped index.
 *   • Identical to the Home pager: full rail (boop/treat/comment/share),
 *     focal framing, caption→detail, Pack paw.
 *   • Back button (top-left) returns to the grid.
 *   • Android hardware back also returns to the grid.
 *   • Swipe moves through nursery posts only.
 *
 * Both layers share a single useGetFeed({ nursery: true }) call — no double
 * fetch, no data duplication.
 *
 * This grid→pager wiring is the canonical pattern; the discovery tab will
 * reuse the same approach. No speculative abstraction until it is needed.
 *
 * No react-native-reanimated imports.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  Dimensions,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetFeed } from '@workspace/api-client-react';
import type { FeedPost } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';
import FocalImage from '@/components/FocalImage';
import HatchlingIcon from '@/components/HatchlingIcon';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';

// ─── Layout constants ──────────────────────────────────────────────────────────

const SCREEN_WIDTH   = Dimensions.get('window').width;
const NUM_COLS       = 3;
const CELL_GAP       = 2;  // px between columns (and rows)
// Each cell fills 1/3 of the screen minus the two inter-column gaps
const THUMBNAIL_SIZE = (SCREEN_WIDTH - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS;

// ─── NurseryScreen ─────────────────────────────────────────────────────────────

type ViewMode = 'grid' | 'pager';

export default function NurseryScreen() {
  const colors       = useColors();
  const insets       = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // ── Shared nursery data ────────────────────────────────────────────────────
  const { data, isLoading, isError } = useGetFeed({ nursery: true });
  const posts = data?.posts ?? [];

  // ── Layout measurement (shared between grid and pager) ─────────────────────
  // On web effectivePageHeight is always windowHeight (onLayout resolves to 0).
  // On native it is the measured container height (accounts for notch/nav bars).
  const [pageHeight, setPageHeight]   = useState(0);
  const effectivePageHeight = Platform.OS === 'web' ? windowHeight : pageHeight;

  // ── Reduced-motion preference (passed to every FeedPage) ──────────────────
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => sub.remove();
  }, []);

  // ── View-mode state ────────────────────────────────────────────────────────
  const [viewMode,        setViewMode]        = useState<ViewMode>('grid');
  const [pagerStartIndex, setPagerStartIndex] = useState(0);

  // ── Grid scroll preservation ───────────────────────────────────────────────
  // onScroll writes the current offset into a ref (no re-render).
  // When returning from the pager we scroll back to that offset.
  const gridScrollY      = useRef(0);
  const gridListRef      = useRef<FlatList<FeedPost>>(null);
  const pagerListRef     = useRef<FlatList<FeedPost>>(null);
  // Guards the one-shot initial scroll so subsequent onLayout/re-render
  // calls don't re-trigger it after the pager is already positioned.
  const pagerScrolledRef = useRef(false);

  // ── Pager lifted sheet state ───────────────────────────────────────────────
  const [commentConfig, setCommentConfig] = useState<CommentSheetConfig | null>(null);
  const [shareOpen,     setShareOpen]     = useState(false);

  const openCommentSheet  = useCallback((cfg: CommentSheetConfig) => setCommentConfig(cfg), []);
  const closeCommentSheet = useCallback(() => setCommentConfig(null), []);
  const openShareSheet    = useCallback(() => setShareOpen(true),  []);
  const closeShareSheet   = useCallback(() => setShareOpen(false), []);

  // ── Open pager at index ────────────────────────────────────────────────────
  const openPost = useCallback((index: number) => {
    pagerScrolledRef.current = false; // reset so the new pager scrolls to the right index
    setPagerStartIndex(index);
    setViewMode('pager');
  }, []);

  // ── Return to grid ─────────────────────────────────────────────────────────
  const closePost = useCallback(() => {
    // Close any open sheets before returning to grid
    setCommentConfig(null);
    setShareOpen(false);
    setViewMode('grid');

    // Restore scroll position after React flushes the grid render.
    // requestAnimationFrame gives the FlatList one frame to mount.
    requestAnimationFrame(() => {
      if (gridScrollY.current > 0) {
        gridListRef.current?.scrollToOffset({
          offset:   gridScrollY.current,
          animated: false,
        });
      }
    });
  }, []);

  // ── Initial pager scroll (replaces initialScrollIndex) ────────────────────
  //
  // Root cause of the crash: initialScrollIndex calls into the native scroll
  // layer before the freshly-mounted FlatList's scroll view has finished its
  // own layout pass, producing an invalid scroll offset (scroll container
  // height is 0 on frame 1 even though pageHeight state is non-zero).
  //
  // Fix: omit initialScrollIndex entirely. After the component commits to the
  // DOM/native layer, requestAnimationFrame defers the scroll command until
  // the layout pass is complete — runs before the next paint, so no visible
  // flash at any index.
  useEffect(() => {
    if (viewMode !== 'pager') return;
    if (pagerScrolledRef.current) return;
    pagerScrolledRef.current = true;

    if (pagerStartIndex === 0 || effectivePageHeight <= 0) return; // already at top

    requestAnimationFrame(() => {
      pagerListRef.current?.scrollToOffset({
        offset:   pagerStartIndex * effectivePageHeight,
        animated: false,
      });
    });
    // Intentionally excludes effectivePageHeight from deps — we want this to
    // fire exactly once per pager open, not re-fire if height updates later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, pagerStartIndex]);

  // ── Android hardware back ──────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'pager') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      closePost();
      return true; // consumed — don't bubble to navigator
    });
    return () => handler.remove();
  }, [viewMode, closePost]);

  // ── Shared container style ─────────────────────────────────────────────────
  const containerStyle = Platform.OS === 'web'
    ? [styles.fill, { height: windowHeight, backgroundColor: colors.background }]
    : [styles.fill, { backgroundColor: colors.background }];

  // ── Shared layout handler ──────────────────────────────────────────────────
  const handleContainerLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) setPageHeight(h);
    },
    [],
  );

  // ── Loading / error (shared across both layers) ────────────────────────────
  if (isLoading) {
    return (
      <View style={[containerStyle, styles.centered]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[containerStyle, styles.centered]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          Unable to load nursery posts.
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

  // ══════════════════════════════════════════════════════════════════════════════
  // LAYER 2: Full-screen pager
  // Rendered when a thumbnail has been tapped.
  // ══════════════════════════════════════════════════════════════════════════════

  if (viewMode === 'pager') {
    const backBtnTop = Platform.OS === 'web' ? 67 + 8 : insets.top + 8;

    const getPagerItemLayout = (_: unknown, index: number) => ({
      length: effectivePageHeight,
      offset: effectivePageHeight * index,
      index,
    });

    const renderPagerItem = ({ item }: { item: FeedPost }) => (
      <FeedPage
        post={item}
        height={effectivePageHeight}
        reducedMotion={reducedMotion}
        onOpenCommentSheet={openCommentSheet}
        onOpenShareSheet={openShareSheet}
      />
    );

    return (
      <View
        style={containerStyle}
        onLayout={handleContainerLayout}
      >
        {effectivePageHeight > 0 && (
          <FlatList
            ref={pagerListRef}
            data={posts}
            renderItem={renderPagerItem}
            keyExtractor={(item) => item.id}
            getItemLayout={getPagerItemLayout}
            // initialScrollIndex removed — see the useEffect above.
            // Paging
            pagingEnabled
            snapToInterval={effectivePageHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            // Disable scrolling while a sheet is open
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

        {/* Back button — rendered after FlatList so it paints above it */}
        <TouchableOpacity
          onPress={closePost}
          style={[styles.backBtn, { top: backBtnTop }]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Back to grid"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color="#F0F4F8" />
        </TouchableOpacity>

        {/* Sheets sit above everything */}
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

  // ══════════════════════════════════════════════════════════════════════════════
  // LAYER 1: Thumbnail grid
  // Default view — 3 columns, square cells, FocalImage cover-fit.
  // ══════════════════════════════════════════════════════════════════════════════

  const renderGridItem = ({ item, index }: { item: FeedPost; index: number }) => (
    <TouchableOpacity
      onPress={() => openPost(index)}
      activeOpacity={0.85}
      style={styles.cell}
      accessibilityRole="button"
      accessibilityLabel={item.caption ?? `Nursery post ${index + 1}`}
    >
      <FocalImage
        source={resolveMediaKey(item.mediaKey, item.mediaUrl)}
        style={styles.cellImage}
        focusX={item.cropFocusX}
        focusY={item.cropFocusY}
      />
    </TouchableOpacity>
  );

  return (
    <View style={containerStyle} onLayout={handleContainerLayout}>
      <FlatList
        ref={gridListRef}
        data={posts}
        renderItem={renderGridItem}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLS}
        // 2 px gap between columns; rows are separated by marginBottom on each cell
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        // Track scroll offset for restoration when returning from pager
        onScroll={(e) => {
          gridScrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        // Start content below the tab bar on web; native handles this via insets
        contentContainerStyle={
          Platform.OS === 'web'
            ? { paddingTop: 0, paddingBottom: 84 }
            : { paddingBottom: insets.bottom + 80 }
        }
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyContent: {
    alignItems:      'center',
    gap:             16,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      18,
    letterSpacing: -0.2,
    textAlign:     'center',
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize:   14,
    lineHeight: 21,
    textAlign:  'center',
  },

  // ── Grid ───────────────────────────────────────────────────────────────────
  columnWrapper: {
    gap: CELL_GAP,
  },
  cell: {
    width:        THUMBNAIL_SIZE,
    height:       THUMBNAIL_SIZE,
    marginBottom: CELL_GAP,
    overflow:     'hidden',
  },
  cellImage: {
    width:  THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
  },

  // ── Pager back button ──────────────────────────────────────────────────────
  backBtn: {
    position:         'absolute',
    left:             14,
    width:            36,
    height:           36,
    borderRadius:     18,
    backgroundColor:  'rgba(6,11,16,0.55)',
    alignItems:       'center',
    justifyContent:   'center',
  },
});
