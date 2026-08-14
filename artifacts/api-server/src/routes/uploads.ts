import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { PresignUploadBody } from "@workspace/api-zod";
import { presignPut, getObjectFirstBytes, deleteObject } from "../lib/r2.js";

const router: IRouter = Router();

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

// ── Per-user rate limiting ────────────────────────────────────────────────────
// Same in-memory map pattern used by reports.ts (per-user) and invites.ts
// (per-IP): 30 requests per minute per user, resets on server restart.
// Applied to presign, presign-avatar, and verify.
const uploadLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = uploadLimiter.get(userId);
  if (!entry || now > entry.resetAt) {
    uploadLimiter.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count += 1;
  return true;
}

/** Authenticated user id from the auth middleware (never client-supplied). */
function authedUserId(req: Express.Request): string {
  return (req as Express.RequestWithAuth).auth!.userId;
}

/**
 * POST /uploads/presign
 *
 * Returns a short-lived (5 min) presigned PUT URL for direct R2 upload,
 * plus the media key to pass to POST /posts.
 *
 * Validates:
 *   - contentType ∈ { image/jpeg, image/png, image/webp }
 *   - sizeBytes ≤ 10 MB
 */
router.post("/uploads/presign", async (req, res) => {
  const userId = authedUserId(req);
  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "too many requests. try again later." });
    return;
  }

  const parsed = PresignUploadBody.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { contentType, sizeBytes } = parsed.data;
  const ext      = EXT[contentType]!;
  // Key is bound to the authenticated user: posts/{userId}/{uuid}.{ext}.
  // /uploads/verify enforces that the userId segment matches the caller.
  const mediaKey = `posts/${userId}/${randomUUID()}.${ext}`;

  const uploadUrl = await presignPut(mediaKey, contentType, sizeBytes);
  res.json({ uploadUrl, mediaKey });
});

/**
 * POST /uploads/presign-avatar
 *
 * Returns a short-lived (5 min) presigned PUT URL for direct R2 upload of
 * an avatar image, plus the media key (under avatars/ prefix) to pass to
 * PATCH /pets/:id/avatar.
 *
 * Same validation as /uploads/presign.
 */
router.post("/uploads/presign-avatar", async (req, res) => {
  const userId = authedUserId(req);
  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "too many requests. try again later." });
    return;
  }

  const parsed = PresignUploadBody.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { contentType, sizeBytes } = parsed.data;
  const ext      = EXT[contentType]!;
  // Key is bound to the authenticated user: avatars/{userId}/{uuid}.{ext}.
  const mediaKey = `avatars/${userId}/${randomUUID()}.${ext}`;

  const uploadUrl = await presignPut(mediaKey, contentType, sizeBytes);
  res.json({ uploadUrl, mediaKey });
});

// ─── Magic-byte signatures for allowed image types ────────────────────────────
// JPEG:  FF D8 FF
// PNG:   89 50 4E 47 0D 0A 1A 0A
// WEBP:  52 49 46 46 ?? ?? ?? ?? 57 45 42 50  (RIFF????WEBP)

function detectImageMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WEBP: RIFF at 0–3, WEBP at 8–11
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  return false;
}

const VALID_KEY_PREFIX = /^(posts|avatars)\//;

/**
 * POST /uploads/verify
 *
 * Called by the client after a successful presigned PUT to R2.
 * Fetches the first 12 bytes of the uploaded object and checks the binary
 * signature against known image magic bytes (JPEG / PNG / WebP).
 *
 * On failure:  deletes the R2 object and returns 400.
 * On success:  returns { ok: true }.
 *
 * This is the actual security boundary — client-side MIME checks are
 * bypassable; this check runs server-side on the real bytes.
 */
router.post("/uploads/verify", async (req, res) => {
  const userId = authedUserId(req);
  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "too many requests. try again later." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const mediaKey = body.mediaKey;

  if (typeof mediaKey !== "string" || !VALID_KEY_PREFIX.test(mediaKey)) {
    res.status(400).json({ error: "mediaKey must be a string starting with posts/ or avatars/" });
    return;
  }

  // ── Ownership check ─────────────────────────────────────────────────────
  // New-format keys embed the owner: {prefix}/{userId}/{uuid}.{ext} (3
  // segments). The userId segment must match the caller. Legacy pre-fix keys
  // ({prefix}/{uuid}.{ext} — 2 segments) carry no owner and are exempt so
  // existing posts/avatars keep working. Generic 403 — never reveal whether
  // the key exists or whom it belongs to.
  const segments = mediaKey.split("/");
  if (segments.length >= 3 && segments[1] !== userId) {
    res.status(403).json({ error: "You do not have permission to verify this upload." });
    return;
  }

  const bytes = await getObjectFirstBytes(mediaKey, 12);
  if (!bytes) {
    res.status(400).json({ error: "File not found in storage — upload may have failed." });
    return;
  }

  if (!detectImageMagicBytes(bytes)) {
    // Delete the invalid object so it can't be referenced later
    await deleteObject(mediaKey).catch(() => { /* best-effort */ });
    res.status(400).json({ error: "File is not a valid image (JPEG, PNG, or WebP required)." });
    return;
  }

  res.json({ ok: true });
});

export default router;
