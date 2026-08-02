/**
 * ShareCard — off-screen card composited for native share capture.
 *
 * Rendered ONLY on iOS/Android (Platform.OS !== 'web').  On web the card is
 * drawn directly onto a Canvas element instead.
 *
 * The card is positioned far off-screen via `left: -9999` so it is in the
 * component tree (and therefore capturable by react-native-view-shot) but
 * invisible to the user.  It must be given explicit pixel dimensions so that
 * the viewshot capture has a real size to work with.
 *
 * Footer hierarchy (slogan-led, brand as signature):
 *   ┌──────────────────────────────┐
 *   │                              │
 *   │    full-bleed photo          │ PHOTO_H
 *   │   (cover / centered)         │
 *   │                              │
 *   ├──────────────────────────────┤
 *   │  follow pets, not people.    │ ← dominant hook (large, white, bold)
 *   │   [icon]  pshpsh             │ ← signature lockup (small, muted)
 *   └──────────────────────────────┘ FOOTER_H  (#060B10)
 */

import React, { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

// Fixed card dimensions (captured at 3× by react-native-view-shot → ~1170 × 2304 px)
export const CARD_W       = 390;
export const PHOTO_H      = 693;   // ≈ 390 × 16/9
export const FOOTER_H     = 75;
export const CARD_H       = PHOTO_H + FOOTER_H;

// App icon — used as the brand glyph in the signature lockup.
// Loaded via require() so Metro bundles it correctly on native.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO = require('../assets/icon.png') as ImageSourcePropType;

interface Props {
  /** Resolved image source (from resolveMediaKey — already absolute on native). */
  source: ImageSourcePropType;
  /** Called when the photo finishes loading so the caller can trigger capture. */
  onImageLoaded?: () => void;
}

const ShareCard = forwardRef<View, Props>(({ source, onImageLoaded }, ref) => (
  <View ref={ref} style={styles.card} collapsable={false}>
    <Image
      source={source}
      style={styles.photo}
      resizeMode="cover"
      onLoad={onImageLoaded}
    />
    <View style={styles.footer}>
      {/* Logo tile — standalone, pinned left, full opacity */}
      <Image source={LOGO} style={styles.logoTile} />
      {/* Text column — slogan + wordmark centered in the remaining right zone */}
      <View style={styles.textColumn}>
        <Text style={styles.slogan}>follow pets, not people.</Text>
        <Text style={styles.wordmark}>pshpsh</Text>
      </View>
    </View>
  </View>
));

ShareCard.displayName = 'ShareCard';

export default ShareCard;

const styles = StyleSheet.create({
  // Off-screen but fully rendered — required for captureRef to work.
  card: {
    position:  'absolute',
    left:      -9999,
    top:       0,
    width:     CARD_W,
    height:    CARD_H,
    overflow:  'hidden',
    backgroundColor: '#060B10',
  },
  photo: {
    width:  CARD_W,
    height: PHOTO_H,
  },
  footer: {
    width:           CARD_W,
    height:          FOOTER_H,
    backgroundColor: '#060B10',
    flexDirection:   'row',
    alignItems:      'center',
    paddingLeft:     8,
  },
  // Logo tile — standalone icon, ~75% of footer height, full opacity
  logoTile: {
    width:        Math.round(FOOTER_H * 0.75), // 56 px
    height:       Math.round(FOOTER_H * 0.75),
    borderRadius: 8,
  },
  // Text column — fills remaining space; slogan + wordmark stacked & centered
  textColumn: {
    flex:        1,
    alignItems:  'center',
    gap:         4,
  },
  // Dominant hook — large, white, full weight
  slogan: {
    color:         '#FFFFFF',
    fontSize:      14,
    fontFamily:    'Inter_600SemiBold',
    letterSpacing: 0.1,
  },
  // Wordmark credit line — subdued
  wordmark: {
    color:         'rgba(255,255,255,0.55)',
    fontSize:      10,
    fontFamily:    'Inter_500Medium',
    letterSpacing: 1.2,
  },
});
