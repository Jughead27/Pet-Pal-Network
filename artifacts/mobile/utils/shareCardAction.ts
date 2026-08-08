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
}

export async function executeShareCard({
  mediaUri,
  cardRef,
  showToast,
  petNames,
  displayName,
  caption,
  cropX, cropY, cropW, cropH,
}: ShareCardParams): Promise<void> {
  if (Platform.OS === 'web') {
    await webShareCard(mediaUri, showToast, petNames, displayName, caption, cropX, cropY, cropW, cropH);
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

    if (hasCrop) {
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
    const NAME_SIZE   = 70;
    const CAP_SIZE    = 42;
    const NAME_GAP    = 20;          // gap between name baseline and caption top
    const BLOCK_H     = NAME_SIZE + NAME_GAP + CAP_SIZE;
    const NAME_Y      = BAR_MID_Y - BLOCK_H / 2 + NAME_SIZE;    // baseline
    const CAP_Y       = NAME_Y + NAME_GAP + CAP_SIZE;

    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';

    if (displayName) {
      ctx.fillStyle     = theme.name;
      ctx.font          = `700 ${NAME_SIZE}px ${FONT_STACK}`;
      ctx.letterSpacing = '0px';
      const maxNameW    = CARD_W * 0.55 - PAD_X;
      ctx.fillText(displayName, PAD_X, NAME_Y, maxNameW);
    }

    if (caption) {
      ctx.fillStyle     = theme.caption;
      ctx.font          = `400 ${CAP_SIZE}px ${FONT_STACK}`;
      ctx.letterSpacing = '0px';
      const maxCapW     = CARD_W * 0.55 - PAD_X;
      ctx.fillText(caption, PAD_X, CAP_Y, maxCapW);
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
