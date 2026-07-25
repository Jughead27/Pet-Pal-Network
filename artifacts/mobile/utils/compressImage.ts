/**
 * Native (iOS / Android) image compression.
 * Metro resolves this file on native and compressImage.web.ts on web.
 *
 * Target: longest edge ≤ 2048 px, JPEG quality 0.85.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const MAX_DIMENSION = 2048;
const JPEG_QUALITY  = 0.85;

export interface CompressResult {
  uri: string;
}

export async function compressImage(
  uri: string,
  originalWidth: number,
  originalHeight: number,
): Promise<CompressResult> {
  const longest  = Math.max(originalWidth, originalHeight);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions: any[] = [];

  if (longest > MAX_DIMENSION) {
    if (originalWidth >= originalHeight) {
      actions.push({ resize: { width: MAX_DIMENSION } });
    } else {
      actions.push({ resize: { height: MAX_DIMENSION } });
    }
  }

  return manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format:   SaveFormat.JPEG,
  });
}
