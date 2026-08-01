/**
 * computeAutoFrame — compose-only auto-framing utility.
 *
 * Returns a crop rect {x, y, w, h} in 0–1 fractions of the original image
 * dimensions. The rect is the region that will be visible in the feed cover crop.
 *
 * Web path: lazy-imports smartcrop (browser canvas). Falls back to floor on error.
 * Native path: floor directly (no canvas available).
 *
 * Floor = top-weighted center crop: horizontally centered, vertically biased
 * toward the top third so subject heads survive the crop.
 */

import { Platform } from 'react-native';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Target aspect ratio for the feed card (square for simplicity, matching the
// existing cover-fit behavior in FeedPage where the frame is the full screen height).
// Using 1:1 as the target means the auto-frame always picks the most content-rich
// square region (or the full image if it is already square/portrait enough).
const TARGET_ASPECT = 1; // width / height

/**
 * Top-weighted center crop (the "floor").
 *
 * Horizontal: centered.
 * Vertical: the crop starts at 1/6 of the image height (top-bias) clamped so
 * it never overflows the bottom. This keeps faces/heads in frame for portrait
 * subjects even when the image is much taller than the target aspect.
 */
function floor(naturalWidth: number, naturalHeight: number, targetAspect: number): CropRect {
  const srcAspect = naturalWidth / naturalHeight;

  if (srcAspect <= targetAspect) {
    // Image is narrower than (or equal to) target — full width, crop height.
    const w = 1;
    const h = (naturalWidth / targetAspect) / naturalHeight;
    // Bias: start at top-sixth, clamped.
    const yBias = Math.min(1 / 6, 1 - h);
    return { x: 0, y: yBias, w, h };
  } else {
    // Image is wider than target — crop width, full height.
    const h = 1;
    const w = (naturalHeight * targetAspect) / naturalWidth;
    // Horizontal: center.
    const x = (1 - w) / 2;
    return { x, y: 0, w, h };
  }
}

/**
 * computeAutoFrame — returns a {x, y, w, h} crop rect in [0,1] space.
 *
 * @param uri           Local URI of the already-compressed image.
 * @param naturalWidth  Pixel width of the compressed image.
 * @param naturalHeight Pixel height of the compressed image.
 * @param targetAspect  Target width/height ratio (default 1:1).
 */
export async function computeAutoFrame(
  uri: string,
  naturalWidth: number,
  naturalHeight: number,
  targetAspect = TARGET_ASPECT,
): Promise<CropRect> {
  const floorRect = floor(naturalWidth, naturalHeight, targetAspect);

  // Native: no canvas — use floor directly.
  if (Platform.OS !== 'web') {
    return floorRect;
  }

  // Web: try smartcrop.js via browser canvas.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const smartcrop: any = await import('smartcrop').catch(() => null);
    if (!smartcrop) return floorRect;

    // Load the image into a canvas element so smartcrop can analyse it.
    const img = await loadImage(uri);
    const cropW = Math.round(img.naturalWidth * (targetAspect >= 1 ? 1 : targetAspect));
    const cropH = Math.round(img.naturalHeight * (targetAspect <= 1 ? 1 : 1 / targetAspect));

    const result = await smartcrop.crop(img, { width: cropW, height: cropH });
    const tc = result?.topCrop;

    if (
      tc &&
      typeof tc.x === 'number' &&
      typeof tc.y === 'number' &&
      typeof tc.width === 'number' &&
      typeof tc.height === 'number' &&
      tc.width > 0 &&
      tc.height > 0
    ) {
      const iw = img.naturalWidth || naturalWidth;
      const ih = img.naturalHeight || naturalHeight;
      return {
        x: tc.x / iw,
        y: tc.y / ih,
        w: tc.width / iw,
        h: tc.height / ih,
      };
    }
  } catch {
    // Fall through to floor.
  }

  return floorRect;
}

/** Loads a URI into an HTMLImageElement. Resolves when fully decoded. */
function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = uri;
  });
}
