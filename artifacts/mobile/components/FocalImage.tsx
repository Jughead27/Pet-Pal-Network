/**
 * FocalImage — cover-fit image with a poster-controlled focal point,
 * plus optional rect-based crop and contain mode.
 *
 * Modes:
 *   mode='cover' (default):
 *     - If cropX/Y/W/H are supplied: scale + position so that the crop rect
 *       fills the container (rect-driven cover).
 *     - Otherwise fall back to focusX/Y focal-point cover (legacy behavior).
 *   mode='contain':
 *     - Render the whole image scaled to fit, with a blurred copy as fill.
 *
 * focusX = 0 → left edge visible   focusX = 1 → right edge visible
 * focusY = 0 → top edge visible    focusY = 1 → bottom edge visible
 * null → 0.5 (standard cover centre, identical to resizeMode="cover")
 *
 * Error handling: one automatic retry on load failure (cache-busted URI);
 * if the retry also fails a muted paw-glyph placeholder is shown.
 *
 * No react-native-reanimated.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType, LayoutChangeEvent, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PawPlaceholder from './PawPlaceholder';

// ─── Fill edge softening ──────────────────────────────────────────────────────
// Where the blurred fill meets the frame boundary it previously ended in a
// hard cutoff that read as a rendering defect. This layer sits ABOVE the fill
// (solid color + blurred thumb) and BELOW the photo, so it is only visible on
// exposed fill — a subtle darkening fade at each frame edge that makes the
// fill read as a deliberate soft vignette. Purely visual; placement untouched.
export const FILL_EDGE_ALPHA = 0.28; // light touch — polish, not fog
export const FILL_EDGE_SPAN  = '12%'; // fade depth from each frame edge

export function FillEdgeSoftener() {
  const edge = `rgba(0,0,0,${FILL_EDGE_ALPHA})`;
  const mid  = 'rgba(0,0,0,0)';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[edge, mid]}
        style={[styles_softener.h, { top: 0 }]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
      />
      <LinearGradient
        colors={[mid, edge]}
        style={[styles_softener.h, { bottom: 0 }]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
      />
      <LinearGradient
        colors={[edge, mid]}
        style={[styles_softener.v, { left: 0 }]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      />
      <LinearGradient
        colors={[mid, edge]}
        style={[styles_softener.v, { right: 0 }]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      />
    </View>
  );
}

const styles_softener = StyleSheet.create({
  h: { position: 'absolute', left: 0, right: 0, height: FILL_EDGE_SPAN },
  v: { position: 'absolute', top: 0, bottom: 0, width: FILL_EDGE_SPAN },
});

// ─── Per-URI dimension cache ──────────────────────────────────────────────────
// Avoids redundant Image.getSize calls when the same URI appears in multiple
// FocalImage instances (e.g. same post shown in feed and pet profile).
const sizeCache = new Map<string, { w: number; h: number }>();

function getUriFromSource(source: ImageSourcePropType): string | null {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const s = source as { uri?: string };
    if (typeof s.uri === 'string') return s.uri;
  }
  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FocalImageProps {
  source: ImageSourcePropType;
  /** Container style — must supply a fixed width + height (or flex that resolves to one). */
  style: ViewStyle | ViewStyle[];
  focusX?: number | null;
  focusY?: number | null;
  /** Crop rect in 0–1 fractions of the original image. When provided and mode='cover', drives rect-based crop. */
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
  /** 'cover' (default) or 'contain'. */
  mode?: string | null;
  /**
   * Solid hex color rendered behind the photo (sampled from the photo at
   * compose time). Visible wherever the crop rect extends past the image —
   * i.e. the poster zoomed out below cover. null = photo covers its rect.
   */
  cropFillColor?: string | null;
  /**
   * Tiny (~24px) thumbnail data URI stretched over the fill area under the
   * photo — the upscale interpolation reads as a soft blur. Rendered above
   * the solid cropFillColor (which stays as the instant fallback) and below
   * the photo. null = solid-color fill only.
   */
  cropFillThumb?: string | null;
  /**
   * Contain mode only. When set, positions the photo so its bottom edge is
   * this many px above the container's bottom edge — placing it just above
   * a name/caption overlay. Omit to vertically centre the photo.
   */
  containAlignBottom?: number;
  /**
   * Known natural pixel size of the photo. When supplied, skips onLoad /
   * Image.getSize resolution — required for local blob:/data: URIs (compose
   * preview) where getSize is unreliable on web and the fallback would render
   * plain centered cover, ignoring the crop rect. Remote posts omit these.
   */
  naturalWidth?: number | null;
  naturalHeight?: number | null;
}

