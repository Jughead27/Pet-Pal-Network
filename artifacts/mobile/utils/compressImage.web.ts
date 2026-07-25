/**
 * Web image compression via HTML5 Canvas.
 * Metro resolves this file on web instead of compressImage.ts.
 *
 * Target: longest edge ≤ 2048 px, JPEG quality 0.85.
 */

const MAX_DIMENSION = 2048;
const JPEG_QUALITY  = 0.85;

export interface CompressResult {
  uri: string;
}

export function compressImage(
  uri: string,
  _originalWidth: number,
  _originalHeight: number,
): Promise<CompressResult> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();

    img.onload = () => {
      const { naturalWidth: srcW, naturalHeight: srcH } = img;
      const longest = Math.max(srcW, srcH);
      const scale   = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
      const dstW    = Math.round(srcW * scale);
      const dstH    = Math.round(srcH * scale);

      const canvas  = document.createElement('canvas');
      canvas.width  = dstW;
      canvas.height = dstH;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }

      ctx.drawImage(img, 0, 0, dstW, dstH);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Canvas toBlob returned null')); return; }
          resolve({ uri: URL.createObjectURL(blob) });
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    };

    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = uri;
  });
}
