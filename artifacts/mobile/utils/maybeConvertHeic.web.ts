/**
 * Web HEIC/HEIF → JPEG conversion pre-step.
 * Metro resolves this file on web instead of maybeConvertHeic.ts.
 *
 * The canvas-based compressImage pipeline can't decode HEIC in most
 * browsers, so HEIC files are decoded to a JPEG blob first via heic2any —
 * LAZY-imported only when a picked file is actually detected as HEIC, so
 * non-iPhone users never download the wasm decoder.
 *
 * Detection is bytes-first (ISO-BMFF `ftyp` box with a HEIC/HEIF brand),
 * falling back to the reported MIME type — browsers often report an empty
 * type for HEIC files.
 *
 * Non-HEIC input is returned untouched; JPEG/PNG/WebP behavior is unchanged.
 */

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'];

function isHeicBytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf);
  // bytes 4–7 must be "ftyp"
  if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false;
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
  return HEIC_BRANDS.includes(brand);
}

export async function maybeConvertHeic(uri: string, mimeType?: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();

  const mimeSaysHeic  = /hei[cf]/i.test(mimeType ?? '') || /hei[cf]/i.test(blob.type);
  const bytesSayHeic  = isHeicBytes(await blob.slice(0, 12).arrayBuffer());

  if (!mimeSaysHeic && !bytesSayHeic) return uri;

  // Lazy-load the decoder only now that we know it's needed.
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
  const jpegBlob  = Array.isArray(converted) ? converted[0] : converted;
  return URL.createObjectURL(jpegBlob as Blob);
}
