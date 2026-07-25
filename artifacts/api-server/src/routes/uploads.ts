import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { PresignUploadBody } from "@workspace/api-zod";
import { presignPut } from "../lib/r2.js";

const router: IRouter = Router();

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

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
  const parsed = PresignUploadBody.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { contentType, sizeBytes } = parsed.data;
  const ext      = EXT[contentType]!;
  const mediaKey = `posts/${randomUUID()}.${ext}`;

  const uploadUrl = await presignPut(mediaKey, contentType, sizeBytes);
  res.json({ uploadUrl, mediaKey });
});

export default router;
