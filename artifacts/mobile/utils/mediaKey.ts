/**
 * mediaKey → image source bridge.
 *
 * Posts whose mediaKey starts with "seed:" map to bundled local assets.
 * For all other keys, use the presigned mediaUrl returned by the server.
 * Falls back to treating mediaKey as a bare URI if mediaUrl is absent.
 *
 * Usage:
 *   <Image source={resolveMediaKey(post.mediaKey, post.mediaUrl)} />
 */
import type { ImageSourcePropType } from 'react-native';

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
 * @param mediaUrl  Optional presigned GET URL from the server; used for non-seed keys.
 */
export function resolveMediaKey(
  mediaKey: string,
  mediaUrl?: string | null,
): ImageSourcePropType {
  if (mediaKey in SEED_IMAGES) return SEED_IMAGES[mediaKey]!;
  if (mediaUrl) return { uri: mediaUrl };
  // Fallback: treat mediaKey itself as a URI (shouldn't happen in production)
  return { uri: mediaKey };
}
