/**
 * Admin routes — cron section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { purgeSoftDeletedPets } from "../../lib/purgePets.js";
import { purgeDeletedComments } from "../../lib/purgeDeletedComments.js";
import { processClerkDeletions } from "../../lib/clerkDeletions.js";

const adminRouter = Router();

// ─── Cron: purge soft-deleted rows ────────────────────────────────────────────

/**
 * GET /admin/cron/purge
 *
 * Hard-deletes rows that passed their 30-day soft-delete grace period:
 *   • Pets (and their posts, reactions, pack-follows, ownership records, R2 media)
 *   • Comments (no media — straight DB delete)
 *
 * NOT behind the requireRole("admin") middleware — this is called by an external
 * scheduler, not an authenticated user.  Instead it checks X-Purge-Secret against
 * the PURGE_SECRET environment variable.  If PURGE_SECRET is unset the route is
 * disabled (returns 503) so it cannot be accidentally invoked in development.
 *
 * Scheduling (set schedule to "0 3 * * *" — 03:00 UTC daily):
 *   Render:       create a Cron Job service pointing at GET /admin/cron/purge
 *   Vercel:       add { "path": "/api/admin/cron/purge", "schedule": "0 3 * * *" } to vercel.json
 *   Self-hosted:  node-cron inside the server process calling this URL with the secret header
 */
adminRouter.get("/admin/cron/purge", async (req, res) => {
  const secret = process.env["PURGE_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "PURGE_SECRET not configured — cron route disabled" });
    return;
  }
  // Timing-safe comparison (same pattern as verifyMediaToken in lib/r2.ts).
  // Both values are hashed to a fixed length first so timingSafeEqual never
  // throws on length mismatch and no length information leaks via timing.
  const provided = req.headers["x-purge-secret"];
  const providedHash = createHash("sha256").update(typeof provided === "string" ? provided : "").digest();
  const expectedHash = createHash("sha256").update(secret).digest();
  if (typeof provided !== "string" || !timingSafeEqual(providedHash, expectedHash)) {
    res.status(401).json({ error: "Invalid or missing X-Purge-Secret header" });
    return;
  }

  // Per-operation error isolation: one failing purge job must not hide the
  // outcome of the others. Each result is reported independently; the request
  // returns 500 only if every operation failed, 207-style ok:false otherwise.
  const [pets, comments, clerkDeletions] = await Promise.allSettled([
    purgeSoftDeletedPets(),
    purgeDeletedComments(),
    processClerkDeletions(),
  ]);

  // Log the real rejection server-side; return only a stable public code —
  // this endpoint is externally reachable and must not echo provider/DB
  // error text (query fragments, service identifiers) to the caller.
  const logFailure = (op: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected") console.error(`[cron/purge] ${op} failed:`, r.reason);
  };
  logFailure("pet purge", pets);
  logFailure("comment purge", comments);
  logFailure("clerk deletions", clerkDeletions);

  const failures = [pets, comments, clerkDeletions].filter(
    (r) => r.status === "rejected",
  );

  res.status(failures.length === 3 ? 500 : 200).json({
    ok: failures.length === 0,
    purged: {
      pets:     pets.status     === "fulfilled" ? pets.value.purged     : { error: "pet purge failed" },
      comments: comments.status === "fulfilled" ? comments.value.purged : { error: "comment purge failed" },
    },
    clerkDeletions:
      clerkDeletions.status === "fulfilled" ? clerkDeletions.value : { error: "clerk deletions failed" },
  });
});


export default adminRouter;
