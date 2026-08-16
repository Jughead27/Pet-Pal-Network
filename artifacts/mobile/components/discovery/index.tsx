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
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useColumnWidth } from '@/hooks/useColumnWidth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { LinearGradient } from 'expo-linear-gradient';
import { GetFeedSort, useGetFeed, useGetFeedInfinite, useGetFeedSpecies, useGetSpotlight, getGetFeedQueryKey } from '@workspace/api-client-react';
import type { FeedResponse } from '@workspace/api-client-react';
import type { InfiniteData } from '@tanstack/react-query';
import type { FeedPost } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';
import FocalImage from '@/components/FocalImage';
import FeedPage, { type CommentSheetConfig } from '@/components/FeedPage';
import CommentSheet from '@/components/CommentSheet';
import SectionMasthead from '@/components/SectionMasthead';
import SpotlightBanner, { type SpotlightPetRef } from '@/components/SpotlightBanner';
import { Dog } from 'phosphor-react-native';
import { Modal } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getGetFeedSpeciesBreedsQueryOptions } from '@workspace/api-client-react';
import { NUM_COLS, CELL_GAP, CHIP_HEIGHT, SORT_CTRL_WIDTH, MASTHEAD_HEIGHT } from './constants';
import type { ViewMode, SpeciesChip } from './types';
import { styles } from './styles';

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

  // ── Breed filter — progressive disclosure, only when a species is selected ─
  const [activeBreed, setActiveBreed]       = useState<{ id: string; name: string } | null>(null);
  const [breedSheetOpen, setBreedSheetOpen] = useState(false);

  // ── Spotlight pet filter — independent of species/breed (browsing one pet) ─
  const [petFilter, setPetFilter] = useState<SpotlightPetRef | null>(null);

  // ── Sort (Fresh = default, matches API default; Popular = engagement score) ─
  // Fresh passes no sort param so the cache key matches the default feed used
  // by Home — no duplicate network round-trip. Popular uses a distinct key.
  const [sort, setSort] = useState<GetFeedSort>(GetFeedSort.fresh);
  const sortParam = sort === GetFeedSort.popular ? GetFeedSort.popular : undefined;
  const baseParams = sortParam ? { sort: sortParam } : {};

  // ── Feed data — unfiltered (for chips) + optionally filtered/sorted ────────
  // Chip derivation only needs to enumerate which species appear among recent
  // posts — a single max-size page (50) is a good proxy and avoids paginating
  // a list that is never displayed.
  const { data: allData, isLoading: allLoading, isError: allError } =
    useGetFeed({ ...baseParams, limit: 50 });

  // Grid/pager posts — cursor-paginated. The params live inside the queryKey,
  // so changing species/breed/sort/pet filter automatically starts from a
  // fresh first page (never appends onto stale results). The '/api/feed'
  // prefix stays FIRST in the key so existing invalidateQueries(
  // getGetFeedQueryKey()) calls elsewhere still prefix-match.
  const filteredParams = petFilter
    ? { ...baseParams, petId: petFilter.id }
    : activeSpeciesId
      ? {
          ...baseParams,
          speciesId: activeSpeciesId,
          ...(activeBreed ? { breedId: activeBreed.id } : {}),
        }
      : baseParams;

  const {
    data: filteredData, isLoading: filteredLoading, isError: filteredError,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useGetFeedInfinite<InfiniteData<FeedResponse>>(filteredParams, {
    query: {
      queryKey: [...getGetFeedQueryKey(filteredParams), 'infinite'],
      initialPageParam: undefined,
      getNextPageParam: (last: FeedResponse) => last.nextCursor ?? undefined,
    } as never,
  });

  const loadNextPage = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Breeds for the selected species — drives the breed picker sheet.
  // Exhaustive server-side DISTINCT over ALL eligible posts (same eligibility
  // rules as /feed), not a recent-posts sample. Not breed-filtered, so the
  // option list stays complete while a breed is active (switching still works).
  // queryKey keeps the '/api/feed' prefix FIRST (same trick as the infinite
  // feed keys) so existing invalidateQueries(getGetFeedQueryKey()) calls on
  // post create/archive/delete/edit refresh the options too — matching how
  // the old sample-based derivation stayed fresh.
  const { data: breedsData } = useQuery({
    ...getGetFeedSpeciesBreedsQueryOptions(activeSpeciesId ?? ''),
    queryKey: ['/api/feed', 'species', activeSpeciesId ?? '', 'breeds'],
    enabled: !!activeSpeciesId,
  });
  const breedOptions = breedsData?.breeds ?? [];

  // Row-3 visibility — same cached query SpotlightBanner uses (no extra fetch).
  // Divider + row only exist when there is content to separate.
  const { data: spotlightData } = useGetSpotlight();
  const breedChipVisible  = activeSpeciesId !== null && breedOptions.length > 0;
  const spotlightVisible  = petFilter !== null || (spotlightData?.pet ?? null) !== null;
  const subRowHasContent  = breedChipVisible || spotlightVisible;

  // Posts shown in the grid — always the filtered+sorted result (all pages).
  const posts: FeedPost[] = useMemo(
    () => filteredData?.pages.flatMap((p) => p.posts) ?? [],
    [filteredData],
  );

  // Chips from the exhaustive species-with-posts endpoint (same eligibility
  // rules as /feed) — a species with one eligible post always gets a chip,
  // no matter how old the post is. Alphabetical, as before.
  // '/api/feed' prefix FIRST so existing feed invalidations refresh the chips.
  const { data: feedSpeciesData } = useGetFeedSpecies(undefined, {
    query: { queryKey: ['/api/feed', 'species'] },
  });
  const chips: SpeciesChip[] = useMemo(
    () => [...(feedSpeciesData?.species ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [feedSpeciesData],
  );

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
  const [viewMode,    setViewMode]    = useState<ViewMode>('grid');
  // The tapped post's ID — not its array index. The index is resolved against
  // the pager's CURRENT data at render time, so a list reorder between tap
  // and mount (live react-query refetch) can never land on the wrong post.
  const [pagerStartId, setPagerStartId] = useState<string | null>(null);

  // ── Grid scroll preservation ───────────────────────────────────────────────
  const gridScrollY  = useRef(0);
  const gridListRef  = useRef<FlatList<FeedPost>>(null);
  const pagerListRef = useRef<FlatList<FeedPost>>(null);

  // ── Pager sheet state ──────────────────────────────────────────────────────
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

  // ── Open / close pager ────────────────────────────────────────────────────
  const openPost = useCallback((postId: string) => {
    setPagerStartId(postId);
    if (Platform.OS === 'web') {
      webPagerRunToken.current += 1; // invalidate any still-running loop
      webPagerCorrectionDone.current = false;
    }
    setViewMode('pager');
  }, []);

  const closePost = useCallback(() => {
    if (Platform.OS === 'web') {
      webPagerRunToken.current += 1; // stale loop exits + restores snap itself
      webPagerCorrectionDone.current = true;
    }
    setCommentConfig(null);
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

  // ── Web-only initial-scroll verification ──────────────────────────────────
  // On native, initialScrollIndex positions the FlatList before first paint —
  // correct and untouched. On WEB, react-native-web implements
  // initialScrollIndex as a one-shot imperative scrollToIndex fired from the
  // list's onLayout; the browser clamps scrollTop if the content isn't fully
  // sized at that instant, the library's internal flag burns with no retry,
  // and the pager lands on the wrong post. So on web we verify the actual
  // scrollTop against the expected offset after mount and correct + re-verify
  // each frame until it sticks (bounded, to avoid looping in a genuine edge
  // case). Refs (not state) so the loop always reads current values without
  // re-renders.
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
      setActiveSpeciesId(null);
      setActiveBreed(null);
      setPetFilter(null);
      setBreedSheetOpen(false);
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
      setActiveBreed(null);
      setPetFilter(null);
      setBreedSheetOpen(false);
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
  const isLoading = allLoading || ((!!activeSpeciesId || !!petFilter || !!activeBreed) && filteredLoading);
  const isError   = allError   || ((!!activeSpeciesId || !!petFilter || !!activeBreed) && filteredError);

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
              onPress={() => { setActiveSpeciesId(null); setActiveBreed(null); setPetFilter(null); gridScrollY.current = 0; }}
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
                onPress={() => { setActiveSpeciesId(chip.id); setActiveBreed(null); setPetFilter(null); gridScrollY.current = 0; }}
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

        {/* Right-edge fade — softens chips scrolling under the sort control.
            Sits AFTER the ScrollView but BEFORE sortControl in the z-stack, so
            chips fade out beneath it while the sort control's own opaque
            background remains the final hard boundary. pointerEvents:none so
            chip taps and scroll gestures pass straight through. */}
        {chips.length > 0 && (
          <LinearGradient
            colors={[`${colors.background}00`, colors.background]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.chipFade}
            pointerEvents="none"
          />
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

      {/* Row 3 — Breed chip (left) + Spotlight banner (right). Both slots are
          conditional; when neither renders content the row (and its divider)
          collapses to zero height. When breed is hidden, the Spotlight banner
          expands to fill the full row width, right-aligned. */}
      {subRowHasContent && (
        <View style={[styles.subFilterDivider, { backgroundColor: colors.border }]} />
      )}
      <View style={styles.subFilterRow}>
        {breedChipVisible && (
          <Pressable
            onPress={() => setBreedSheetOpen(true)}
            style={styles.chipPressable}
            accessibilityRole="button"
            accessibilityLabel={activeBreed ? `Breed: ${activeBreed.name}. Change breed` : 'Filter by breed'}
          >
            <Text
              style={[
                styles.chipText,
                activeBreed
                  ? [styles.chipTextActive,   { color: colors.foreground }]
                  : [styles.chipTextInactive, { color: colors.mutedForeground }],
              ]}
            >
              {activeBreed ? activeBreed.name : 'Breed ↓'}
            </Text>
          </Pressable>
        )}

        {/* Spotlight — passive indicator until tapped; never a default filter.
            When the breed chip is hidden the wrapper takes the full row and
            right-aligns the banner; otherwise it sizes to content on the right. */}
        <View style={breedChipVisible ? undefined : styles.spotlightFullRow}>
        <SpotlightBanner
          colors={colors}
          activePetFilter={petFilter}
          onEngage={(pet) => {
            // Browsing one pet — independent of category filters, so reset them.
            setActiveSpeciesId(null);
            setActiveBreed(null);
            setBreedSheetOpen(false);
            setPetFilter(pet);
            gridScrollY.current = 0;
          }}
          onClear={() => {
            setPetFilter(null);
            gridScrollY.current = 0;
          }}
        />
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
      <View style={containerStyle} onLayout={handleContainerLayout}>
        {effectivePageHeight > 0 && (
          <FlatList
            key="sniff-pager"
            ref={pagerListRef}
            data={posts}
            renderItem={renderPagerItem}
            keyExtractor={(item) => item.id}
            getItemLayout={getPagerItemLayout}
            initialScrollIndex={startIndex}
            onLayout={Platform.OS === 'web' ? runWebPagerCorrection : undefined}
            pagingEnabled
            snapToInterval={effectivePageHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            scrollEnabled={commentConfig === null}
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            windowSize={3}
            maxToRenderPerBatch={2}
            initialNumToRender={1}
            removeClippedSubviews
            // Pagination — prefetch ahead; no footer cell in the snap pager.
            onEndReached={loadNextPage}
            onEndReachedThreshold={2}
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

  // Empty: pet-filtered (Spotlight tap-through) result has no posts
  if (posts.length === 0 && petFilter !== null) {
    return (
      <View style={containerStyle}>
        {sniffHeader}
        <View style={[styles.fill, styles.centered]}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No posts from {petFilter.name} yet
          </Text>
          <Pressable
            onPress={() => setPetFilter(null)}
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
      onPress={() => openPost(item.id)}
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

  // ── Breed picker — single-select bottom sheet (typographic list) ──────────
  const breedSheet = (
    <Modal
      visible={breedSheetOpen}
      transparent
      animationType="slide"
      onRequestClose={() => setBreedSheetOpen(false)}
    >
      <Pressable
        style={styles.sheetBackdrop}
        onPress={() => setBreedSheetOpen(false)}
        accessibilityLabel="Close breed picker"
      >
        <Pressable
          style={[styles.sheetBody, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: insets.bottom + 20 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.sheetTitle, { color: colors.mutedForeground }]}>Breed</Text>
          <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <Pressable
              onPress={() => { setActiveBreed(null); setBreedSheetOpen(false); gridScrollY.current = 0; }}
              style={styles.sheetRow}
              accessibilityRole="button"
              accessibilityLabel="All breeds"
              accessibilityState={{ selected: activeBreed === null }}
            >
              <Text
                style={[
                  styles.sheetRowText,
                  activeBreed === null
                    ? [styles.chipTextActive,   { color: colors.foreground }]
                    : [styles.chipTextInactive, { color: colors.mutedForeground }],
                ]}
              >
                All breeds
              </Text>
            </Pressable>
            {breedOptions.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => { setActiveBreed({ id: b.id, name: b.name }); setBreedSheetOpen(false); gridScrollY.current = 0; }}
                style={styles.sheetRow}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${b.name}`}
                accessibilityState={{ selected: activeBreed?.id === b.id }}
              >
                <Text
                  style={[
                    styles.sheetRowText,
                    activeBreed?.id === b.id
                      ? [styles.chipTextActive,   { color: colors.foreground }]
                      : [styles.chipTextInactive, { color: colors.mutedForeground }],
                  ]}
                >
                  {b.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return (
    <View style={containerStyle} onLayout={handleContainerLayout}>
      {sniffHeader}
      {breedSheet}
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
        // Pagination — append next page as the user nears the grid's end.
        onEndReached={loadNextPage}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.pageFooter}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          ) : null
        }
      />
    </View>
  );
}
