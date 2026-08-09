/**
 * Web crop-fill thumbnail generation via HTML5 Canvas.
 * Metro resolves this file on web instead of fillThumb.ts.
 *
 * Produces a tiny (~24 px longest edge) JPEG data URI of the photo. Static
 * render surfaces stretch it under the photo so the upscale interpolation
 * reads as a soft blur wherever the crop rect extends past the image.
 */

const THUMB_EDGE = 24;

export function computeFillThumb(uri: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img;
        if (!w || !h) { resolve(null); return; }
        const scale = THUMB_EDGE / Math.max(w, h);
        const tw = Math.max(1, Math.round(w * scale));
        const th = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, tw, th);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } catch {
        resolve(null); // caller falls back to the solid fill color
      }
    };
    img.onerror = () => resolve(null);
    img.src = uri;
  });
}
