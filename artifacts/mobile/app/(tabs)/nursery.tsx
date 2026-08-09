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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useColumnWidth } from '@/hooks/useColumnWidth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetFeed } from '@workspace/api-client-react';
import type { FeedPost } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';
import FocalImage from '@/components/FocalImage';
import { BabyCarriage } from 'phosphor-react-native';
import SectionMasthead from '@/components/SectionMasthead';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';

// ─── Layout constants ──────────────────────────────────────────────────────────

// THUMBNAIL_SIZE is computed dynamically inside the component from useColumnWidth()
// so it reflects the 430-px column width on web desktop, not the full window width.
const NUM_COLS   = 3;
const CELL_GAP   = 2;   // px between columns (and rows)
const CHIP_HEIGHT = 36; // height of the species filter chip row

// ─── NurseryScreen ─────────────────────────────────────────────────────────────

type ViewMode = 'grid' | 'pager';

interface SpeciesChip {
  id: string;
  name: string;
}

export default function NurseryScreen() {
  const colors        = useColors();
  const insets        = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const navigation    = useNavigation();
  // thumbnailSize uses the column width (capped at 430 on web) so that grid
  // cells are correct inside the phone-column wrapper on desktop.
  const columnWidth   = useColumnWidth();
  const thumbnailSize = (columnWidth - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS;

  // ── Species filter (null = "All") ─────────────────────────────────────────
  const [activeSpeciesId, setActiveSpeciesId] = useState<string | null>(null);

  // ── Nursery data ───────────────────────────────────────────────────────────
  // Two queries mirror the Sniff pattern:
  //   allData  — unfiltered nursery posts, used to derive species chips.
  //   filteredData — same params + optional speciesId, drives the grid.
  // When activeSpeciesId is null both queries share the same cache key.
  const { data: allData, isLoading, isError } = useGetFeed({ nursery: true });
  const {
    data: filteredData,
    isLoading: filteredLoading,
    isError: filteredError,
  } = useGetFeed(
    activeSpeciesId
      ? { nursery: true, speciesId: activeSpeciesId }
      : { nursery: true },
  );
  const posts = filteredData?.posts ?? [];

  // ── Species chips — derived from the unfiltered result ────────────────────
  const chips: SpeciesChip[] = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of allData?.posts ?? []) {
      if (p.pet.speciesId && !seen.has(p.pet.speciesId)) {
        seen.set(p.pet.speciesId, p.pet.species);
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allData?.posts]);

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
  const [viewMode,     setViewMode]     = useState<ViewMode>('grid');
  // The tapped post's ID — not its array index. The index is resolved against
  // the pager's CURRENT data at render time, so a list reorder between tap
  // and mount (live react-query refetch) can never land on the wrong post.
  const [pagerStartId, setPagerStartId] = useState<string | null>(null);

  // ── Grid scroll preservation ───────────────────────────────────────────────
  // onScroll writes the current offset into a ref (no re-render).
  // When returning from the pager we scroll back to that offset.
  const gridScrollY      = useRef(0);
  const gridListRef      = useRef<FlatList<FeedPost>>(null);
  const pagerListRef     = useRef<FlatList<FeedPost>>(null);

  // ── Pager lifted sheet state ───────────────────────────────────────────────
  const [commentConfig, setCommentConfig] = useState<CommentSheetConfig | null>(null);

  const openCommentSheet  = useCallback((cfg: CommentSheetConfig) => setCommentConfig(cfg), []);
  // The post whose comment thread is currently open — read at close time so
  // the pager can be restored to that EXACT post (the underlying pager can
  // drift on web while the sheet is open: the on-screen keyboard shrinks
  // window height, resizing every cell while scrollTop stays, so mandatory
  // scroll-snap re-commits to a different index).
  const commentSheetPostIdRef = useRef<string | null>(null);
  commentSheetPostIdRef.current = commentConfig?.postId ?? null;
  // closeCommentSheet is defined below runWebPagerCorrection (it depends on it).

  // ── Open pager at post ID ──────────────────────────────────────────────────
  const openPost = useCallback((postId: string) => {
    setPagerStartId(postId);
    if (Platform.OS === 'web') {
      webPagerRunToken.current += 1; // invalidate any still-running loop
      webPagerCorrectionDone.current = false;
    }
    setViewMode('pager');
  }, []);

  // ── Return to grid ─────────────────────────────────────────────────────────
  const closePost = useCallback(() => {
    if (Platform.OS === 'web') {
      webPagerRunToken.current += 1; // stale loop exits + restores snap itself
      webPagerCorrectionDone.current = true;
    }
    // Close any open sheets before returning to grid
    setCommentConfig(null);
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

  // ── Web-only initial-scroll verification ──────────────────────────────────
  // Direct port of the proven Sniff (discovery.tsx) fix. On native,
  // initialScrollIndex positions the FlatList before first paint — correct
  // and untouched. On WEB, react-native-web implements initialScrollIndex as
  // a one-shot imperative scrollToIndex fired from the list's onLayout; the
  // browser clamps scrollTop if the content isn't fully sized at that
  // instant, the library's internal flag burns with no retry, and the pager
  // lands on the wrong post. So on web we verify the actual scrollTop against
  // the expected offset after mount and correct + re-verify each frame until
  // it sticks (bounded, to avoid looping in a genuine edge case). Refs (not
  // state) so the loop always reads current values without re-renders.
  const webPagerCorrectionDone = useRef(true);
  // Monotonic run token: each pager open/close bumps it, so a loop from a
  // previous opening detects it is stale, restores its own snap node, and
  // exits WITHOUT touching the shared done flag of the newer run.
  const webPagerRunToken       = useRef(0);
  const pagerStartIdRef        = useRef<string | null>(null);
  pagerStartIdRef.current      = pagerStartId;
  const postsForPagerRef       = useRef<FeedPost[]>([]);
  const pageHeightForPagerRef  = useRef(0);

  const runWebPagerCorrection = useCallback(() => {
    if (Platform.OS !== 'web' || webPagerCorrectionDone.current) return;
    const runToken = webPagerRunToken.current; // this loop belongs to this opening
    // Bounds: total watch window (covers data arriving late), settle attempts
    // once the target IS resolvable, and consecutive stable frames required
    // before restoring scroll-snap (so the mandatory snap can't re-yank while
    // the virtualizer is still committing cells around the landing offset).
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
      webPagerCorrectionDone.current = true;
      restoreSnap();
    };
    const tick = () => {
      // Stale run (pager closed or reopened since this loop started): restore
      // OWN snap node and exit without touching the newer run's shared flag.
      if (webPagerRunToken.current !== runToken) {
        restoreSnap();
        return;
      }
      if (webPagerCorrectionDone.current) {
        restoreSnap();
        return;
      }
      const list = pagerListRef.current as unknown as {
        getScrollableNode?: () => HTMLElement | null;
      } | null;
      const node  = list?.getScrollableNode?.() ?? null;
      const pageH = pageHeightForPagerRef.current;
      if (node && pageH > 0) {
        // Suppress mandatory CSS scroll-snap during the landing window —
        // otherwise the browser re-snaps a successful correction back to the
        // nearest already-rendered cell edge (the confirmed yank-back bug).
        if (!snapNode) {
          snapNode = node;
          node.style.scrollSnapType = 'none';
        }
        // NEVER match while the target post is absent from the data — a
        // findIndex of -1 must keep the loop watching, not falsely match
        // index 0 (the confirmed false-match bug). Re-resolving each frame
        // also re-arms the loop when data arrives or reorders.
        const idx = postsForPagerRef.current.findIndex(
          (p) => p.id === pagerStartIdRef.current,
        );
        if (idx >= 0) {
          const expected = idx * pageH;
          if (Math.abs(node.scrollTop - expected) <= 1) {
            stableFrames += 1;
            if (stableFrames >= STABLE_FRAMES) {
              finish(); // held the correct offset long enough — snap restored
              return;
            }
          } else {
            stableFrames = 0;
            node.scrollTop = expected; // clamped if content still short
            settleFrames += 1;
            if (settleFrames >= MAX_SETTLE_FRAMES) {
              finish(); // bounded give-up once the target was resolvable
              return;
            }
          }
        }
      }
      totalFrames += 1;
      if (totalFrames < MAX_TOTAL_FRAMES) {
        requestAnimationFrame(tick);
      } else {
        finish(); // hard cap — e.g. target post genuinely gone from the feed
      }
    };
    requestAnimationFrame(tick);
  }, []);

  // ── Close comment sheet — restore pager to the commented post ─────────────
  // Explicit back out of a comment thread must land on the EXACT post whose
  // comments were being viewed. On web, re-arm the proven correction loop
  // targeting that post; on native the pager cannot drift under the modal,
  // so closing the sheet is all that happens.
  const closeCommentSheet = useCallback(() => {
    const targetId = commentSheetPostIdRef.current;
    setCommentConfig(null);
    if (Platform.OS === 'web' && targetId) {
      setPagerStartId(targetId);
      pagerStartIdRef.current = targetId; // sync — loop reads it this frame
      webPagerRunToken.current += 1;      // invalidate any stale loop
      webPagerCorrectionDone.current = false;
      runWebPagerCorrection();
    }
  }, [runWebPagerCorrection]);

  // ── Pager item renderer (hoisted + memoised) ──────────────────────────────
  // Must be a stable reference: if renderItem changes on every NurseryScreen
  // re-render, FlatList re-renders all visible FeedPage instances, which
  // re-computes heroImage in each one, which (via the old object-identity
  // check in FocalImage) triggered a source-reset on every render cycle —
  // cascading into "Too many re-renders" caught by the ErrorBoundary.
  const renderPagerItem = useCallback(
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

  const getPagerItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: effectivePageHeight,
      offset: effectivePageHeight * index,
      index,
    }),
    [effectivePageHeight],
  );

  // ── Android hardware back ──────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'pager') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      closePost();
      return true; // consumed — don't bubble to navigator
    });
    return () => handler.remove();
  }, [viewMode, closePost]);

  // ── Reset to grid on tab blur ──────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      closePost();
    });
    return unsubscribe;
  }, [navigation, closePost]);

  // ── Tab-press full reset ───────────────────────────────────────────────────
  // Tapping the Nursery tab (even when already focused) resets to the default
  // state: All species, grid mode, scrolled to top.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (navigation as any).addListener('tabPress', () => {
      setActiveSpeciesId(null);
      gridScrollY.current = 0;
      closePost();
      gridListRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, [navigation, closePost]);

  // ── Shared container style ─────────────────────────────────────────────────
  const containerStyle = Platform.OS === 'web'
    ? [styles.fill, { height: windowHeight, backgroundColor: colors.background }]
    : [styles.fill, { backgroundColor: colors.background }];

  // ── Top safe-area inset ────────────────────────────────────────────────────
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  // ── Shared layout handler ──────────────────────────────────────────────────
  const handleContainerLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) setPageHeight(h);
    },
    [],
  );

  // ── Nursery header — single opaque bar in normal flex flow above the grid ──
  // Masthead + optional chip row in one solid View.  No absolute positioning
  // needed; the FlatList is a flex sibling below this, so it scrolls cleanly
  // underneath without any z-index layering or header-bleed issues.
  const nurseryHeader = (
    <View style={[styles.headerBar, { backgroundColor: colors.background }]}>
      <SectionMasthead
        icon={<BabyCarriage size={18} color={colors.foreground} weight="regular" />}
        title="Nursery"
        style={{ paddingTop: topInset }}
      />
      {chips.length > 0 && (
        <View style={styles.chipBand}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipContent}
          >
            {/* "All" chip */}
            <Pressable
              onPress={() => { setActiveSpeciesId(null); gridScrollY.current = 0; }}
              style={styles.chipPressable}
              accessibilityRole="button"
              accessibilityLabel="Show all species"
              accessibilityState={{ selected: activeSpeciesId === null }}
            >
              <Text
                style={[
                  styles.chipText,
                  activeSpeciesId === null
                    ? [styles.chipTextActive,   { color: colors.foreground }]
                    : [styles.chipTextInactive, { color: colors.mutedForeground }],
                ]}
              >
                All
              </Text>
            </Pressable>

            {chips.map((chip) => (
              <Pressable
                key={chip.id}
                onPress={() => { setActiveSpeciesId(chip.id); gridScrollY.current = 0; }}
                style={styles.chipPressable}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${chip.name}`}
                accessibilityState={{ selected: activeSpeciesId === chip.id }}
              >
                <Text
                  style={[
                    styles.chipText,
                    activeSpeciesId === chip.id
                      ? [styles.chipTextActive,   { color: colors.foreground }]
                      : [styles.chipTextInactive, { color: colors.mutedForeground }],
                  ]}
                >
                  {chip.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  // ── Loading / error (shared across both layers) ────────────────────────────
  // Spinner only on the very first load (allData not yet available).
  // Subsequent filter changes are instant from cache; no flash of spinner.
  if (isLoading && !allData) {
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

  // ── Empty: no nursery posts at all ─────────────────────────────────────────
  if ((allData?.posts ?? []).length === 0) {
    return (
      <View style={containerStyle}>
        {nurseryHeader}
        <View style={[styles.fill, styles.centered]}>
          <View style={styles.emptyContent}>
            <BabyCarriage size={72} color={colors.mutedForeground} weight="regular" />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No nursery posts yet
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Flag baby moments when you post and they'll{'\n'}hatch right here.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Empty: species filter active but no matching nursery posts ─────────────
  if (posts.length === 0 && activeSpeciesId !== null) {
    const chipName = chips.find((c) => c.id === activeSpeciesId)?.name ?? 'this species';
    return (
      <View style={containerStyle}>
        {nurseryHeader}
        <View style={[styles.fill, styles.centered]}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No nursery posts for {chipName}
          </Text>
          <Pressable
            onPress={() => setActiveSpeciesId(null)}
            accessibilityRole="button"
            accessibilityLabel="Show all nursery posts"
          >
            <Text style={[styles.showAllLink, { color: colors.primary }]}>
              Show all
            </Text>
          </Pressable>
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

    // Resolve the tapped post ID against the pager's CURRENT data at render
    // time — immune to index shifts from refetches between tap and mount.
    // Falls back to 0 if the post vanished from the list (e.g. filtered out).
    const startIndex = Math.max(
      0,
      posts.findIndex((p) => p.id === pagerStartId),
    );

    // Keep the web correction loop's inputs current on every pager render.
    postsForPagerRef.current      = posts;
    pageHeightForPagerRef.current = effectivePageHeight;

    return (
      <View
        style={containerStyle}
        onLayout={handleContainerLayout}
      >
        {effectivePageHeight > 0 && (
          <FlatList
            key="pager"
            ref={pagerListRef}
            data={posts}
            renderItem={renderPagerItem}
            keyExtractor={(item) => item.id}
            getItemLayout={getPagerItemLayout}
            initialScrollIndex={startIndex}
            onLayout={Platform.OS === 'web' ? runWebPagerCorrection : undefined}
            // Paging
            pagingEnabled
            snapToInterval={effectivePageHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            // Disable scrolling while a sheet is open
            scrollEnabled={commentConfig === null}
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
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // LAYER 1: Thumbnail grid
  // Default view — 3 columns, square cells, FocalImage cover-fit.
  // ══════════════════════════════════════════════════════════════════════════════

  const renderGridItem = ({ item, index }: { item: FeedPost; index: number }) => (
    <TouchableOpacity
      onPress={() => openPost(item.id)}
      activeOpacity={0.85}
      style={[styles.cell, { width: thumbnailSize, height: thumbnailSize }]}
      accessibilityRole="button"
      accessibilityLabel={item.caption ?? `Nursery post ${index + 1}`}
    >
      <FocalImage
        source={resolveMediaKey(item.mediaKey, item.mediaUrl)}
        style={[styles.cellImage, { width: thumbnailSize, height: thumbnailSize }]}
        focusX={item.cropFocusX}
        focusY={item.cropFocusY}
      />
    </TouchableOpacity>
  );

  return (
    <View style={containerStyle} onLayout={handleContainerLayout}>
      {nurseryHeader}
      <FlatList
        key="grid"
        ref={gridListRef}
        data={posts}
        renderItem={renderGridItem}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLS}
        // 2 px gap between columns; rows are separated by marginBottom on each cell
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        style={styles.fill}
        // Track scroll offset for restoration when returning from pager
        onScroll={(e) => {
          gridScrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        // Start content below the tab bar on web; native handles this via insets
        contentContainerStyle={
          Platform.OS === 'web'
            ? { paddingBottom: 84 }
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

  // ── Header bar — solid opaque wrapper in normal flex flow above the grid ───
  headerBar: {
    // backgroundColor set inline from colors.background
  },

  // ── Species chip band ──────────────────────────────────────────────────────
  chipBand: {
    height: CHIP_HEIGHT,
  },
  chipScroll: {
    flex:      1,
    maxHeight: CHIP_HEIGHT,
  },
  chipContent: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    paddingHorizontal: 16,
    paddingBottom:     8,
    gap:               20,
    height:            undefined,
  },
  chipPressable: {
    paddingVertical: 4,
  },
  chipText: {
    fontSize:      15,
    letterSpacing: -0.2,
  },
  chipTextActive: {
    fontFamily: 'Inter_600SemiBold',
  },
  chipTextInactive: {
    fontFamily: 'Inter_400Regular',
  },

  // ── Filtered-empty "Show all" link ─────────────────────────────────────────
  showAllLink: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      15,
    letterSpacing: -0.1,
    marginTop:     8,
  },

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
    // width/height set inline from dynamic thumbnailSize — correct in the
    // 430-px web column and on any native screen width.
    marginBottom: CELL_GAP,
    overflow:     'hidden',
  },
  cellImage: {
    // width/height set inline from dynamic thumbnailSize.
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