// ─── FocalImage ───────────────────────────────────────────────────────────────

export default function FocalImage({ source, style, focusX, focusY, cropX, cropY, cropW, cropH, mode, cropFillColor, cropFillThumb, containAlignBottom, naturalWidth, naturalHeight }: FocalImageProps) {
  const hasKnownNatural =
    typeof naturalWidth === 'number' && naturalWidth > 0 &&
    typeof naturalHeight === 'number' && naturalHeight > 0;
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [naturalState, setNatural] = useState({ w: 0, h: 0 });
  // Caller-supplied size wins — resolved size is only a fallback.
  const natural = hasKnownNatural
    ? { w: naturalWidth as number, h: naturalHeight as number }
    : naturalState;
  const [retries,   setRetries]   = useState(0);

  // Track which URI we last launched a getSize call for to avoid duplicates.
  const getSizeUri = useRef<string | null>(null);

  // ── Stable key derived from source for equality checks. ──────────────────
  // resolveMediaKey() returns a new {uri} object on every call even when the
  // URI hasn't changed, so comparing by object identity (source) would fire
  // the reset on every parent re-render. Using the URI string (or the asset
  // number cast to string) means the effect only fires when the content truly
  // changes — i.e. a new post is shown in the same FocalImage slot.
  const sourceKey =
    typeof source === 'number'
      ? String(source)
      : ((source as { uri?: string }).uri ?? '');

  // ── Reset all state when the source genuinely changes (new post). ─────────
  useEffect(() => {
    setRetries(0);
    setNatural({ w: 0, h: 0 });
    getSizeUri.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // ── Retry source — appends ?r=N to bust cached error responses. ───────────
  const effectiveSource = useMemo<ImageSourcePropType>(() => {
    if (retries === 0) return source;
    const uri = getUriFromSource(source);
    if (!uri) return source; // bundled asset — no URI to modify
    const sep = uri.includes('?') ? '&' : '?';
    return { uri: `${uri}${sep}r=${retries}` };
  }, [source, retries]);

  // ── Container measurement ─────────────────────────────────────────────────
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ w: width, h: height });
  }, []);

  // ── Dimension resolution ──────────────────────────────────────────────────
  const handleLoad = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      try {
        const src =
          e?.nativeEvent?.source ??
          e?.source ??
          null;

        const w = src?.width;
        const h = src?.height;

        if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) {
          setNatural({ w, h });
          const uri = getUriFromSource(effectiveSource);
          if (uri) sizeCache.set(uri, { w, h });
        }
      } catch {
        // Swallow — the getSize fallback will cover this case.
      }
    },
    [effectiveSource],
  );

  const handleError = useCallback(() => {
    setRetries((r) => r + 1);
  }, []);

  // Fallback: Image.getSize — fires when the load event didn't supply dims.
  useEffect(() => {
    if (hasKnownNatural) return; // size supplied by caller — nothing to resolve
    const uri = getUriFromSource(effectiveSource);
    if (!uri) return;

    if (natural.w > 0 && natural.h > 0) return;

    const cached = sizeCache.get(uri);
    if (cached) {
      setNatural(cached);
      return;
    }

    if (getSizeUri.current === uri) return;
    getSizeUri.current = uri;

    Image.getSize(
      uri,
      (w, h) => {
        if (w > 0 && h > 0) {
          sizeCache.set(uri, { w, h });
          setNatural({ w, h });
        }
      },
      () => {
        // getSize failed — remain on centered cover-fit fallback; no crash.
      },
    );
  }, [effectiveSource, natural.w, natural.h, hasKnownNatural]);

  // ── Contain mode: whole image + blurred background fill ──────────────────
  const isContain = mode === 'contain';

  // ── Cover-fit position ────────────────────────────────────────────────────
  const imageStyle = useMemo(() => {
    const { w: cw, h: ch } = container;
    const { w: nw, h: nh } = natural;

    if (!cw || !ch || !nw || !nh) return null;

    if (isContain) {
      // Contain: scale to fit, horizontally centred.
      // Vertically: when containAlignBottom is set, position the photo so its
      // bottom edge sits containAlignBottom px above the container's bottom
      // (just above a name/caption overlay). Otherwise centre vertically.
      const scale = Math.min(cw / nw, ch / nh);
      const sw    = nw * scale;
      const sh    = nh * scale;
      const left  = (cw - sw) / 2;
      const top   = containAlignBottom != null
        ? Math.max(0, ch - containAlignBottom - sh)
        : (ch - sh) / 2;
      return { position: 'absolute' as const, width: sw, height: sh, left, top };
    }

    // Rect-driven cover: scale so the crop rect fills the container (full-bleed).
    const hasCropRect =
      typeof cropX === 'number' && typeof cropY === 'number' &&
      typeof cropW === 'number' && typeof cropH === 'number' &&
      cropW > 0 && cropH > 0;

    if (hasCropRect) {
      // Rect-driven cover: scale so the crop rect fills the container.
      const cropPxW = (cropW as number) * nw;
      const cropPxH = (cropH as number) * nh;
      const scale   = Math.max(cw / cropPxW, ch / cropPxH);
      const sw      = nw * scale;
      const sh      = nh * scale;

      // Position the full scaled image so the crop rect's top-left aligns with
      // the container top-left, then center the visible portion.
      const cropDisplayW = cropPxW * scale;
      const cropDisplayH = cropPxH * scale;
      const panLeft  = -(cropX as number) * sw;
      const panTop   = -(cropY as number) * sh;
      const centerX  = (cw - cropDisplayW) / 2;
      const centerY  = (ch - cropDisplayH) / 2;

      return {
        position: 'absolute' as const,
        width:  sw,
        height: sh,
        left:   panLeft + centerX,
        top:    panTop  + centerY,
      };
    }

    // Legacy focal-point cover.
    const fx = focusX ?? 0.5;
    const fy = focusY ?? 0.5;

    const scale = Math.max(cw / nw, ch / nh);
    const sw    = nw * scale;
    const sh    = nh * scale;

    // Clamp: left ∈ [-(sw-cw), 0], top ∈ [-(sh-ch), 0]
    const left = -Math.max(0, Math.min(fx * (sw - cw), sw - cw));
    const top  = -Math.max(0, Math.min(fy * (sh - ch), sh - ch));

    return { position: 'absolute' as const, width: sw, height: sh, left, top };
  }, [container, natural, focusX, focusY, cropX, cropY, cropW, cropH, isContain, containAlignBottom]);

  // After initial failure + one retry, show the placeholder.
  if (retries > 1) {
    return <PawPlaceholder style={style as ViewStyle} />;
  }

  if (isContain) {
    return (
      <View style={[style, styles.clip]} onLayout={handleLayout}>
        {/* Blurred background fill — covers letterbox bars in both contain and crop-contain */}
        <Image
          source={effectiveSource}
          style={[StyleSheet.absoluteFill, styles.blurBg]}
          resizeMode="cover"
          blurRadius={24}
          onError={handleError}
        />
        {/* Foreground image: whole photo, contain-fit */}
        {imageStyle ? (
          <Image
            source={effectiveSource}
            style={imageStyle}
            onLoad={handleLoad}
            onError={handleError}
          />
        ) : (
          <Image
            source={effectiveSource}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
      </View>
    );
  }

  return (
    <View style={[style, styles.clip]} onLayout={handleLayout}>
      {/* Sampled fill color — shows through wherever the crop rect extends
          past the image (poster zoomed out below cover). */}
      {cropFillColor && imageStyle ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: cropFillColor }]}
        />
      ) : null}
      {/* Blur-look fill: tiny thumbnail stretched to cover; sits above the
          solid color (instant fallback) and below the photo. */}
      {cropFillColor && cropFillThumb && imageStyle ? (
        <Image
          source={{ uri: cropFillThumb }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          blurRadius={2}
        />
      ) : null}
      {/* Soft edge treatment — under the photo, so only exposed fill fades. */}
      {cropFillColor && cropFillThumb && imageStyle ? <FillEdgeSoftener /> : null}
      {imageStyle ? (
        <Image
          source={effectiveSource}
          style={imageStyle}
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : (
        <Image
          source={effectiveSource}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip:   { overflow: 'hidden' },
  // opacity: 1 (default) — fully-opaque blurred fill; no dark bleed-through.
  blurBg: {},
});
