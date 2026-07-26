/**
 * /me — owner profile endpoints.
 *
 * GET  /me  — returns the signed-in user's profile fields.
 * PATCH /me  — updates username, display_name, location_city, about
 *              with full server-side validation.
 */

import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql, and, ne } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

// ─── Validation constants ─────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z][a-z0-9._]{2,19}$/;

const RESERVED = new Set([
  "admin",
  "administrator",
  "mod",
  "moderator",
  "staff",
  "support",
  "help",
  "official",
  "root",
  "system",
  "pshpsh",
  "pshpshapp",
  "petpal",
  "petpalnetwork",
]);

function validateUsername(raw: string): string | null {
  const u = raw.toLowerCase();
  if (!USERNAME_RE.test(u)) {
    return "Username must be 3–20 characters, start with a letter, and use only letters, numbers, periods, and underscores.";
  }
  if (/[._]{2}/.test(u)) {
    return "Username cannot contain consecutive periods or underscores.";
  }
  if (/[._]$/.test(u)) {
    return "Username cannot end with a period or underscore.";
  }
  if (RESERVED.has(u)) {
    return "That username is reserved.";
  }
  return null;
}

// ─── GET /me ─────────────────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const [user] = await db
    .select({
      id:           usersTable.id,
      username:     usersTable.username,
      displayName:  usersTable.displayName,
      locationCity: usersTable.locationCity,
      about:        usersTable.about,
      createdAt:    usersTable.createdAt,
      role:         usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id:           user.id,
    username:     user.username    ?? null,
    displayName:  user.displayName ?? null,
    locationCity: user.locationCity ?? null,
    about:        user.about       ?? null,
    createdAt:    user.createdAt.toISOString(),
    role:         user.role,
  });
});

// ─── PATCH /me ───────────────────────────────────────────────────────────────

router.patch("/me", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;
  const body = req.body as Record<string, unknown>;

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  // ── username ──────────────────────────────────────────────────────────────
  if ("username" in body) {
    const raw = body.username;
    if (typeof raw !== "string" || raw.trim() === "") {
      res.status(400).json({ error: "Username must be a non-empty string." });
      return;
    }
    const lower = raw.toLowerCase();
    const err = validateUsername(lower);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }

    // Case-insensitive uniqueness check (exclude self)
    const [taken] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          sql`lower(${usersTable.username}) = ${lower}`,
          ne(usersTable.id, userId),
        ),
      );

    if (taken) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }

    updates.username = lower;
  }

  // ── display_name ──────────────────────────────────────────────────────────
  if ("displayName" in body) {
    const raw = body.displayName;
    if (raw === null || raw === undefined) {
      updates.displayName = null;
    } else if (typeof raw !== "string") {
      res.status(400).json({ error: "displayName must be a string or null." });
      return;
    } else {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        updates.displayName = null;
      } else if (trimmed.length > 40) {
        res.status(400).json({ error: "Owner name must be 40 characters or fewer." });
        return;
      } else {
        updates.displayName = trimmed;
      }
    }
  }

  // ── location_city ─────────────────────────────────────────────────────────
  if ("locationCity" in body) {
    const raw = body.locationCity;
    if (raw === null || raw === undefined) {
      updates.locationCity = null;
    } else if (typeof raw !== "string") {
      res.status(400).json({ error: "locationCity must be a string or null." });
      return;
    } else {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        updates.locationCity = null;
      } else if (trimmed.length > 60) {
        res.status(400).json({ error: "City must be 60 characters or fewer." });
        return;
      } else {
        updates.locationCity = trimmed;
      }
    }
  }

  // ── about ─────────────────────────────────────────────────────────────────
  if ("about" in body) {
    const raw = body.about;
    if (raw === null || raw === undefined) {
      updates.about = null;
    } else if (typeof raw !== "string") {
      res.status(400).json({ error: "about must be a string or null." });
      return;
    } else {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        updates.about = null;
      } else if (trimmed.length > 200) {
        res.status(400).json({ error: "About must be 200 characters or fewer." });
        return;
      } else {
        updates.about = trimmed;
      }
    }
  }

  // Nothing to update — return current state
  if (Object.keys(updates).length === 0) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id:           user.id,
      username:     user.username    ?? null,
      displayName:  user.displayName ?? null,
      locationCity: user.locationCity ?? null,
      about:        user.about       ?? null,
      createdAt:    user.createdAt.toISOString(),
    });
    return;
  }

  // Apply updates
  try {
    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id:           updated.id,
      username:     updated.username    ?? null,
      displayName:  updated.displayName ?? null,
      locationCity: updated.locationCity ?? null,
      about:        updated.about       ?? null,
      createdAt:    updated.createdAt.toISOString(),
    });
  } catch (err: unknown) {
    // Unique constraint violation (race condition on username)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("users_username_lower_idx") || msg.includes("unique")) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }
    logger.error({ err, userId }, "PATCH /me failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
