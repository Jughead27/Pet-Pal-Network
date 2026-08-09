/**
 * shareCardAction — platform-split share-card execution.
 *
 * Web path:
 *   Composes the card directly on a Canvas element (full control, no CORS
 *   issues since /api/media/?inline=1 streams bytes from the same origin),
 *   then hands the PNG to the Web Share API.  Falls back to image download +
 *   clipboard copy when Web Share file sharing is unavailable.
 *
 * Native path:
 *   Captures the pre-rendered off-screen ShareCard view via
 *   react-native-view-shot, then opens the OS share sheet via expo-sharing.
 *
 * Card layout — photo on top, branded bar below:
 *   ┌──────────────────────────────┐
 *   │                              │
 *   │    full-bleed cropped photo  │ PHOTO_H  (crop-rect-aware)
 *   │    (no overlays, no text)    │
 *   │                              │
 *   ├──────────────────────────────┤
 *   │ Pet Name    │    pshpsh.net  │ BAR_H
 *   │ caption     │  follow pets… │
 *   └──────────────────────────────┘
 *
 * Bar colour is driven by the photo's average luminance:
 *   bright photo → white bar + dark text
 *   dark photo   → dark bar (#060B10) + light text
 *
 * No share analytics, no "shared by" attribution — private action per mission.
 */

import { Platform } from 'react-native';
import type { RefObject } from 'react';
import type { View } from 'react-native';

// Native card dimensions (captured at 3× → ~1170 × 2079 px).
// CARD_H = PHOTO_H + BAR_H = 566 + 127 = 693 (unchanged from previous).
const NATIVE_CAPTURE_W = 390 * 3; // 1170
const NATIVE_CAPTURE_H = 693 * 3; // 2079
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { captureRef } from 'react-native-view-shot';

// ─── Share text helper ────────────────────────────────────────────────────────

const SITE = 'pshpsh.net';

/**
 * Builds the share caption that travels alongside the card image.
 * Passing only `text` (no `url`) to navigator.share prevents iOS Messages
 * from rendering the URL as a separate rich-link bubble.
 */
function buildShareText(petNames: string[]): string {
  if (petNames.length === 0) return `Check out my pet 🐾 ${SITE}`;
  if (petNames.length === 1) return `Check out ${petNames[0]} 🐾 ${SITE}`;
  if (petNames.length === 2) return `Check out ${petNames[0]} and ${petNames[1]} 🐾 ${SITE}`;
  return `Check out my pets 🐾 ${SITE}`;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export interface ShareCardParams {
  /** Resolved media URI string (absolute on native, relative or absolute on web). */
  mediaUri:  string;
  /** Ref to the off-screen ShareCard view — used on native only. */
  cardRef:   RefObject<View | null>;
  /** Toast callback for user-facing messages (e.g. web fallback confirmation). */
  showToast: (message: string) => void;
  /**
   * Names of the pets tagged in this post — used to personalise the share
   * caption text (the OS share-sheet message, not the visual card).
   */
  petNames:  string[];
  /** Pre-formatted display name for the card's bar (e.g. "Mochi & Luna"). */
  displayName: string;
  /** Post caption for the card's bar. */
  caption: string;
  /** Crop rect (0–1 fractions of natural image). When present, used instead of full-image cover. */
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
  /** Sampled fill color shown behind the photo when the crop rect extends past the image. */
  cropFillColor?: string | null;
  /** Tiny thumbnail data URI stretched over the fill area for a blur look. */
  cropFillThumb?: string | null;
}

export async function executeShareCard({
  mediaUri,
  cardRef,
  showToast,
  petNames,
  displayName,
  caption,
  cropX, cropY, cropW, cropH, cropFillColor, cropFillThumb,
}: ShareCardParams): Promise<void> {
  if (Platform.OS === 'web') {
    await webShareCard(mediaUri, showToast, petNames, displayName, caption, cropX, cropY, cropW, cropH, cropFillColor, cropFillThumb);
  } else {
    await nativeShareCard(cardRef, showToast, petNames);
  }
}

// ─── Web: Canvas composition ──────────────────────────────────────────────────

// Card dimensions.  Photo sits in the top PHOTO_H rows; bar fills the rest.
const CARD_W   = 1080;
const PHOTO_H  = 1640;   // photo section (reduced from 1920 to make room for bar)
const BAR_H    = 280;    // branded bar section below photo
const CARD_H   = PHOTO_H + BAR_H;   // 1920 total

// ── Theming ───────────────────────────────────────────────────────────────────
interface BarColors {
  bg:      string;
  name:    string;
  caption: string;
  brand:   string;
  slogan:  string;
}

const DARK_THEME: BarColors = {
  bg:      '#060B10',
  name:    '#F0F4F8',
  caption: 'rgba(240,244,248,0.65)',
  brand:   '#CBD5E1',
  slogan:  'rgba(203,213,225,0.55)',
};

const LIGHT_THEME: BarColors = {
  bg:      '#FFFFFF',
  name:    '#0A0F14',
  caption: 'rgba(10,15,20,0.60)',
  brand:   '#1A202C',
  slogan:  'rgba(26,32,44,0.50)',
};

// ── Luminance sampling ────────────────────────────────────────────────────────

/**
 * Sample average perceived luminance from the photo region of the canvas.
 * Samples every 4th pixel (every 16th RGBA byte group) for speed.
 */
function sampleLuminance(ctx: CanvasRenderingContext2D): number {
  // Sample only the bottom strip of the photo where sky/bg is typically lighter,
  // blended with the full-photo average so the reading is representative.
  const strip = ctx.getImageData(0, 0, CARD_W, PHOTO_H);
  const d = strip.data;
  let sum = 0, count = 0;
  // stride 64 = every 16th pixel (4 bytes × 16)
  for (let i = 0; i < d.length; i += 64) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    count++;
  }
  return count > 0 ? sum / count : 128;
}

