/**
 * mediaKey → image source bridge.
 *
 * Posts whose mediaKey starts with "seed:" map to the corresponding bundled
 * local asset.  All other keys are treated as remote URLs (returned as a
 * { uri } object) — remote upload support comes in a later phase.
 *
 * Usage:
 *   <Image source={resolveMediaKey(post.mediaKey)} />
 */
import type { ImageSourcePropType } from 'react-native';

// Bundled seed assets — cast individually so the union collapses to
// ImageSourcePropType rather than an opaque `ReturnType<typeof require>`.
const SEED_IMAGES: Record<string, ImageSourcePropType> = {
  'seed:hero':  require('@/assets/images/ripley-hero.jpg') as ImageSourcePropType,
  'seed:post1': require('@/assets/images/ripley-post1.jpg') as ImageSourcePropType,
  'seed:post2': require('@/assets/images/ripley-post2.jpg') as ImageSourcePropType,
};

/** Returns a React Native `Image` source for the given media key. */
export function resolveMediaKey(mediaKey: string): ImageSourcePropType {
  if (mediaKey in SEED_IMAGES) {
    return SEED_IMAGES[mediaKey]!;
  }
  // Future: signed CDN URLs, R2 keys, etc.
  return { uri: mediaKey };
}
