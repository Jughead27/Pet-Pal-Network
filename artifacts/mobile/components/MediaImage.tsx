/**
 * MediaImage — drop-in Image replacement for post-media surfaces.
 *
 * Adds two behaviours on top of plain <Image>:
 *   1. One automatic retry on failure (appends ?r=N to the URI to bypass
 *      any cached error response on the device or CDN).
 *   2. Paw-glyph placeholder if the retry also fails — never a void black.
 *
 * Use this instead of <Image> for all post thumbnails, hero images,
 * modal photos, and full-photo detail views.  Do NOT use for bundled seed
 * assets (those are require() numbers and never fail in practice).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Image } from 'react-native';
import type { ImageSourcePropType, ImageStyle, StyleProp } from 'react-native';
import PawPlaceholder from './PawPlaceholder';

interface Props {
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
}

export default function MediaImage({ source, style, resizeMode = 'cover' }: Props) {
  const [retries, setRetries] = useState(0);

  const handleError = useCallback(() => {
    setRetries((r) => r + 1);
  }, []);

  // On the first failure bump to retry source (cache-bust by appending ?r=1).
  // On the second failure retries > 1 and we fall through to the placeholder.
  const effectiveSource = useMemo<ImageSourcePropType>(() => {
    if (retries === 0) return source;
    if (typeof source === 'number') return source; // bundled require() — cannot retry via URI
    const s = source as { uri?: string };
    if (!s.uri) return source;
    const sep = s.uri.includes('?') ? '&' : '?';
    return { uri: `${s.uri}${sep}r=${retries}` };
  }, [source, retries]);

  if (retries > 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <PawPlaceholder style={style as any} />;
  }

  return (
    <Image
      source={effectiveSource}
      style={style}
      resizeMode={resizeMode}
      onError={handleError}
    />
  );
}
