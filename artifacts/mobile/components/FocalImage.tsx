/**
 * FocalImage — cover-fit image with a poster-controlled focal point.
 *
 * Renders the image so that the point (focusX, focusY) in image-space
 * is centred in the container, clamped so no background is revealed.
 *
 * focusX = 0 → left edge visible   focusX = 1 → right edge visible
 * focusY = 0 → top edge visible    focusY = 1 → bottom edge visible
 * null → 0.5 (standard cover centre, identical to resizeMode="cover")
 *
 * No react-native-reanimated.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType, LayoutChangeEvent, ViewStyle } from 'react-native';

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
}

// ─── FocalImage ───────────────────────────────────────────────────────────────

export default function FocalImage({ source, style, focusX, focusY }: FocalImageProps) {
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [natural,   setNatural]   = useState({ w: 0, h: 0 });

  // Track which URI we last launched a getSize call for to avoid duplicates.
  const getSizeUri = useRef<string | null>(null);

  // ── Container measurement ─────────────────────────────────────────────────
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ w: width, h: height });
  }, []);

  // ── Dimension resolution ──────────────────────────────────────────────────
  // Primary: onLoad event (fast, zero extra network). The event shape varies:
  //   • RN native:  e.nativeEvent.source.{width,height}
  //   • RN Web:     e.nativeEvent.source.{width,height}  OR  e.source.{width,height}
  //   • Some builds: neither field is present
  // We read defensively and never destructure a possibly-undefined object.
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
          // Populate cache so the getSize fallback below can short-circuit.
          const uri = getUriFromSource(source);
          if (uri) sizeCache.set(uri, { w, h });
        }
        // If dimensions weren't in the event, the useEffect below will call
        // Image.getSize as a fallback.
      } catch {
        // Swallow — the getSize fallback will cover this case.
      }
    },
    [source],
  );

  // Fallback: Image.getSize — fires when the load event didn't supply dims.
  // Only called for URI-based sources (bundled require() assets have their
  // dimensions embedded in the asset registry and onLoad always works there).
  useEffect(() => {
    const uri = getUriFromSource(source);
    if (!uri) return; // bundled asset — onLoad handles it

    // Already have dimensions from onLoad or a previous getSize call.
    if (natural.w > 0 && natural.h > 0) return;

    // Check the shared cache first.
    const cached = sizeCache.get(uri);
    if (cached) {
      setNatural(cached);
      return;
    }

    // Avoid launching a duplicate call for the same URI.
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
  }, [source, natural.w, natural.h]);

  // ── Cover-fit position with focal point ───────────────────────────────────
  const imageStyle = useMemo(() => {
    const { w: cw, h: ch } = container;
    const { w: nw, h: nh } = natural;

    // Before we have real dimensions: absoluteFill + resizeMode="cover" fallback.
    if (!cw || !ch || !nw || !nh) return null;

    const fx = focusX ?? 0.5;
    const fy = focusY ?? 0.5;

    const scale = Math.max(cw / nw, ch / nh);
    const sw    = nw * scale;
    const sh    = nh * scale;

    // Clamp: left ∈ [-(sw-cw), 0], top ∈ [-(sh-ch), 0]
    const left = -Math.max(0, Math.min(fx * (sw - cw), sw - cw));
    const top  = -Math.max(0, Math.min(fy * (sh - ch), sh - ch));

    return { position: 'absolute' as const, width: sw, height: sh, left, top };
  }, [container, natural, focusX, focusY]);

  return (
    <View style={[style, styles.clip]} onLayout={handleLayout}>
      {imageStyle ? (
        <Image source={source} style={imageStyle} onLoad={handleLoad} />
      ) : (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={handleLoad}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
