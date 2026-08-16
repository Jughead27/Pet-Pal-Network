import { StyleSheet } from 'react-native';
import { CELL_GAP, CHIP_HEIGHT, SORT_CTRL_WIDTH } from './constants';

// ─── Styles ───────────────────────────────────────────────────────────────────

export const styles = StyleSheet.create({
  fill:     { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 14, textAlign: 'center' },
  pageFooter: { paddingVertical: 16, alignItems: 'center' },

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

  // ── Row 3 — breed (left) + spotlight (right); collapses when both empty ───
  // Only horizontal padding on the row itself so an empty row is zero-height;
  // vertical spacing comes from the children.
  subFilterRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    gap:               12,
  },
  // Faint separator above row 3 — rendered only when the row has content.
  subFilterDivider: {
    height:           StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom:     8,
    opacity:          0.6,
  },
  // Breed hidden → Spotlight wrapper spans the full row, banner right-aligned.
  spotlightFullRow: {
    flex:       1,
    alignItems: 'flex-end',
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

  // ── Right-edge chip fade — overlays the chip scroll, under sortControl ────
  // Width matches the SORT_CTRL_WIDTH end-padding already reserved in the
  // chip scroll content, so the fade zone and the reserved space coincide.
  chipFade: {
    position: 'absolute',
    right:    0,
    top:      0,
    bottom:   0,
    width:    SORT_CTRL_WIDTH,
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

  // ── Breed picker sheet ─────────────────────────────────────────────────────
  sheetBackdrop: {
    flex:            1,
    justifyContent:  'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetBody: {
    borderTopLeftRadius:  16,
    borderTopRightRadius: 16,
    borderWidth:          StyleSheet.hairlineWidth,
    paddingTop:           18,
    paddingHorizontal:    20,
    maxHeight:            '70%',
  },
  sheetTitle: {
    fontFamily:    'Inter_400Regular',
    fontSize:      12,
    letterSpacing: 0.6,
    textTransform: 'lowercase',
    marginBottom:  8,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetRow: {
    paddingVertical: 10,
  },
  sheetRowText: {
    fontSize:      15,
    letterSpacing: -0.2,
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
