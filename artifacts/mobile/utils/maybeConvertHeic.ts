/**
 * Native (iOS / Android) HEIC handling — intentional no-op.
 * Metro resolves this file on native and maybeConvertHeic.web.ts on web.
 *
 * expo-image-manipulator decodes HEIC/HEIF natively and the existing
 * compressImage step already re-encodes everything to JPEG, so no
 * conversion pre-step is needed on native.
 */

export async function maybeConvertHeic(uri: string, _mimeType?: string): Promise<string> {
  return uri;
}
