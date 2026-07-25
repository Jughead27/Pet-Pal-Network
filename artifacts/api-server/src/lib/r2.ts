/**
 * R2 client and presign helpers.
 *
 * Uses the S3-compatible Cloudflare R2 endpoint.
 * Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, timingSafeEqual } from "crypto";

export const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "petproject-media";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

/**
 * Presigned PUT URL for direct client upload.
 * Expires in 5 minutes.
 */
export function presignPut(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  return getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket:        R2_BUCKET,
      Key:           key,
      ContentType:   contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: 300 },
  );
}

/**
 * Presigned GET URL for serving an object.
 * Returns null for seed: keys (resolved client-side from bundled assets).
 * Expires in 1 hour.
 */
export async function presignGet(mediaKey: string): Promise<string | null> {
  if (mediaKey.startsWith("seed:")) return null;
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: mediaKey }),
    { expiresIn: 3600 },
  );
}

// ── Stable media URL helpers ──────────────────────────────────────────────────
// Instead of shipping perishable presigned URLs in API responses, every
// feed/pet response returns a stable /api/media/<key>?exp=<ts>&t=<hmac> URL.
// The /api/media route validates the HMAC and issues a fresh presigned redirect.
// Token expiry: 48 h — well beyond any realistic browsing session.

const MEDIA_EXPIRY_S = 60 * 60 * 48;

/**
 * Returns a stable `/api/media/…` URL for a media key, signed with
 * SESSION_SECRET so only the server can issue valid tokens.
 * Returns null for seed: keys (those use bundled local assets).
 */
export function mediaTokenUrl(mediaKey: string): string | null {
  if (mediaKey.startsWith("seed:")) return null;
  const secret = process.env.SESSION_SECRET ?? "";
  const exp    = Math.floor(Date.now() / 1000) + MEDIA_EXPIRY_S;
  const t      = createHmac("sha256", secret)
    .update(`${mediaKey}:${exp}`)
    .digest("hex");
  // Encode each path segment individually so slashes stay as path separators.
  const urlKey = mediaKey.split("/").map(encodeURIComponent).join("/");
  return `/api/media/${urlKey}?exp=${exp}&t=${t}`;
}

/**
 * Verifies an HMAC media token.  Returns false on any mismatch or if the
 * token has expired.  Uses a timing-safe comparison to prevent oracle attacks.
 */
export function verifyMediaToken(key: string, exp: string, t: string): boolean {
  const expNum = parseInt(exp, 10);
  if (isNaN(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const secret   = process.env.SESSION_SECRET ?? "";
  const expected = createHmac("sha256", secret)
    .update(`${key}:${exp}`)
    .digest("hex");
  try {
    const tBuf = Buffer.from(t,        "hex");
    const eBuf = Buffer.from(expected, "hex");
    if (tBuf.length !== eBuf.length) return false;
    return timingSafeEqual(tBuf, eBuf);
  } catch {
    return false;
  }
}

/**
 * Server-side copy of an R2 object within the same bucket.
 * Used to duplicate a posts/ media key into avatars/ so that deleting
 * the source post can never orphan the avatar.
 */
export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
  await r2.send(
    new CopyObjectCommand({
      Bucket:     R2_BUCKET,
      CopySource: `${R2_BUCKET}/${sourceKey}`,
      Key:        destKey,
    }),
  );
}

/**
 * Best-effort delete of an R2 object.
 * Silently skips seed: keys (no real object behind them).
 * Throws on network/auth failures — callers should catch and log.
 */
export async function deleteObject(key: string): Promise<void> {
  if (key.startsWith("seed:")) return;
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
