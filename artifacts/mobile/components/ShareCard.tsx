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
 * "Headshot" layout — full-bleed portrait, no footer band:
 *   ┌──────────────────────────────┐
 *   │                              │
 *   │    full-bleed cropped photo  │ CARD_H (9:16, no footer)
 *   │                              │
 *   │   ┌──────────────────────┐   │
 *   │   │  Pet Name (bold)     │   │ ← center-to-lower-third overlay + scrim
 *   │   │  caption text        │   │
 *   │   └──────────────────────┘   │
 *   │ 🐱                           │ ← brand lockup bottom-left
 *   │ pshpsh                       │   (icon → wordmark → slogan, quiet mark)
 *   │ follow pets, not people.     │
 *   └──────────────────────────────┘
 *
 * Crop rect (cropX/Y/W/H, 0–1 fractions of natural image) is applied via
 * absolute positioning — identical to FocalImage's rect-driven cover branch.
 * Image.getSize() fetches natural dimensions; onImageLoaded is called via
 * useEffect after the crop-adjusted style is committed to the view tree.
 */

import React, { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

// Fixed card dimensions — full-bleed portrait, no footer band.
// Captured at 3× by react-native-view-shot → ~1170 × 2079 px.
export const CARD_W  = 390;
export const PHOTO_H = 693;   // ≈ 390 × 16/9
export const CARD_H  = PHOTO_H;   // full card is full photo

// App icon — used as the brand glyph in the signature lockup.
// Loaded via require() so Metro bundles it correctly on native.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO = require('../assets/icon.png') as ImageSourcePropType;

interface Props {
  /** Resolved image source (from resolveMediaKey — already absolute on native). */
  source:        ImageSourcePropType;
  /** Crop rect — 0–1 fractions of the natural image. When present, the photo
   *  is positioned so this rect fills the card (same math as FocalImage). */
  cropX?:        number | null;
  cropY?:        number | null;
  cropW?:        number | null;
  cropH?:        number | null;
  /** Pre-formatted pet name(s) for the center overlay ("Mochi", "Mochi & Luna", …). */
  displayName?:  string;
  /** Post caption for the center overlay. */
  caption?:      string;
  /** Called when the photo (and crop style) are ready so the caller can trigger capture. */
  onImageLoaded?: () => void;
}

const ShareCard = forwardRef<View, Props>(({
  source,
  cropX, cropY, cropW, cropH,
  displayName = '',
  caption = '',
  onImageLoaded,
}, ref) => {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  const hasCrop = typeof cropX === 'number' && typeof cropY === 'number' &&
    typeof cropW === 'number' && typeof cropH === 'number' &&
    cropW > 0 && cropH > 0;

  // ── Natural-size fetch (crop path only) ───────────────────────────────────
  // Image.getSize runs before the Image renders — avoids onLoad typing issues
  // and gives us dimensions before the first paint (no flash of wrong framing).
  useEffect(() => {
    if (!hasCrop) return;
    const uri = typeof source === 'object' && source !== null && 'uri' in (source as object)
      ? (source as { uri: string }).uri
      : null;
    if (!uri) return;
    Image.getSize(uri, (w, h) => setNat({ w, h }), () => { /* silent fallback */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, hasCrop]);

  // Notify caller AFTER the crop-adjusted style is committed to the view tree.
  // useEffect fires after paint, so captureRef will see the correct framing.
  useEffect(() => {
    if (hasCrop && nat) onImageLoaded?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCrop, nat]);

  // ── Image style — rect-driven cover (same math as FocalImage) ─────────────
  const imageStyle = useMemo(() => {
    if (!hasCrop || !nat) return null; // use resizeMode="cover" on the Image directly

    const { w: nw, h: nh } = nat;
    const cw = CARD_W, ch = PHOTO_H;
    const cropPxW  = (cropW as number) * nw;
    const cropPxH  = (cropH as number) * nh;
    const scale    = Math.max(cw / cropPxW, ch / cropPxH);
    const sw       = nw * scale;
    const sh       = nh * scale;
    const centerX  = (cw - cropPxW * scale) / 2;
    const centerY  = (ch - cropPxH * scale) / 2;
    return {
      position:  'absolute' as const,
      width:     sw,
      height:    sh,
      left:      -(cropX as number) * sw + centerX,
      top:       -(cropY as number) * sh + centerY,
    };
  }, [nat, hasCrop, cropX, cropY, cropW, cropH]);

  const useCropStyle = hasCrop && !!imageStyle;

  return (
    <View ref={ref} style={styles.card} collapsable={false}>

      {/* ── Photo ── */}
      <View style={styles.photoClip}>
        <Image
          source={source}
          // When crop style is ready, use it; otherwise fall back to cover.
          style={useCropStyle ? imageStyle! : styles.photoCover}
          resizeMode="cover"
          // For the no-crop path, notify parent directly from onLoad.
          onLoad={hasCrop ? undefined : onImageLoaded}
        />
      </View>

      {/* ── Center text overlay (pet name + caption) ── */}
      {displayName ? (
        <View style={styles.textOverlay}>
          <View style={styles.textScrim}>
            <Text style={styles.petName} numberOfLines={2}>{displayName}</Text>
            {caption ? (
              <Text style={styles.caption} numberOfLines={3}>{caption}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* ── Brand lockup — bottom-left corner ── */}
      <View style={styles.brand}>
        <Image source={LOGO} style={styles.brandLogo} />
        <Text style={styles.brandWordmark}>pshpsh</Text>
        <Text style={styles.brandSlogan}>follow pets, not people.</Text>
      </View>
    </View>
  );
});

ShareCard.displayName = 'ShareCard';

export default ShareCard;

const styles = StyleSheet.create({
  // Off-screen but fully rendered — required for captureRef to work.
  card: {
    position:        'absolute',
    left:            -9999,
    top:             0,
    width:           CARD_W,
    height:          CARD_H,
    overflow:        'hidden',
    backgroundColor: '#060B10',
  },
  // Clip container prevents the absolutely-positioned crop image from bleeding.
  photoClip: {
    position: 'absolute',
    left:     0,
    top:      0,
    width:    CARD_W,
    height:   PHOTO_H,
    overflow: 'hidden',
  },
  // Fallback cover style when no crop rect is present.
  photoCover: {
    width:  CARD_W,
    height: PHOTO_H,
  },
  // ── Center text overlay ────────────────────────────────────────────────────
  // Anchored to 50 % from the top so the text block falls in the
  // center-to-lower-third of the frame (center of a ~130 px block ≈ 60 %).
  textOverlay: {
    position:          'absolute',
    left:              0,
    right:             0,
    top:               Math.round(PHOTO_H * 0.50),
    alignItems:        'center',
    paddingHorizontal: 24,
  },
  textScrim: {
    backgroundColor:   'rgba(0,0,0,0.38)',
    borderRadius:      12,
    paddingHorizontal: 20,
    paddingVertical:   14,
    alignItems:        'center',
    maxWidth:          CARD_W - 48,
  },
  petName: {
    color:      '#FFFFFF',
    fontSize:   26,
    fontFamily: 'Inter_700Bold',
    textAlign:  'center',
    lineHeight: 32,
  },
  caption: {
    color:      'rgba(255,255,255,0.82)',
    fontSize:   14,
    fontFamily: 'Inter_400Regular',
    textAlign:  'center',
    lineHeight: 20,
    marginTop:  8,
  },
  // ── Brand lockup — bottom-left corner ─────────────────────────────────────
  brand: {
    position:   'absolute',
    left:       16,
    bottom:     20,
    alignItems: 'flex-start',
  },
  brandLogo: {
    width:        28,
    height:       28,
    borderRadius: 6,
    marginBottom: 5,
  },
  brandWordmark: {
    color:         'rgba(255,255,255,0.70)',
    fontSize:      10,
    fontFamily:    'Inter_600SemiBold',
    letterSpacing: 0.8,
  },
  brandSlogan: {
    color:         'rgba(255,255,255,0.45)',
    fontSize:      8,
    fontFamily:    'Inter_400Regular',
    letterSpacing: 0.2,
    marginTop:     3,
  },
});
