import { Platform, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

// ── Styles ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeStyles(c: ReturnType<typeof useColors>): Record<string, any> {
  return StyleSheet.create({
    fill:     { flex: 1 },
    centered: { alignItems: 'center', justifyContent: 'center' },
    scroll:   { flexGrow: 1, paddingHorizontal: 20 },

    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    heading: {
      fontFamily: 'Inter_700Bold',
      fontSize: 26,
      letterSpacing: -0.3,
    },

    emptyTitle: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 18,
      marginBottom: 8,
    },
    emptySub: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      textAlign: 'center',
      marginBottom: 24,
      paddingHorizontal: 32,
    },

    sourceCard: {
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 18,
      marginBottom: 16,
    },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 18,
    },
    sourceRowText: {
      flex: 1,
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
    },
    sourceDivider: {
      height: StyleSheet.hairlineWidth,
    },

    // Change Photo bottom sheet
    changePhotoOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    changePhotoBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    changePhotoSheet: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 36,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    changePhotoHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 16,
    },
    changePhotoCancel: {
      marginTop: 10,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      paddingVertical: 16,
      alignItems: 'center',
    },
    changePhotoCancelText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
    },

    imagePlaceholder: {
      // height omitted — applied inline via aspectRatio + maxHeight
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 16,
    },
    processingText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      marginTop: 8,
    },
    previewWrapper: {
      // aspectRatio + maxHeight + alignSelf applied inline so they can use the
      // runtime feedAspect value.  Only non-runtime chrome lives here.
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 16,
    },
    preview: {
      // Fill the aspectRatio-driven height of previewWrapper.
      flex: 1,
    },
    previewControls: {
      flexDirection: 'row',
      marginTop: 6,
      marginBottom: 8,
      borderRadius: 10,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
    },
    previewControlBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 9,
      gap: 6,
    },
    previewControlDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
    },
    previewControlText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
    },

    // "Posting as" row — shown instead of pet chips when the user has exactly one pet.
    postingAsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 4,
    },
    postingAsAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    postingAsAvatarFallback: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    postingAsName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
    },
    postHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      textAlign: 'center',
      marginTop: 6,
    },

    card: {
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 20,
      marginBottom: 16,
      gap: 0,
    },
    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      letterSpacing: 0.2,
      marginBottom: 8,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 13 : 10,
      fontFamily: 'Inter_400Regular',
      fontSize: 16, // ≥16 prevents iOS Safari auto-zoom on focus
    },
    captionInput: {
      minHeight: 80,
      textAlignVertical: 'top',
      paddingTop: 12,
    },

    petScroll: {
      flexGrow: 0,
    },

    // Collapsed "Tag another pet" accordion (matches profile-edit socials)
    tagToggle: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'space-between',
      marginTop:       20,
      marginBottom:    4,
      paddingVertical: 4,
    },
    tagToggleText: {
      fontFamily: 'Inter_400Regular',
      fontSize:   14,
    },
    tagToggleCaret: {
      fontFamily: 'Inter_400Regular',
      fontSize:   14,
    },

    searchResultChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginRight: 8,
      marginTop: 6,
    },
    searchResultName: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
    },
    searchResultOwner: {
      fontSize: 11,
      marginTop: 1,
    },

    taggedOthersRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 8,
      gap: 6,
    },
    taggedOtherChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    taggedOtherName: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
    },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 20,
      paddingTop: 16,
    },
    toggleInfo: { flex: 1, marginRight: 16 },
    toggleLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
    },
    toggleSub: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      marginTop: 2,
    },
    track: {
      width: 44,
      height: 26,
      borderRadius: 13,
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    thumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#FFFFFF',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.25,
      shadowRadius: 2,
      elevation: 2,
    },
    thumbOn: {
      alignSelf: 'flex-end',
    },

    error: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 12,
    },

    stickyFooter: {
      paddingHorizontal: 20,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  });
}
