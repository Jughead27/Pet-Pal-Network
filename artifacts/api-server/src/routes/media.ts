/**
 * GET /media/*
 *
 * Stable authenticated media proxy.  Every feed/pet API response returns
 * /api/media/<key>?exp=<ts>&t=<hmac> instead of a perishable presigned URL,
 * so cached responses never expire.  This route validates the HMAC token,
 * issues a fresh short-lived presigned R2 GET, and responds 302.
 *
 * Auth: HMAC-SHA256 token in query params (no Clerk session needed — the
 * token binds the key + expiry and is issued server-side in feed/pet responses).
 * Cache-Control: public, max-age=300 — 5-minute client cache so fast
 * scrolling doesn't re-hit the API on every frame.
 *
 * ?inline=1 — streams the object bytes directly (no redirect) with
 * Access-Control-Allow-Origin: * so web Canvas composition can draw the image
 * without CORS errors.  Used by the share-card generator on web.
 */

import { Router } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET, presignGet, verifyMediaToken } from "../lib/r2.js";
import type { Readable } from "stream";

const router = Router();

// path-to-regexp v8 (Express 5 / router@2) requires named wildcards.
// Using a regex route avoids any version-specific wildcard syntax entirely.
router.get(/^\/media\/(.+)$/, async (req, res) => {
  // First capture group = everything after /media/
  const key = (req.params as unknown as string[])[0];
  const { exp, t, inline } = req.query as { exp?: string; t?: string; inline?: string };

  // Reject obviously bad keys before touching crypto
  if (!key || key.includes("..")) {
    res.status(400).json({ error: "Invalid media key" });
    return;
  }

  if (!exp || !t || !verifyMediaToken(key, exp, t)) {
    res.status(403).json({ error: "Invalid or expired media token" });
    return;
  }

  const CACHE = "public, max-age=300, stale-while-revalidate=60";

  // ?inline=1 — stream bytes directly so web Canvas can draw the image.
  // A 302 → cross-origin R2 URL triggers a CORS preflight that R2 rejects
  // for credentialed requests; streaming here avoids that entirely.
  if (inline === "1") {
    const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!obj.Body) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Content-Type", obj.ContentType ?? "image/jpeg");
    res.setHeader("Cache-Control", CACHE);
    res.setHeader("Access-Control-Allow-Origin", "*");
    (obj.Body as Readable).pipe(res);
    return;
  }

  const presignedUrl = await presignGet(key);
  if (!presignedUrl) {
    // presignGet returns null only for seed: keys — shouldn't reach here
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.setHeader("Cache-Control", CACHE);
  res.redirect(302, presignedUrl);
});

export default router;
