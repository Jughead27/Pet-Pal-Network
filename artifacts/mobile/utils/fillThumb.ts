/**
 * Native (iOS / Android) crop-fill thumbnail generation.
 * Metro resolves this file on native and fillThumb.web.ts on web.
 *
 * Produces a tiny (~24 px longest edge) JPEG data URI of the photo. Static
 * render surfaces stretch it under the photo so the upscale interpolation
 * reads as a soft blur wherever the crop rect extends past the image.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const THUMB_EDGE = 24;

export async function computeFillThumb(uri: string): Promise<string | null> {
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: THUMB_EDGE } }],
      { compress: 0.6, format: SaveFormat.JPEG, base64: true },
    );
    const b64 = (result as { base64?: string }).base64;
    if (!b64) return null;
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    return null; // caller falls back to the solid fill color
  }
}
