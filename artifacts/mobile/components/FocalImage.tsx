/**
 * FocalImage — cover-fit image with a poster-controlled focal point.
 *
 * Renders the image so that the point (focusX, focusY) in image-space
 * is centered in the container, clamped so no background is revealed.
 *
 * focusX = 0 → left edge visible   focusX = 1 → right edge visible
 * focusY = 0 → top edge visible    focusY = 1 → bottom edge visible
 * null → 0.5 (standard cover center, identical to resizeMode="cover")
 *
 * No react-native-reanimated.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType, LayoutChangeEvent, ViewStyle } from 'react-native';

interface FocalImageProps {
  source: ImageSourcePropType;
  /** Container style — must supply a fixed width + height (or flex that resolves to one). */
  style: ViewStyle | ViewStyle[];
  focusX?: number | null;
  focusY?: number | null;
}

export default function FocalImage({ source, style, focusX, focusY }: FocalImageProps) {
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [natural,   setNatural]   = useState({ w: 0, h: 0 });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ w: width, h: height });
  }, []);

  // onLoad provides the decoded pixel dimensions of the source.
  const handleLoad = useCallback(
    (e: { nativeEvent: { source: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.source;
      if (width > 0 && height > 0) setNatural({ w: width, h: height });
    },
    [],
  );

  const imageStyle = useMemo(() => {
    const { w: cw, h: ch } = container;
    const { w: nw, h: nh } = natural;

    // Before we have real dimensions: use absoluteFill + resizeMode="cover" (centered).
    if (!cw || !ch || !nw || !nh) return null;

    const fx = focusX ?? 0.5;
    const fy = focusY ?? 0.5;

    const scale = Math.max(cw / nw, ch / nh);
    const sw    = nw * scale;
    const sh    = nh * scale;

    // Image top-left offset so focal point is centred, clamped to avoid overdraw.
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
