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
 * Layout:
 *   ┌──────────────────────────┐
 *   │                          │
 *   │    full-bleed photo      │ PHOTO_H
 *   │   (cover / centered)     │
 *   │                          │
 *   ├──────────────────────────┤
 *   │   pshpsh    slogan       │ FOOTER_H  (#060B10)
 *   └──────────────────────────┘
 */

import React, { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

// Fixed card dimensions (captured at 3× by react-native-view-shot → ~1170 × 2304 px)
export const CARD_W       = 390;
export const PHOTO_H      = 693;   // ≈ 390 × 16/9
export const FOOTER_H     = 75;
export const CARD_H       = PHOTO_H + FOOTER_H;

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
      <Text style={styles.wordmark}>pshpsh</Text>
      <Text style={styles.slogan}>follow pets, not people.</Text>
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
    alignItems:      'center',
    justifyContent:  'center',
    gap:             5,
  },
  wordmark: {
    color:       '#FFFFFF',
    fontSize:    15,
    fontFamily:  'Inter_600SemiBold',
    letterSpacing: 1.5,
  },
  slogan: {
    color:      'rgba(255,255,255,0.50)',
    fontSize:   11,
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.2,
  },
});
