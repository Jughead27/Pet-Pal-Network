/**
 * Sniff Tab — discover posts filtered by species, sorted by Fresh or Popular.
 *
 * LAYER 1 (default): species chip row + sort toggle + 3-column thumbnail grid.
 *   • "All" chip clears the species filter; species chips filter via
 *     GET /feed?speciesId=<uuid>.
 *   • "Fresh | Popular" sort toggle (right-aligned in chip row band) drives
 *     GET /feed?sort=popular. Default: Fresh (newest-first).
 *   • Only species present in the unfiltered results are offered as chips.
 *   • FocalImage cover-fit honouring focal points.
 *   • Scroll position preserved across grid ↔ pager transitions.
 *
 * LAYER 2 (on tap): full-screen vertical pager at the tapped index.
 *   • Full rail: boop, treat, comment, share, pack paw, caption → detail.
 *   • Posts follow the active sort order.
 *   • Back button (top-left) returns to grid.
 *   • Android hardware back wired.
 *
 * Tab re-entry: navigation blur listener resets to grid + Fresh + All
 * (same pattern as Nursery — addListener('blur') instead of useFocusEffect).
 *
 * FlatLists are keyed "sniff-grid" / "sniff-pager" — never one instance
 * switching numColumns (invariant crash prevented).
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
import { GetFeedSort, useGetFeed } from '@workspace/api-client-react';
import type { FeedPost } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';
import FocalImage from '@/components/FocalImage';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';
import SectionMasthead from '@/components/SectionMasthead';
import { Dog } from 'phosphor-react-native';

// ─── Layout constants ──────────────────────────────────────────────────────────

// THUMBNAIL_SIZE is computed dynamically inside the component from useColumnWidth()
// so it reflects the 430-px column width on web desktop, not the full window width.
const NUM_COLS       = 3;
const CELL_GAP       = 2;
const CHIP_HEIGHT     = 36; // height of the chip/sort row band
// Approximate width of the "Fresh | Popular" control — chips get right-padding
// to prevent them scrolling underneath it.
const SORT_CTRL_WIDTH = 116;
// Height of the masthead row — drives the chip-row top offset and grid paddingTop.
// = lineHeight(25) + paddingBottom(4) from SectionMasthead's row style.
const MASTHEAD_HEIGHT = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'grid' | 'pager';

interface SpeciesChip {
  id: string;   // species UUID from catalogue
  name: string; // display label
}

// ─── SniffScreen ──────────────────────────────────────────────────────────────

export default function SniffScreen() {
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

  // ── Sort (Fresh = default, matches API default; Popular = engagement score) ─
  // Fresh passes no sort param so the cache key matches the default feed used
  // by Home — no duplicate network round-trip. Popular uses a distinct key.
  const [sort, setSort] = useState<GetFeedSort>(GetFeedSort.fresh);
  const sortParam = sort === GetFeedSort.popular ? GetFeedSort.popular : undefined;
  const baseParams = sortParam ? { sort: sortParam } : {};

  // ── Feed data — unfiltered (for chips) + optionally filtered/sorted ────────
  const { data: allData, isLoading: allLoading, isError: allError } =
    useGetFeed(baseParams);

  const { data: filteredData, isLoading: filteredLoading, isError: filteredError } =
    useGetFeed(
      activeSpeciesId
        ? { ...baseParams, speciesId: activeSpeciesId }
        : baseParams,
    );

  // Posts shown in the grid — always the filtered+sorted result.
  const posts: FeedPost[] = filteredData?.posts ?? [];

  // Chips derived from the UNFILTERED results (any sort — same post set).
  // Only species with a catalogue speciesId get a chip.
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

  // ── Layout measurement ─────────────────────────────────────────────────────
  const [pageHeight, setPageHeight] = useState(0);
  const effectivePageHeight =
    Platform.OS === 'web' ? windowHeight : pageHeight;

  // ── Reduced-motion ────────────────────────────────────────────────────────
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
  const gridScrollY      = useRef(0);
  const gridListRef      = useRef<FlatList<FeedPost>>(null);
  const pagerListRef     = useRef<FlatList<FeedPost>>(null);
  const pagerScrolledRef = useRef(false);

  // ── Pager sheet state ──────────────────────────────────────────────────────
  const [commentConfig, setCommentConfig] = useState<CommentSheetConfig | null>(null);
  const [shareOpen,     setShareOpen]     = useState(false);

  const openCommentSheet  = useCallback((cfg: CommentSheetConfig) => setCommentConfig(cfg), []);
  const closeCommentSheet = useCallback(() => setCommentConfig(null), []);
  const openShareSheet    = useCallback(() => setShareOpen(true),  []);
  const closeShareSheet   = useCallback(() => setShareOpen(false), []);

  // ── Open / close pager ────────────────────────────────────────────────────
  const openPost = useCallback((index: number) => {
    pagerScrolledRef.current = false;
    setPagerStartIndex(index);
    setViewMode('pager');
  }, []);

  const closePost = useCallback(() => {
    setCommentConfig(null);
    setShareOpen(false);
    setViewMode('grid');
    requestAnimationFrame(() => {
      if (gridScrollY.current > 0) {
        gridListRef.current?.scrollToOffset({
          offset:   gridScrollY.current,
          animated: false,
        });
      }
    });
  }, []);

  // ── Initial pager scroll (rAF deferred — avoids layout-before-paint crash) ─
  useEffect(() => {
    if (viewMode !== 'pager') return;
    if (pagerScrolledRef.current) return;
    pagerScrolledRef.current = true;
    if (pagerStartIndex === 0 || effectivePageHeight <= 0) return;
    requestAnimationFrame(() => {
      pagerListRef.current?.scrollToOffset({
        offset:   pagerStartIndex * effectivePageHeight,
        animated: false,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, pagerStartIndex]);

  // ── Pager item renderer (hoisted + memoised) ──────────────────────────────
  const renderPagerItem = useCallback(
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

  const getPagerItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: effectivePageHeight,
      offset: effectivePageHeight * index,
      index,
    }),
    [effectivePageHeight],
  );

  // ── Android hardware back ─────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'pager') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      closePost();
      return true;
    });
    return () => handler.remove();
  }, [viewMode, closePost]);

  // ── Reset to grid + Fresh + All on tab blur ───────────────────────────────
  // Uses navigation.addListener('blur') directly — useFocusEffect silently
  // no-ops on tab screens (optionalNavigation guard returns null).
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      closePost();
      setSort(GetFeedSort.fresh);
    });
    return unsubscribe;
  }, [navigation, closePost]);

  // ── Tab-press full reset ───────────────────────────────────────────────────
  // Tapping the Sniff tab (even when already focused) resets to the default
  // state: All species, Fresh sort, grid mode, scrolled to top.
  // gridScrollY.current = 0 before closePost() so closePost's rAF does not
  // restore the old scroll position.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (navigation as any).addListener('tabPress', () => {
      setActiveSpeciesId(null);
      setSort(GetFeedSort.fresh);
      gridScrollY.current = 0;
      closePost();
      // Scroll grid to top — no-op if grid is not mounted (pager mode),
      // in which case closePost() handles the transition back to grid at 0.
      gridListRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, [navigation, closePost]);

  // ── Shared container / layout ─────────────────────────────────────────────
  const containerStyle = Platform.OS === 'web'
    ? [styles.fill, { height: windowHeight, backgroundColor: colors.background }]
    : [styles.fill, { backgroundColor: colors.background }];

  const handleContainerLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) setPageHeight(h);
    },
    [],
  );

  // ── Top inset ─────────────────────────────────────────────────────────────
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  // ── Loading / error ───────────────────────────────────────────────────────
  const isLoading = allLoading || (!!activeSpeciesId && filteredLoading);
  const isError   = allError   || (!!activeSpeciesId && filteredError);

  // ── Chip-row height (always reserves CHIP_HEIGHT for the sort toggle) ──────
  // Previously conditional on chips.length > 0 — now always topInset + CHIP_HEIGHT
  // so the sort control has space even when no species chips are present.
  const chipRowHeight = topInset + MASTHEAD_HEIGHT + CHIP_HEIGHT;

  // ── Sniff header — single opaque bar in normal document flow ─────────────
  // All three header elements (masthead, chip row, sort toggle) live inside one
  // solid View so there are no background gaps and no z-index fights with the
  // FlatList.  The grid scrolls naturally underneath because this View is a
  // flex sibling ABOVE the FlatList, not an absolute overlay.
  const sniffHeader = (
    <View style={[styles.headerBar, { backgroundColor: colors.background }]}>
      {/* Masthead row */}
      <SectionMasthead
        icon={<Dog size={20} color={colors.foreground} weight="regular" />}
        title="Sniff"
        style={{ paddingTop: topInset }}
      />

      {/* Chip + sort band — fixed height, sort control floats right */}
      <View style={styles.chipSortBand}>
        {chips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={[styles.chipContent, { paddingRight: SORT_CTRL_WIDTH }]}
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
        ) : (
          // No chips yet — placeholder keeps the band height consistent
          <View style={styles.chipScrollPlaceholder} />
        )}

        {/* Sort toggle — absolutely positioned within the band, right-aligned */}
        <View
          style={[styles.sortControl, { backgroundColor: colors.background }]}
          accessibilityRole="toolbar"
          accessibilityLabel="Sort order"
        >
          <Pressable
            onPress={() => { setSort(GetFeedSort.fresh); gridScrollY.current = 0; }}
            style={styles.sortPressable}
            accessibilityRole="button"
            accessibilityLabel="Sort by Fresh"
            accessibilityState={{ selected: sort === GetFeedSort.fresh }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text
              style={[
                styles.sortText,
                sort === GetFeedSort.fresh
                  ? [styles.chipTextActive,   { color: colors.foreground }]
                  : [styles.chipTextInactive, { color: colors.mutedForeground }],
              ]}
            >
              Fresh
            </Text>
          </Pressable>

          <Text style={[styles.sortSep, { color: colors.mutedForeground }]}>|</Text>

          <Pressable
            onPress={() => { setSort(GetFeedSort.popular); gridScrollY.current = 0; }}
            style={styles.sortPressable}
            accessibilityRole="button"
            accessibilityLabel="Sort by Popular"
            accessibilityState={{ selected: sort === GetFeedSort.popular }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text
              style={[
                styles.sortText,
                sort === GetFeedSort.popular
                  ? [styles.chipTextActive,   { color: colors.foreground }]
                  : [styles.chipTextInactive, { color: colors.mutedForeground }],
              ]}
            >
              Popular
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Early exits: loading / error
  // ══════════════════════════════════════════════════════════════════════════

  if (isLoading && !allData) {
    return (
      <View style={[containerStyle, styles.centered, { paddingTop: topInset }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[containerStyle, styles.centered, { paddingTop: topInset }]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          Unable to load posts.
        </Text>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 2: Full-screen pager
  // ══════════════════════════════════════════════════════════════════════════

  if (viewMode === 'pager') {
    const backBtnTop = Platform.OS === 'web' ? 67 + 8 : insets.top + 8;

    return (
      <View style={containerStyle} onLayout={handleContainerLayout}>
        {effectivePageHeight > 0 && (
          <FlatList
            key="sniff-pager"
            ref={pagerListRef}
            data={posts}
            renderItem={renderPagerItem}
            keyExtractor={(item) => item.id}
            getItemLayout={getPagerItemLayout}
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

        <CommentSheet
          visible={commentConfig !== null}
          onClose={closeCommentSheet}
          postId={commentConfig?.postId ?? null}
          onCommentPosted={commentConfig?.onCommentPosted}
        />
        <ShareSheet visible={shareOpen} onClose={closeShareSheet} />
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 1: Chip row + sort toggle + thumbnail grid
  // ══════════════════════════════════════════════════════════════════════════

  // Empty: no posts at all (unfiltered) — warm default
  if ((allData?.posts ?? []).length === 0) {
    return (
      <View style={containerStyle}>
        {sniffHeader}
        <View style={[styles.fill, styles.centered]}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Nothing here yet
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Posts will appear as pets join the app.
          </Text>
        </View>
      </View>
    );
  }

  // Empty: species-filtered result has no posts — offer "Show all"
  if (posts.length === 0 && activeSpeciesId !== null) {
    const chipName = chips.find((c) => c.id === activeSpeciesId)?.name ?? 'this species';
    return (
      <View style={containerStyle}>
        {sniffHeader}
        <View style={[styles.fill, styles.centered]}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No posts for {chipName}
          </Text>
          <Pressable
            onPress={() => setActiveSpeciesId(null)}
            accessibilityRole="button"
            accessibilityLabel="Show all posts"
          >
            <Text style={[styles.showAllLink, { color: colors.primary }]}>
              Show all
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Grid item ─────────────────────────────────────────────────────────────
  const renderGridItem = ({ item, index }: { item: FeedPost; index: number }) => (
    <TouchableOpacity
      onPress={() => openPost(index)}
      activeOpacity={0.85}
      style={[styles.cell, { width: thumbnailSize, height: thumbnailSize }]}
      accessibilityRole="button"
      accessibilityLabel={item.caption ?? `Post ${index + 1}`}
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
      {sniffHeader}
      <FlatList
        key="sniff-grid"
        ref={gridListRef}
        data={posts}
        renderItem={renderGridItem}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLS}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          gridScrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
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
  fill:     { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 14, textAlign: 'center' },

  // ── Header bar — solid opaque wrapper in normal flex flow above the grid ───
  // No position:absolute; the FlatList is a sibling below this, so grid content
  // can never paint through or above the header.
  headerBar: {
    // backgroundColor set inline from colors.background
  },

  // ── Chip + sort band ───────────────────────────────────────────────────────
  chipSortBand: {
    height: CHIP_HEIGHT,
    // Sort control is position:absolute within this container, so it needs
    // a defined height for the absolute child to stretch against.
  },
  chipScrollPlaceholder: {
    flex:   1,
    height: CHIP_HEIGHT,
  },

  // ── Chip row ───────────────────────────────────────────────────────────────
  chipScroll: {
    // Not absolutely positioned — flows inside chipSortBand
    flex:      1,
    maxHeight: CHIP_HEIGHT,
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 20,
    height: undefined,
  },
  chipPressable: {
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 15,
    letterSpacing: -0.2,
  },
  chipTextActive: {
    fontFamily: 'Inter_600SemiBold',
  },
  chipTextInactive: {
    fontFamily: 'Inter_400Regular',
  },

  // ── Sort toggle — right-aligned within chipSortBand ───────────────────────
  // position:absolute here is relative to chipSortBand (its nearest positioned
  // parent), NOT the full screen — so no topInset/MASTHEAD_HEIGHT offset needed.
  // alignItems:'flex-end' + paddingBottom:8 baseline-aligns with the chip row.
  sortControl: {
    position:      'absolute',
    right:         16,
    top:           0,
    bottom:        0,
    flexDirection: 'row',
    alignItems:    'flex-end',
    gap:           6,
    paddingLeft:   14, // scrim so scrolled chips don't bleed through
    paddingBottom: 8,
  },
  sortPressable: {
    paddingVertical: 4,
  },
  sortText: {
    fontSize:      15,
    letterSpacing: -0.2,
  },
  sortSep: {
    fontSize:        15,
    letterSpacing:  -0.2,
    paddingVertical: 4,
    opacity:         0.3,
  },

  // ── Grid ───────────────────────────────────────────────────────────────────
  columnWrapper: { gap: CELL_GAP },
  cell: {
    // width/height set inline from dynamic thumbnailSize — correct in the
    // 430-px web column and on any native screen width.
    marginBottom: CELL_GAP,
    overflow:     'hidden',
  },
  cellImage: {
    // width/height set inline from dynamic thumbnailSize.
  },

  // ── Empty states ───────────────────────────────────────────────────────────
  emptyTitle: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      17,
    letterSpacing: -0.2,
    textAlign:     'center',
  },
  emptyBody: {
    fontFamily:        'Inter_400Regular',
    fontSize:          14,
    lineHeight:        21,
    textAlign:         'center',
    paddingHorizontal: 40,
  },
  showAllLink: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      15,
    letterSpacing: -0.1,
  },

  // ── Pager back button ──────────────────────────────────────────────────────
  backBtn: {
    position:        'absolute',
    left:            14,
    width:           36,
    height:          36,
    borderRadius:    18,
    backgroundColor: 'rgba(6,11,16,0.55)',
    alignItems:      'center',
    justifyContent:  'center',
  },

});
