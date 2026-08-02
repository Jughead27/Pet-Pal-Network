/**
 * shareCardAction — platform-split share-card execution.
 *
 * Web path:
 *   Composes the card directly on a Canvas element (full control, no CORS
 *   issues since /api/media/ is same-origin), then hands the PNG to the Web
 *   Share API.  Falls back to image download + clipboard copy when Web Share
 *   file sharing is unavailable, with a confirmation toast.
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

// ─── Public entry point ───────────────────────────────────────────────────────

export interface ShareCardParams {
  /** Resolved media URI string (absolute on native, relative or absolute on web). */
  mediaUri:  string;
  /** Ref to the off-screen ShareCard view — used on native only. */
  cardRef:   RefObject<View | null>;
  /** Toast callback for user-facing messages (e.g. web fallback confirmation). */
  showToast: (message: string) => void;
}

export async function executeShareCard({
  mediaUri,
  cardRef,
  showToast,
}: ShareCardParams): Promise<void> {
  if (Platform.OS === 'web') {
    await webShareCard(mediaUri, showToast);
  } else {
    await nativeShareCard(cardRef, showToast);
  }
}

// ─── Web: Canvas composition ──────────────────────────────────────────────────

const CARD_W   = 1080;
const PHOTO_H  = 1920;   // 9:16 portrait — matches Instagram Stories
const FOOTER_H = 160;
const CARD_H   = PHOTO_H + FOOTER_H;
const SITE_URL = 'pshpsh.net';

async function webShareCard(
  mediaUri: string,
  showToast: (message: string) => void,
): Promise<void> {
  // Make absolute so fetch works from any page path.
  const absoluteUri = mediaUri.startsWith('/')
    ? `${window.location.origin}${mediaUri}`
    : mediaUri;

  // Append ?inline=1 so the media route streams bytes directly with
  // Access-Control-Allow-Origin: * instead of 302-redirecting to a
  // cross-origin R2 presigned URL.  Credentialed fetches to cross-origin
  // R2 URLs trigger CORS preflight failures; inline mode bypasses this.
  // The /api/media/ route authenticates via HMAC tokens in the URL —
  // no session cookie is needed, so credentials: 'omit' is correct.
  const separator = absoluteUri.includes('?') ? '&' : '?';
  const inlineUri = `${absoluteUri}${separator}inline=1`;

  const resp = await fetch(inlineUri, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  const imgBlob  = await resp.blob();
  const objectUrl = URL.createObjectURL(imgBlob);

  try {
    const img = await loadImage(objectUrl);

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

    // Wordmark — "pshpsh"
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle    = '#FFFFFF';
    ctx.font         = '600 50px Inter, system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('pshpsh', CARD_W / 2, PHOTO_H + 72);

    // Slogan
    ctx.fillStyle     = 'rgba(255,255,255,0.50)';
    ctx.font          = '400 32px Inter, system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '0.5px';
    ctx.fillText('follow pets, not people.', CARD_W / 2, PHOTO_H + 120);

    // ── Export PNG ─────────────────────────────────────────────────────────────
    const dataUri  = canvas.toDataURL('image/png');
    const pngBlob  = await (await fetch(dataUri)).blob();
    const pngFile  = new File([pngBlob], 'pshpsh.png', { type: 'image/png' });

    // ── Share ──────────────────────────────────────────────────────────────────
    if (navigator.canShare?.({ files: [pngFile] })) {
      // Web Share API with file (iOS Safari 15+, Chrome Android, etc.)
      await navigator.share({ files: [pngFile], text: SITE_URL, title: 'pshpsh' });
    } else {
      // Fallback: download the image + copy site URL to clipboard
      const dlUrl = URL.createObjectURL(pngBlob);
      const a     = document.createElement('a');
      a.href     = dlUrl;
      a.download = 'pshpsh.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);

      try {
        await Clipboard.setStringAsync(SITE_URL);
        showToast('saved image — link copied 🐾');
      } catch {
        // Clipboard unavailable (unlikely, but don't crash)
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
): Promise<void> {
  // Capture at 3× the card's logical dimensions for a high-res share image.
  // CaptureOptions uses width/height to specify the output resolution;
  // react-native-view-shot scales the captured view to these dimensions.
  // captureRef's type does not allow null in its generic; cast to satisfy it.
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
      dialogTitle: 'Share via pshpsh',
    });
  } else {
    showToast('sharing not available on this device');
  }
}
