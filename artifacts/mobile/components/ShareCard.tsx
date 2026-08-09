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
 * Layout — photo on top, branded bar below:
 *   ┌──────────────────────────────┐
 *   │                              │
 *   │    full-bleed cropped photo  │ PHOTO_H
 *   │                              │
 *   ├──────────────────────────────┤
 *   │ Pet Name    │    pshpsh.net  │ BAR_H
 *   │ caption     │  follow pets… │
 *   └──────────────────────────────┘
 *
 * Bar color is dynamic: bright photo → white bar + dark text;
 * dark photo → dark bar (#060B10) + light text.  Controlled via `barTheme`.
 *
 * Crop rect (cropX/Y/W/H, 0–1 fractions of natural image) is applied via
 * absolute positioning — identical to FocalImage's rect-driven cover branch.
 * Image.getSize() fetches natural dimensions; onImageLoaded is called via
 * useEffect after the crop-adjusted style is committed to the view tree.
 */

import React, { forwardRef, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

// ── Card dimensions ───────────────────────────────────────────────────────────
// Photo area shrinks slightly to make room for the branded bar below.
// Total CARD_H stays at 693 so NATIVE_CAPTURE_H (2079) remains unchanged.
export const CARD_W  = 390;
export const PHOTO_H = 566;   // photo section
export const BAR_H   = 127;   // branded bar section
export const CARD_H  = PHOTO_H + BAR_H;   // 693 — unchanged from previous

// ── Theming ───────────────────────────────────────────────────────────────────
interface BarColors {
  bg:      string;
  name:    string;
  caption: string;
  brand:   string;
  slogan:  string;
}

const DARK_THEME: BarColors = {
  bg:      '#060B10',
  name:    '#F0F4F8',
  caption: 'rgba(240,244,248,0.65)',
  brand:   '#CBD5E1',
  slogan:  'rgba(203,213,225,0.55)',
};

const LIGHT_THEME: BarColors = {
  bg:      '#FFFFFF',
  name:    '#0A0F14',
  caption: 'rgba(10,15,20,0.60)',
  brand:   '#1A202C',
  slogan:  'rgba(26,32,44,0.50)',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Resolved image source (from resolveMediaKey — already absolute on native). */
  source:        ImageSourcePropType;
  /** Crop rect — 0–1 fractions of the natural image. When present, the photo
   *  is positioned so this rect fills the card (same math as FocalImage). */
  cropX?:        number | null;
  cropY?:        number | null;
  cropW?:        number | null;
  cropH?:        number | null;
  /** Sampled fill color shown behind the photo when the crop rect extends past the image. */
  cropFillColor?: string | null;
  /** Tiny thumbnail data URI stretched over the fill area for a blur look. */
  cropFillThumb?: string | null;
  /** Pre-formatted pet name(s) for the bar ("Mochi", "Mochi & Luna", …). */
  displayName?:  string;
  /** Post caption for the bar. */
  caption?:      string;
  /**
   * Bar colour theme derived from the photo's average luminance.
   * 'light' → white bar, dark text  (bright photos)
   * 'dark'  → dark bar, light text  (dark photos)  ← default
   */
  barTheme?:     'light' | 'dark';
  /** Called when the photo (and crop style) are ready so the caller can trigger capture. */
  onImageLoaded?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ShareCard = forwardRef<View, Props>(({
  source,
  cropX, cropY, cropW, cropH,
  cropFillColor = null,
  cropFillThumb = null,
  displayName = '',
  caption = '',
  barTheme = 'dark',
  onImageLoaded,
}, ref) => {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  const hasCrop = typeof cropX === 'number' && typeof cropY === 'number' &&
    typeof cropW === 'number' && typeof cropH === 'number' &&
    cropW > 0 && cropH > 0;

  // ── Natural-size fetch (crop path only) ───────────────────────────────────
  useEffect(() => {
    if (!hasCrop) return;
    const uri = typeof source === 'object' && source !== null && 'uri' in (source as object)
      ? (source as { uri: string }).uri
      : null;
    if (!uri) return;
    Image.getSize(uri, (w, h) => setNat({ w, h }), () => { /* silent fallback */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, hasCrop]);

  // Notify caller AFTER crop-adjusted style is committed (useEffect fires post-paint).
  useEffect(() => {
    if (hasCrop && nat) onImageLoaded?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCrop, nat]);

  // ── Image style — rect-driven cover (same math as FocalImage) ─────────────
  const imageStyle = useMemo(() => {
    if (!hasCrop || !nat) return null;

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

  // ── Theme ─────────────────────────────────────────────────────────────────
  const theme = barTheme === 'light' ? LIGHT_THEME : DARK_THEME;

  return (
    <View ref={ref} style={styles.card} collapsable={false}>

      {/* ── Photo — full-bleed, no overlays ── */}
      {/* Sampled fill color shows wherever the crop rect extends past the image. */}
      <View style={[styles.photoClip, useCropStyle && cropFillColor ? { backgroundColor: cropFillColor } : null]}>
        {/* Blur-look fill: tiny thumbnail stretched to cover, under the photo.
            Solid color above remains the instant fallback. */}
        {useCropStyle && cropFillColor && cropFillThumb ? (
          <Image
            source={{ uri: cropFillThumb }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            blurRadius={2}
          />
        ) : null}
        <Image
          source={source}
          style={useCropStyle ? imageStyle! : styles.photoCover}
          resizeMode="cover"
          onLoad={hasCrop ? undefined : onImageLoaded}
        />
      </View>

      {/* ── Branded bar below photo ── */}
      <View style={[styles.bar, { backgroundColor: theme.bg }]}>

        {/* LEFT — dominant: pet name + caption */}
        <View style={styles.barLeft}>
          {displayName ? (
            <Text
              style={[styles.petName, { color: theme.name }]}
              numberOfLines={2}
            >
              {displayName}
            </Text>
          ) : null}
          {caption ? (
            <Text
              style={[styles.caption, { color: theme.caption }]}
              numberOfLines={2}
            >
              {caption}
            </Text>
          ) : null}
        </View>

        {/* RIGHT — secondary: brand + slogan */}
        <View style={styles.barRight}>
          <Text style={[styles.brandName, { color: theme.brand }]}>
            pshpsh.net
          </Text>
          <Text style={[styles.brandSlogan, { color: theme.slogan }]}>
            follow pets,{'\n'}not people.
          </Text>
        </View>

      </View>
    </View>
  );
});

ShareCard.displayName = 'ShareCard';

export default ShareCard;

// ── Styles ────────────────────────────────────────────────────────────────────

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

  // Clip container — prevents absolutely-positioned crop image from bleeding
  // out of the photo section into the bar.
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

  // ── Bar ────────────────────────────────────────────────────────────────────
  bar: {
    position:          'absolute',
    left:              0,
    top:               PHOTO_H,
    width:             CARD_W,
    height:            BAR_H,
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   14,
  },

  // Left column — flex: 1 so it takes available space; right column is fixed.
  barLeft: {
    flex:            1,
    alignItems:      'flex-start',
    justifyContent:  'center',
    paddingRight:    10,
  },

  barRight: {
    alignItems:     'flex-end',
    justifyContent: 'center',
    flexShrink:     0,
  },

  // ── Left column typography ─────────────────────────────────────────────────
  petName: {
    fontSize:   17,
    fontFamily: 'Inter_700Bold',
    lineHeight: 21,
  },
  caption: {
    fontSize:   11,
    fontFamily: 'Inter_400Regular',
    lineHeight: 15,
    marginTop:  4,
  },

  // ── Right column typography ────────────────────────────────────────────────
  brandName: {
    fontSize:      10,
    fontFamily:    'Inter_600SemiBold',
    letterSpacing: 0.4,
    textAlign:     'right',
  },
  brandSlogan: {
    fontSize:   8,
    fontFamily: 'Inter_400Regular',
    lineHeight: 11,
    marginTop:  4,
    textAlign:  'right',
  },
});
