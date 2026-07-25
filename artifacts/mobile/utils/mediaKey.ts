/**
 * mediaKey → image source bridge.
 *
 * Posts whose mediaKey starts with "seed:" map to bundled local assets.
 * For all other keys, the server now returns a stable /api/media/<key>?…
 * URL (HMAC-signed, 48 h expiry) instead of a perishable presigned R2 URL.
 *
 * On native, React Native's Image component can't resolve relative paths,
 * so we prepend the configured API base URL.  On web, the browser resolves
 * /api/… against the page origin automatically.
 *
 * seed: keys bypass this entirely — they resolve to bundled assets.
 *
 * Usage:
 *   <Image source={resolveMediaKey(post.mediaKey, post.mediaUrl)} />
 */
import type { ImageSourcePropType } from 'react-native';
import { Platform } from 'react-native';
import { getBaseUrl } from '@workspace/api-client-react';

// Bundled seed assets
const SEED_IMAGES: Record<string, ImageSourcePropType> = {
  'seed:hero':  require('@/assets/images/ripley-hero.jpg') as ImageSourcePropType,
  'seed:post1': require('@/assets/images/ripley-post1.jpg') as ImageSourcePropType,
  'seed:post2': require('@/assets/images/ripley-post2.jpg') as ImageSourcePropType,
};

/**
 * Returns a React Native `Image` source for the given media key.
 *
 * @param mediaKey  The post's mediaKey (e.g. "seed:hero" or "posts/<uuid>.jpg")
 * @param mediaUrl  Stable /api/media/… URL from the server; used for non-seed keys.
 */
export function resolveMediaKey(
  mediaKey: string,
  mediaUrl?: string | null,
): ImageSourcePropType {
  if (mediaKey in SEED_IMAGES) return SEED_IMAGES[mediaKey]!;

  if (mediaUrl) {
    let uri = mediaUrl;
    // Native Image requires absolute URLs.  The server returns relative
    // /api/media/… paths; prepend the configured API base so native can load.
    // Web resolves relative paths against the page origin automatically.
    if (Platform.OS !== 'web' && uri.startsWith('/')) {
      const base = getBaseUrl() ?? '';
      uri = base + uri;
    }
    return { uri };
  }

  // Fallback: treat mediaKey itself as a URI (shouldn't happen in production)
  return { uri: mediaKey };
}
