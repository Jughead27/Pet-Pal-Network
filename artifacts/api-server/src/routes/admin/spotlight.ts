/**
 * Admin routes — spotlight section. Extracted verbatim from routes/admin.ts
 * (pure structural split; mounted by the composer in ../admin.ts).
 */

import { Router } from "express";
import {
  db,
  usersTable,
  petsTable,
  configTable,
  spotlightStateTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { writeAudit } from "../../lib/writeAudit.js";
import { deleteAccount } from "../../lib/deleteAccount.js";
import { resolveSpotlightPet, getSpotlightWindowDays } from "../../lib/spotlight.js";

const adminRouter = Router();

// ─── Spotlight (featured pet) management ─────────────────────────────────────

/**
 * GET /admin/spotlight
 *
 * Current spotlight state for the admin screen: mode, pinned pet (when
 * manual), the currently-resolved pet (what members are seeing), and the
 * auto-resolution window in days.
 */
adminRouter.get("/admin/spotlight", async (_req, res) => {
  const [state] = await db.select().from(spotlightStateTable).limit(1);

  const [resolvedPet, windowDays] = await Promise.all([
    resolveSpotlightPet(),
    getSpotlightWindowDays(),
  ]);

  let pinnedPet: { id: string; name: string } | null = null;
  if (state?.mode === "manual" && state.pinnedPetId) {
    const [pet] = await db
      .select({ id: petsTable.id, name: petsTable.name })
      .from(petsTable)
      .where(eq(petsTable.id, state.pinnedPetId));
    pinnedPet = pet ?? null;
  }

  res.json({
    mode: state?.mode ?? "auto",
    pinnedPet,
    resolvedPet: resolvedPet ? { id: resolvedPet.id, name: resolvedPet.name, coverPhotoUrl: resolvedPet.coverPhotoUrl } : null,
    windowDays,
  });
});

/**
 * POST /admin/spotlight/pin — body { petId }
 * Sets mode='manual' + pinned pet. Audit: spotlight.pin { petId }.
 */
adminRouter.post("/admin/spotlight/pin", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;
  const petId = typeof req.body?.petId === "string" ? req.body.petId : "";

  if (!petId) {
    res.status(400).json({ error: "petId is required" });
    return;
  }

  const [pet] = await db
    .select({ id: petsTable.id, name: petsTable.name })
    .from(petsTable)
    .where(sql`${petsTable.id}::text = ${petId}`);
  if (!pet) {
    res.status(404).json({ error: "Pet not found" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(spotlightStateTable)
      .set({
        mode:         "manual",
        pinnedPetId:  pet.id,
        setByAdminId: actorId,
        setAt:        new Date(),
        updatedAt:    new Date(),
      });
    await writeAudit(tx, actorId, "spotlight.pin", "pet", pet.id, { petId: pet.id });
  });

  res.json({ ok: true, mode: "manual", pinnedPet: pet });
});

/**
 * POST /admin/spotlight/clear — reverts to mode='auto'. Audit: spotlight.clear.
 */
adminRouter.post("/admin/spotlight/clear", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;

  await db.transaction(async (tx) => {
    await tx
      .update(spotlightStateTable)
      .set({
        mode:         "auto",
        pinnedPetId:  null,
        setByAdminId: actorId,
        setAt:        new Date(),
        updatedAt:    new Date(),
      });
    await writeAudit(tx, actorId, "spotlight.clear", null, null, null);
  });

  res.json({ ok: true, mode: "auto" });
});

/**
 * PATCH /admin/spotlight/config — body { windowDays }
 * Positive integer ≤ 90. Audit: spotlight.config_update { windowDays }.
 */
adminRouter.patch("/admin/spotlight/config", async (req, res) => {
  const { userId: actorId } = (req as Express.RequestWithAuth).auth!;
  const windowDays = req.body?.windowDays;

  if (typeof windowDays !== "number" || !Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    res.status(400).json({ error: "windowDays must be an integer between 1 and 90" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(configTable)
      .values({ key: "spotlight_window_days", value: String(windowDays) })
      .onConflictDoUpdate({
        target: configTable.key,
        set:    { value: String(windowDays) },
      });
    await writeAudit(tx, actorId, "spotlight.config_update", null, null, { windowDays });
  });

  res.json({ ok: true, windowDays });
});

/**
 * POST /admin/users/:userId/delete
 *
 * Admin-triggered account deletion (enforcement cases). Runs the same shared
 * deleteAccount() routine as the self-serve flow; Clerk hard delete follows
 * after the grace period via the cron. Admins cannot delete their own account
 * through this route (use the self-serve flow), and cannot delete other admins.
 * Audit: user.deleted (written inside deleteAccount's transaction).
 */
adminRouter.post("/admin/users/:userId/delete", async (req, res) => {
  const { userId: targetUserId } = req.params;
  const { userId: actorId }      = (req as Express.RequestWithAuth).auth!;

  if (targetUserId === actorId) {
    res.status(400).json({ error: "Use the self-serve flow to delete your own account" });
    return;
  }

  const [target] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (target?.role === "admin") {
    res.status(403).json({ error: "Cannot delete an admin account" });
    return;
  }

  const result = await deleteAccount(targetUserId, actorId, "admin");
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json({ ok: true, userId: targetUserId });
});

/**
 * GET /admin/suspended-users
 *
 * Read-only list of currently suspended accounts so admins can find and
 * unsuspend them from the UI (the unsuspend action itself already exists).
 */
adminRouter.get("/admin/suspended-users", async (_req, res) => {
  const rows = await db
    .select({
      id:          usersTable.id,
      username:    usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(eq(usersTable.suspended, true));

  res.json({ users: rows });
});

export default adminRouter;
