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
 */

import { Router } from "express";
import { presignGet, verifyMediaToken } from "../lib/r2.js";

const router = Router();

// path-to-regexp v8 (Express 5 / router@2) requires named wildcards.
// Using a regex route avoids any version-specific wildcard syntax entirely.
router.get(/^\/media\/(.+)$/, async (req, res) => {
  // First capture group = everything after /media/
  const key = (req.params as unknown as string[])[0];
  const { exp, t } = req.query as { exp?: string; t?: string };

  // Reject obviously bad keys before touching crypto
  if (!key || key.includes("..")) {
    res.status(400).json({ error: "Invalid media key" });
    return;
  }

  if (!exp || !t || !verifyMediaToken(key, exp, t)) {
    res.status(403).json({ error: "Invalid or expired media token" });
    return;
  }

  const presignedUrl = await presignGet(key);
  if (!presignedUrl) {
    // presignGet returns null only for seed: keys — shouldn't reach here
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  res.redirect(302, presignedUrl);
});

export default router;