async function webShareCard(
  mediaUri:    string,
  showToast:   (message: string) => void,
  petNames:    string[],
  displayName: string,
  caption:     string,
  cropX?: number | null,
  cropY?: number | null,
  cropW?: number | null,
  cropH?: number | null,
  cropFillColor?: string | null,
  cropFillThumb?: string | null,
): Promise<void> {
  // Make absolute so fetch works from any page path.
  const absoluteUri = mediaUri.startsWith('/')
    ? `${window.location.origin}${mediaUri}`
    : mediaUri;

  // Append ?inline=1 so the media route streams bytes directly with
  // Access-Control-Allow-Origin: * instead of 302-redirecting to a
  // cross-origin R2 presigned URL.
  const separator = absoluteUri.includes('?') ? '&' : '?';
  const inlineUri = `${absoluteUri}${separator}inline=1`;

  const resp = await fetch(inlineUri, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  const imgBlob   = await resp.blob();
  const objectUrl = URL.createObjectURL(imgBlob);

  try {
    const img = await loadImage(objectUrl);

    const canvas = document.createElement('canvas');
    canvas.width  = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d')!;

    // ── Photo — apply crop rect when present, full-image cover otherwise ───────
    // (This section is untouched from the previous round's crop-rect-aware work.)
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const hasCrop = cropX != null && cropY != null && cropW != null && cropH != null
      && cropW > 0 && cropH > 0;

    if (hasCrop && cropFillColor) {
      // Zoomed-out crop: the rect may extend past the image bounds, so the
      // 9-arg out-of-bounds source path is avoided (browser clipping quirks).
      // Instead: fill the photo area with the sampled color, clip to it, and
      // draw the FULL image at its rect-mapped destination.
      const sx = (cropX as number) * nw;
      const sy = (cropY as number) * nh;
      const sw = (cropW as number) * nw;
      const sh = (cropH as number) * nh;
      const scale = Math.max(CARD_W / sw, PHOTO_H / sh);
      const dx    = (CARD_W - sw * scale) / 2;   // dest x of the rect's left edge
      const dy    = (PHOTO_H - sh * scale) / 2;  // dest y of the rect's top edge
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, CARD_W, PHOTO_H);
      ctx.clip();
      ctx.fillStyle = cropFillColor;
      ctx.fillRect(0, 0, CARD_W, PHOTO_H);
      // Blur-look fill: stretch the tiny thumbnail to cover the photo area
      // over the solid color (which stays as the instant/failure fallback).
      if (cropFillThumb) {
        try {
          const thumb = await loadImage(cropFillThumb);
          const tScale = Math.max(CARD_W / thumb.naturalWidth, PHOTO_H / thumb.naturalHeight);
          const tw = thumb.naturalWidth * tScale;
          const th = thumb.naturalHeight * tScale;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(thumb, (CARD_W - tw) / 2, (PHOTO_H - th) / 2, tw, th);
        } catch {
          // Thumbnail failed to decode — solid color already painted.
        }
      }
      // Soft edge treatment — mirrors FillEdgeSoftener in FocalImage.tsx:
      // subtle black fade at each frame edge, drawn over the fill but before
      // the photo, so only exposed fill fades. Same constants (0.28 / 12%).
      // Gated on cropFillThumb to match native exactly — a solid-color-only
      // fill (thumb missing/failed at compose time) stays untreated.
      if (cropFillThumb) {
        const ALPHA = 0.28;
        const spanY = PHOTO_H * 0.12;
        const spanX = CARD_W * 0.12;
        const edges: Array<[number, number, number, number]> = [
          [0, 0, 0, spanY],                    // top
          [0, PHOTO_H, 0, PHOTO_H - spanY],    // bottom
          [0, 0, spanX, 0],                    // left
          [CARD_W, 0, CARD_W - spanX, 0],      // right
        ];
        for (const [x0, y0, x1, y1] of edges) {
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, `rgba(0,0,0,${ALPHA})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, CARD_W, PHOTO_H);
        }
      }
      // Full image destination: shift so image (0,0) lands at dx - sx*scale.
      ctx.drawImage(img, dx - sx * scale, dy - sy * scale, nw * scale, nh * scale);
      ctx.restore();
    } else if (hasCrop) {
      // 9-arg drawImage: source rect = crop rect, dest fills CARD_W × PHOTO_H.
      const sx = (cropX as number) * nw;
      const sy = (cropY as number) * nh;
      const sw = (cropW as number) * nw;
      const sh = (cropH as number) * nh;
      const scale = Math.max(CARD_W / sw, PHOTO_H / sh);
      const dw    = sw * scale;
      const dh    = sh * scale;
      const dx    = (CARD_W - dw) / 2;
      const dy    = (PHOTO_H - dh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    } else {
      // Full-image cover (no crop rect).
      const scale = Math.max(CARD_W / nw, PHOTO_H / nh);
      const dw    = nw * scale;
      const dh    = nh * scale;
      const dx    = (CARD_W - dw) / 2;
      const dy    = (PHOTO_H - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    // ── Luminance-based bar theme ─────────────────────────────────────────────
    const lum = sampleLuminance(ctx);
    const theme = lum > 140 ? LIGHT_THEME : DARK_THEME;

    // ── Bar — solid colour below photo ────────────────────────────────────────
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, PHOTO_H, CARD_W, BAR_H);

    // Typography constants.
    const FONT_STACK  = 'Inter, system-ui, -apple-system, sans-serif';
    const PAD_X       = 60;          // horizontal margin inside bar
    const BAR_MID_Y   = PHOTO_H + BAR_H / 2;

    // ── LEFT — pet name (dominant) + caption ──────────────────────────────────
    // Caption is display-truncated to 2 word-wrapped lines with an ellipsis
    // (rendering only — stored caption is untouched). When there is no
    // caption, the block collapses to just the name — no reserved dead space.
    const NAME_SIZE    = 70;
    const CAP_SIZE     = 42;
    const NAME_GAP     = 20;   // gap between name baseline and caption block top
    const CAP_LINE_H   = 52;   // caption line height (baseline-to-baseline)

    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';

    const maxCapW = CARD_W * 0.55 - PAD_X;

    // Measure/wrap with the real caption font active so widths are exact.
    let capLines: string[] = [];
    if (caption) {
      ctx.font          = `400 ${CAP_SIZE}px ${FONT_STACK}`;
      ctx.letterSpacing = '0px';
      capLines = wrapCaptionLines(ctx, caption, maxCapW, 2);
    }

    const capBlockH = capLines.length > 0
      ? NAME_GAP + CAP_SIZE + (capLines.length - 1) * CAP_LINE_H
      : 0;
    const BLOCK_H = NAME_SIZE + capBlockH;
    const NAME_Y  = BAR_MID_Y - BLOCK_H / 2 + NAME_SIZE;   // name baseline

    if (displayName) {
      ctx.fillStyle     = theme.name;
      ctx.font          = `700 ${NAME_SIZE}px ${FONT_STACK}`;
      ctx.letterSpacing = '0px';
      const maxNameW    = CARD_W * 0.55 - PAD_X;
      ctx.fillText(displayName, PAD_X, NAME_Y, maxNameW);
    }

    if (capLines.length > 0) {
      ctx.fillStyle     = theme.caption;
      ctx.font          = `400 ${CAP_SIZE}px ${FONT_STACK}`;
      ctx.letterSpacing = '0px';
      capLines.forEach((line, i) => {
        ctx.fillText(line, PAD_X, NAME_Y + NAME_GAP + CAP_SIZE + i * CAP_LINE_H);
      });
    }

    // ── RIGHT — brand name + slogan (secondary) ───────────────────────────────
    const BRAND_SIZE  = 34;
    const SLOGAN_SIZE = 26;
    const BRAND_GAP   = 14;
    const BRAND_BLOCK = BRAND_SIZE + BRAND_GAP + SLOGAN_SIZE;
    const BRAND_Y     = BAR_MID_Y - BRAND_BLOCK / 2 + BRAND_SIZE;
    const SLOGAN_Y    = BRAND_Y + BRAND_GAP + SLOGAN_SIZE;
    const RIGHT_X     = CARD_W - PAD_X;

    ctx.textAlign = 'right';

    ctx.fillStyle     = theme.brand;
    ctx.font          = `600 ${BRAND_SIZE}px ${FONT_STACK}`;
    ctx.letterSpacing = '0.5px';
    ctx.fillText('pshpsh.net', RIGHT_X, BRAND_Y);

    ctx.fillStyle     = theme.slogan;
    ctx.font          = `400 ${SLOGAN_SIZE}px ${FONT_STACK}`;
    ctx.letterSpacing = '0.3px';
    ctx.fillText('follow pets, not people.', RIGHT_X, SLOGAN_Y);

    // ── Export PNG ─────────────────────────────────────────────────────────────
    const dataUri  = canvas.toDataURL('image/png');
    const pngBlob  = await (await fetch(dataUri)).blob();
    const pngFile  = new File([pngBlob], 'pshpsh.png', { type: 'image/png' });

    // ── Share ──────────────────────────────────────────────────────────────────
    // Pass only `files` + `text` — no `url` field.  Passing a url alongside
    // files causes iOS Messages to render it as a second rich-link bubble.
    const shareText = buildShareText(petNames);
    if (navigator.canShare?.({ files: [pngFile] })) {
      await navigator.share({ files: [pngFile], text: shareText });
    } else {
      // Fallback: download the image + copy share text to clipboard
      const dlUrl = URL.createObjectURL(pngBlob);
      const a     = document.createElement('a');
      a.href     = dlUrl;
      a.download = 'pshpsh.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);

      try {
        await Clipboard.setStringAsync(shareText);
        showToast('saved image — caption copied 🐾');
      } catch {
        showToast('image saved to downloads');
      }
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Word-wrap `text` into at most `maxLines` lines that fit `maxWidth` at the
 * currently-set canvas font. The final line gets an ellipsis if content
 * remains beyond it. Breaks only at word boundaries for normal text; the
 * single pathological case of one unbroken token wider than maxWidth is
 * character-clipped with an ellipsis (mirroring native tail ellipsis), since
 * canvas fillText would otherwise overflow into the brand block.
 */
function wrapCaptionLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Ellipsize `s` so `…` fits within maxWidth: drop trailing words first
  // (word-boundary truncation), then — only for a single over-width token —
  // shave characters. Never emits a line wider than maxWidth.
  const ellipsize = (s: string): string => {
    let clipped = s.replace(/…$/, '');
    while (ctx.measureText(`${clipped}…`).width > maxWidth && clipped.includes(' ')) {
      clipped = clipped.slice(0, clipped.lastIndexOf(' '));
    }
    while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    return `${clipped}…`;
  };

  // Fit a token onto an empty line: keep whole if it fits, char-clip if not.
  const fitToken = (word: string): string =>
    ctx.measureText(word).width <= maxWidth ? word : ellipsize(word);

  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : null;

    if (candidate && ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (!current) {
      // First word on the line — char-clipped only if over-width by itself.
      current = fitToken(word);
      continue;
    }

    // Word doesn't fit on the current line.
    if (lines.length === maxLines - 1) {
      // Current is the last allowed line — ellipsize at word boundaries
      // (char-level only for a single over-width token).
      lines.push(ellipsize(current));
      return lines;
    }

    lines.push(current);
    current = fitToken(word);
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src     = src;
  });
}

// ─── Native: viewshot capture ─────────────────────────────────────────────────

async function nativeShareCard(
  cardRef:   RefObject<View | null>,
  showToast: (message: string) => void,
  petNames:  string[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uri = await captureRef(cardRef as any, {
    format: 'png',
    result: 'tmpfile',
    width:  NATIVE_CAPTURE_W,
    height: NATIVE_CAPTURE_H,
  });

  const available = await Sharing.isAvailableAsync();
  if (available) {
    await Sharing.shareAsync(uri, {
      mimeType:    'image/png',
      dialogTitle: buildShareText(petNames),
    });
  } else {
    showToast('sharing not available on this device');
  }
}
