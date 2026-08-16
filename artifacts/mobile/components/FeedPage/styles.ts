import { StyleSheet } from 'react-native';
import { TEXT_SHADOW } from './constants';

// ─── Styles ──────────────────────────────────────────────────────────────────

export const styles = StyleSheet.create({
  page: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#060B10',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 300,
  },
  railScrim: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 96,
  },
  railContainer: {
    position: 'absolute',
    right: 14,
  },
  petInfo: {
    position: 'absolute',
    left: 18,
    right: 80,
    gap: 3,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  petNameBtn: {
    // flexShrink:1 lets a long name truncate without eating all row space,
    // so AddToPackLink always stays visible inline next to the name.
    flexShrink: 1,
    overflow: 'hidden',
    marginRight: 6,
  },
  petName: {
    color: '#F0F4F8',
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
    ...TEXT_SHADOW,
  },
  petBreed: {
    fontSize: 13,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
    ...TEXT_SHADOW,
  },
  taggedWith: {
    fontSize: 12,
    marginTop: 2,
    ...TEXT_SHADOW,
  },
  taggedPetName: {
    fontWeight: '600' as const,
    textDecorationLine: 'underline' as const,
  },
  petCaption: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    fontStyle: 'italic',
    ...TEXT_SHADOW,
  },
  // Out-of-treats toast — centered, wide, sits just above the rail.
  // Warm copy, no harsh error styling. pointerEvents:none so it never
  // intercepts taps on the content beneath.
  // zIndex/elevation ensure it renders above every other absolute layer
  // (Pressable tap-target, scrims, rail) so nothing can bury or clip it.
  outOfTreatsToast: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(16,20,28,0.88)',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    zIndex: 999,
    elevation: 999,
    overflow: 'visible',
  },
  outOfTreatsText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: 'rgba(240,244,248,0.95)',
    textAlign: 'center',
    letterSpacing: 0.1,
    ...TEXT_SHADOW,
  },
  // Expand glyph — inline hint that the text block is tappable.
  // fontStyle: 'normal' overrides the parent petCaption's italic so ↗ renders upright.
  // Opacity ~60 % makes it secondary to the caption without disappearing.
  captionExpand: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'normal' as const,
    color: 'rgba(240,244,248,0.60)',
    ...TEXT_SHADOW,
  },
  // Share-card generation overlay — brief translucent dimmer while the card
  // is being composited and handed to the OS share sheet.
  // pointerEvents:none lets through any taps underneath.
  sharingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex:          1000,
    elevation:       1000,
  },
});
