/**
 * luminance.ts — native image luminance estimation for share-card theming.
 *
 * Uses expo-image-manipulator to resize the source image to 1×1 pixel (fast,
 * no expensive full decode), saves as PNG base64, then parses the PNG IDAT
 * chunk with a minimal inline inflate implementation (stored-block + fixed
 * Huffman) to extract the single R/G/B pixel value.
 *
 * Returns a perceived luminance value in [0, 255].  Returns 128 (neutral →
 * defaults to dark theme) on any parse or network failure.
 *
 * Web path: NOT used here — the web canvas path samples pixels directly from
 * the CanvasRenderingContext2D after drawing, which is faster and more accurate.
 */

import * as ImageManipulator from 'expo-image-manipulator';

// ── Minimal DEFLATE inflate (stored + fixed Huffman, no back-references) ─────
// Sufficient for a 1×1 PNG: raw scanline is 5 bytes (filter + RGBA), which
// libpng encodes as a stored block OR fixed Huffman with only literal symbols
// and an end-of-block — no LZ77 back-references needed for 5 bytes.

function inflate(data: Uint8Array, skip = 2): Uint8Array {
  let pos = skip; // skip 2-byte zlib header (CMF + FLG)
  let bitBuf = 0, bitLen = 0;
  const out: number[] = [];

  function readBit(): number {
    if (bitLen === 0) { bitBuf = data[pos++]; bitLen = 8; }
    const b = bitBuf & 1;
    bitBuf >>>= 1;
    bitLen--;
    return b;
  }

  let bfinal = 0;
  while (!bfinal) {
    bfinal = readBit();
    const btype = readBit() | (readBit() << 1);

    if (btype === 0) {
      // Stored block — byte-align then read literal bytes.
      bitBuf = 0; bitLen = 0;
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4; // skip LEN (2) + NLEN (2)
      for (let i = 0; i < len; i++) out.push(data[pos++]);

    } else if (btype === 1) {
      // Fixed Huffman — RFC 1951 §3.2.6 canonical alphabet.
      // Literals 0–143:    8-bit codes 0x30–0xBF  (code = lit + 0x30)
      // Literals 144–255:  9-bit codes 0x190–0x1FF (code = lit – 144 + 0x190)
      // Symbols 256–279:   7-bit codes 0x00–0x17   (code = sym – 256)
      // Symbols 280–287:   8-bit codes 0xC0–0xC7   (code = sym – 280 + 0xC0)
      loop: while (true) {
        // Accumulate code MSB-first via LSB-first bit reader.
        let code = 0;
        for (let i = 0; i < 7; i++) code = (code << 1) | readBit();

        if (code <= 0x17) {
          // 7-bit symbols 256–279. code 0 = EOB (symbol 256).
          if (code === 0) break loop; // end of block
          // length symbol — won't occur for 5 literal bytes; break to avoid hang.
          break loop;
        }

        // Extend to 8 bits.
        code = (code << 1) | readBit();
        if (code >= 0x30 && code <= 0xBF) {
          out.push(code - 0x30); // literal 0–143
          continue;
        }
        if (code >= 0xC0 && code <= 0xC7) {
          break loop; // length symbol 280–287 (no back-refs in our data)
        }

        // Extend to 9 bits.
        code = (code << 1) | readBit();
        if (code >= 0x190 && code <= 0x1FF) {
          out.push(144 + code - 0x190); // literal 144–255
          continue;
        }
        break loop; // unrecognised
      }
    }
    // BTYPE=2 (dynamic Huffman): not implemented — caller gets empty output
    // and falls back to neutral luminance 128.
  }
  return new Uint8Array(out);
}

// ── PNG chunk parser ──────────────────────────────────────────────────────────

function parsePngIdat(bytes: Uint8Array): Uint8Array | null {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return null;

  const parts: Uint8Array[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = ((bytes[pos] << 24) | (bytes[pos+1] << 16) |
                 (bytes[pos+2] << 8)  |  bytes[pos+3]) >>> 0;
    const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7]);
    if (type === 'IDAT') parts.push(bytes.slice(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (parts.length === 0) return null;

  let total = 0;
  for (const p of parts) total += p.length;
  const combined = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { combined.set(p, off); off += p.length; }

  try { return inflate(combined); } catch { return null; }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Estimates the average perceived luminance (0–255) of the image at `uri`.
 *
 * Resize → 1×1 PNG → parse IDAT → extract RGB → standard luminance formula.
 * Returns 128 (neutral) on any failure so the caller always gets a value.
 */
/**
 * Samples the average color of the image at `uri` and returns it as a hex
 * string (e.g. '#8A9B6C'), or null on any failure.
 *
 * Same sampling technique as the share-card bar theming:
 * - Native: expo-image-manipulator resize → 1×1 PNG → parse IDAT → RGB.
 *   (A 1×1 bilinear resize IS the average color of the image.)
 * - Web: draw into a 1×1 canvas and read the pixel back.
 *
 * The result is computed ONCE at compose time and persisted with the post, so
 * every surface (editor, feed, detail, share cards) renders the identical fill.
 */
export async function computeAverageColor(uri: string): Promise<string | null> {
  const toHex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

  // Web: 1×1 canvas average.
  if (typeof document !== 'undefined') {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new (window as any).Image() as HTMLImageElement;
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = uri;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return toHex(d[0], d[1], d[2]);
    } catch {
      return null;
    }
  }

  // Native: 1×1 PNG parse (same pipeline as computeNativeLuminance).
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1, height: 1 } }],
      { format: ImageManipulator.SaveFormat.PNG, base64: true },
    );
    if (!result.base64) return null;

    const binary = atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const raw = parsePngIdat(bytes);
    if (!raw || raw.length < 4) return null;
    return toHex(raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0);
  } catch {
    return null;
  }
}

export async function computeNativeLuminance(uri: string): Promise<number> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1, height: 1 } }],
      { format: ImageManipulator.SaveFormat.PNG, base64: true },
    );
    if (!result.base64) return 128;

    // atob is available on both Hermes (RN) and web.
    const binary = atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const raw = parsePngIdat(bytes);
    if (!raw || raw.length < 4) return 128;

    // Raw scanline for 1×1: [filter_byte, R, G, B, (A)?]
    // filter byte is always index 0; pixel bytes start at index 1.
    const r = raw[1] ?? 0;
    const g = raw[2] ?? 0;
    const b = raw[3] ?? 0;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  } catch {
    return 128;
  }
}
