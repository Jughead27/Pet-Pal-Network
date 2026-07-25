/**
 * R2 client and presign helpers.
 *
 * Uses the S3-compatible Cloudflare R2 endpoint.
 * Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

/**
 * Best-effort delete of an R2 object.
 * Silently skips seed: keys (no real object behind them).
 * Throws on network/auth failures — callers should catch and log.
 */
export async function deleteObject(key: string): Promise<void> {
  if (key.startsWith("seed:")) return;
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
