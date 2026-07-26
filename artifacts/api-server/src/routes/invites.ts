import { Router, type IRouter } from "express";
import { db, inviteRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// ── In-memory IP rate limiter ─────────────────────────────────────────────────
// Simple: max 5 invite submissions per IP per hour, resets on server restart.
const limiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = limiter.get(ip);
  if (!entry || now > entry.resetAt) {
    limiter.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count += 1;
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/invites/request
 *
 * Public endpoint — no auth required.
 * Accepts an invite request (email + optional pet note).
 * Duplicate email → kind 200 response (no error tone).
 * Rate limited by IP: 5 requests / hour.
 */
router.post("/invites/request", async (req, res) => {
  // Prefer X-Forwarded-For when behind a proxy (Replit/Cloudflare).
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  if (!checkRateLimit(ip)) {
    res.status(429).json({
      ok: false,
      error: "too many requests. try again later.",
    });
    return;
  }

  const { email, note } = req.body as { email?: string; note?: string };

  if (!email || typeof email !== "string" || !email.trim()) {
    res.status(400).json({ ok: false, error: "email is required." });
    return;
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmedEmail)) {
    res
      .status(400)
      .json({ ok: false, error: "please enter a valid email address." });
    return;
  }

  // Silently clamp note to 200 chars (client enforces too, belt-and-suspenders).
  const trimmedNote =
    typeof note === "string" ? note.trim().slice(0, 200) : null;

  // Duplicate email → kind message, not an error tone.
  const [existing] = await db
    .select({ id: inviteRequestsTable.id })
    .from(inviteRequestsTable)
    .where(eq(inviteRequestsTable.email, trimmedEmail))
    .limit(1);

  if (existing) {
    res.json({ ok: true, duplicate: true });
    return;
  }

  await db.insert(inviteRequestsTable).values({
    email: trimmedEmail,
    note: trimmedNote || null,
  });

  res.status(201).json({ ok: true });
});

export default router;
