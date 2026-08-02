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
 * No share analytics, no "shared by" attribution — private action per mission.
 */

import { Platform } from 'react-native';
import type { RefObject } from 'react';
import type { View } from 'react-native';

// Card dimensions that match ShareCard.tsx (captured at 3× → ~1170 × 2304 px)
const NATIVE_CAPTURE_W = 390 * 3; // 1170
const NATIVE_CAPTURE_H = 768 * 3; // 2304
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
  if (petNames.length === 0) return `Check out my pet on pshpsh 🐾 ${SITE}`;
  if (petNames.length === 1) return `Check out my ${petNames[0]} on pshpsh 🐾 ${SITE}`;
  if (petNames.length === 2) return `Check out my ${petNames[0]} and ${petNames[1]} on pshpsh 🐾 ${SITE}`;
  return `Check out my pets on pshpsh 🐾 ${SITE}`;
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
   * caption text.  Today every post has one pet; list format handles future
   * multi-pet posts without further changes.
   */
  petNames:  string[];
}

export async function executeShareCard({
  mediaUri,
  cardRef,
  showToast,
  petNames,
}: ShareCardParams): Promise<void> {
  if (Platform.OS === 'web') {
    await webShareCard(mediaUri, showToast, petNames);
  } else {
    await nativeShareCard(cardRef, showToast, petNames);
  }
}

// ─── Web: Canvas composition ──────────────────────────────────────────────────

const CARD_W   = 1080;
const PHOTO_H  = 1920;   // 9:16 portrait — matches Instagram Stories
const FOOTER_H = 160;
const CARD_H   = PHOTO_H + FOOTER_H;

// pshpsh app icon pre-encoded as a 64×64 PNG data URI so it loads with no
// network fetch and no bundled-asset path/hash resolution on web.
// Generated from assets/icon.png via: magick icon.png -resize 64x64 -strip out.png
const ICON_DATA_URI = 'data:image/png;base64,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';

async function webShareCard(
  mediaUri: string,
  showToast: (message: string) => void,
  petNames: string[],
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

  // Load photo and icon in parallel — icon from inline data URI (instant, no fetch).
  const resp = await fetch(inlineUri, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  const imgBlob   = await resp.blob();
  const objectUrl = URL.createObjectURL(imgBlob);

  try {
    const [img, iconImg] = await Promise.all([
      loadImage(objectUrl),
      loadImage(ICON_DATA_URI),
    ]);

    const canvas = document.createElement('canvas');
    canvas.width  = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d')!;

    // ── Photo — cover mode (scale so both dims fill, center-crop) ─────────────
    const scale = Math.max(CARD_W / img.naturalWidth, PHOTO_H / img.naturalHeight);
    const dw = img.naturalWidth  * scale;
    const dh = img.naturalHeight * scale;
    const dx = (CARD_W - dw) / 2;
    const dy = (PHOTO_H - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    // ── Footer band ────────────────────────────────────────────────────────────
    ctx.fillStyle = '#060B10';
    ctx.fillRect(0, PHOTO_H, CARD_W, FOOTER_H);

    // ── Logo tile — standalone, far left, full opacity ─────────────────────────
    // Sized to ~75% of the footer height so it reads as a clear tile, not a badge.
    const TILE_SZ  = Math.round(FOOTER_H * 0.75); // 120 px
    const TILE_PAD = 20;
    const TILE_X   = TILE_PAD;
    const TILE_Y   = PHOTO_H + Math.round((FOOTER_H - TILE_SZ) / 2); // vertically centered
    const TILE_R   = 16; // rounded-square corner radius

    // Clip to rounded-square before drawing so the icon's black bg blends cleanly
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(TILE_X, TILE_Y, TILE_SZ, TILE_SZ, TILE_R);
    } else {
      // Polyfill for browsers without roundRect (Safari < 16)
      ctx.moveTo(TILE_X + TILE_R, TILE_Y);
      ctx.arcTo(TILE_X + TILE_SZ, TILE_Y,          TILE_X + TILE_SZ, TILE_Y + TILE_SZ, TILE_R);
      ctx.arcTo(TILE_X + TILE_SZ, TILE_Y + TILE_SZ, TILE_X,          TILE_Y + TILE_SZ, TILE_R);
      ctx.arcTo(TILE_X,           TILE_Y + TILE_SZ, TILE_X,          TILE_Y,           TILE_R);
      ctx.arcTo(TILE_X,           TILE_Y,           TILE_X + TILE_SZ, TILE_Y,          TILE_R);
      ctx.closePath();
    }
    ctx.clip();
    ctx.drawImage(iconImg, TILE_X, TILE_Y, TILE_SZ, TILE_SZ); // full opacity
    ctx.restore();

    // ── Text — centered in the right zone (right of the logo tile) ────────────
    // Right zone: from (TILE_PAD + TILE_SZ + gap) to CARD_W.
    // Centering text within this zone keeps it balanced without colliding with
    // the tile even at the wider slogan width.
    const TEXT_ZONE_LEFT  = TILE_PAD + TILE_SZ + 20; // 160 px
    const TEXT_CENTER_X   = TEXT_ZONE_LEFT + (CARD_W - TEXT_ZONE_LEFT) / 2; // 620 px

    ctx.textBaseline = 'alphabetic';

    // Slogan — dominant hook (large, white, full weight)
    ctx.fillStyle     = '#FFFFFF';
    ctx.textAlign     = 'center';
    ctx.font          = '600 52px Inter, system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '0.5px';
    ctx.fillText('follow pets, not people.', TEXT_CENTER_X, PHOTO_H + 70);

    // Wordmark — standalone "pshpsh" credit line, subdued
    ctx.fillStyle     = 'rgba(255,255,255,0.55)';
    ctx.font          = '500 28px Inter, system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('pshpsh', TEXT_CENTER_X, PHOTO_H + 120);

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
  cardRef: RefObject<View | null>,
  showToast: (message: string) => void,
  petNames: string[],
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
