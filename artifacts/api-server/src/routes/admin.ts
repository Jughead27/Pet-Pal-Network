/**
 * Admin router — all routes require role "admin".
 *
 * Surfaces:
 *   GET  /admin/ping                          — liveness probe
 *   GET  /admin/reports                       — pending reports triage list
 *   POST /admin/reports/:id/dismiss           — resolve, content untouched
 *   POST /admin/reports/:id/hide              — set hidden_by_admin on content + resolve
 *   POST /admin/reports/:id/suspend           — suspend content owner + resolve
 *   POST /admin/users/:userId/unsuspend       — lift suspension
 *   GET  /admin/invite-requests               — all invite requests
 *   POST /admin/invite-requests/:id/contact  — mark contacted
 *   POST /admin/invite-requests/:id/close    — close request
 *   GET  /admin/breed-suggestions             — distinct free-text breed submissions
 *   POST /admin/breed-suggestions/approve    — create breed in taxonomy, remap pets
 *   POST /admin/breed-suggestions/reject     — clear free-text breed from pets
 *
 * Audit-log hooks: every mutating handler is structured so a logging wrapper
 * can be inserted before the final res.json() without changing business logic.
 */

import { Router } from "express";
import {
  db,
  reportsTable,
  usersTable,
  postsTable,
  commentsTable,
  petsTable,
  inviteRequestsTable,
  speciesTable,
  breedsTable,
} from "@workspace/db";
import { eq, asc, sql, and, isNull } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { mediaTokenUrl } from "../lib/r2.js";

const adminRouter = Router();

// ─── Role gate ────────────────────────────────────────────────────────────────
// Every route in this router requires admin role.  Applied once here so
// individual handlers don't need to repeat the guard.
adminRouter.use(requireRole("admin"));

// ─── Ping ─────────────────────────────────────────────────────────────────────
adminRouter.get("/admin/ping", (_req, res) => {
  res.json({ ok: true, role: "admin" });
});

// ─── Reports triage ───────────────────────────────────────────────────────────

/**
 * GET /admin/reports
 *
 * Returns all pending reports.
 * Sort: animal_cruelty first, then oldest-first.
 * Each row includes a target preview (post thumbnail + caption, or comment text)
 * and the reporter's username, note, and age.
 */
adminRouter.get("/admin/reports", async (_req, res) => {
  // Use raw SQL for the multi-table conditional join (posts OR comments per row).
  // Drizzle's fluent API doesn't support conditional ON clauses well.
  const rows = await db.execute(sql`
    SELECT
      r.id,
      r.target_type         AS "targetType",
      r.target_id           AS "targetId",
      r.reason,
      r.note,
      r.created_at          AS "createdAt",
      reporter.username     AS "reporterUsername",
      p.caption             AS "postCaption",
      p.media_key           AS "postMediaKey",
      p.hidden_by_admin     AS "postHiddenByAdmin",
      pet_t.owner_id        AS "postOwnerId",
      c.text                AS "commentText",
      c.hidden_by_admin     AS "commentHiddenByAdmin",
      c.user_id             AS "commentAuthorId"
    FROM reports r
    INNER JOIN users reporter ON reporter.id = r.reporter_id
    LEFT JOIN posts p ON r.target_type = 'post'
                     AND p.id::text = r.target_id
    LEFT JOIN pets pet_t ON r.target_type = 'post'
                        AND pet_t.id = p.pet_id
    LEFT JOIN comments c ON r.target_type = 'comment'
                        AND c.id::text = r.target_id
    WHERE r.status = 'pending'
    ORDER BY
      CASE WHEN r.reason = 'animal_cruelty' THEN 0 ELSE 1 END,
      r.created_at ASC
  `);

  const reports = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id:              r.id,
    targetType:      r.targetType,
    targetId:        r.targetId,
    reason:          r.reason,
    note:            r.note ?? null,
    createdAt:       r.createdAt,
    reporterUsername: r.reporterUsername ?? null,
    targetPreview:
      r.targetType === "post"
        ? {
            type:         "post",
            caption:      r.postCaption ?? null,
            mediaUrl:     r.postMediaKey ? mediaTokenUrl(r.postMediaKey as string) : null,
            hiddenByAdmin: Boolean(r.postHiddenByAdmin),
          }
        : {
            type:         "comment",
            text:         r.commentText ?? null,
            hiddenByAdmin: Boolean(r.commentHiddenByAdmin),
          },
    contentOwnerId:
      r.targetType === "post"
        ? (r.postOwnerId ?? null)
        : (r.commentAuthorId ?? null),
  }));

  res.json({ reports });
});

/**
 * POST /admin/reports/:id/dismiss
 *
 * Resolves the report without touching the content.
 */
adminRouter.post("/admin/reports/:id/dismiss", async (req, res) => {
  const { id } = req.params;

  const [updated] = await db
    .update(reportsTable)
    .set({ status: "resolved" })
    .where(eq(reportsTable.id, id))
    .returning({ id: reportsTable.id });

  if (!updated) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  res.json({ ok: true, id, action: "dismiss" });
});

/**
 * POST /admin/reports/:id/hide
 *
 * Sets hidden_by_admin on the target post or comment, then resolves the report.
 * Idempotent: re-hiding already-hidden content still resolves the report.
 */
adminRouter.post("/admin/reports/:id/hide", async (req, res) => {
  const { id } = req.params;

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, id))
    .limit(1);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  // Hide the content
  if (report.targetType === "post") {
    await db
      .update(postsTable)
      .set({ hiddenByAdmin: true })
      .where(sql`${postsTable.id}::text = ${report.targetId}`);
  } else {
    await db
      .update(commentsTable)
      .set({ hiddenByAdmin: true })
      .where(sql`${commentsTable.id}::text = ${report.targetId}`);
  }

  // Resolve report
  await db
    .update(reportsTable)
    .set({ status: "resolved" })
    .where(eq(reportsTable.id, id));

  res.json({ ok: true, id, action: "hide", targetType: report.targetType });
});

/**
 * POST /admin/reports/:id/suspend
 *
 * Suspends the owner of the reported content, then resolves the report.
 * For a post report: suspends the pet's owner.
 * For a comment report: suspends the comment's author.
 */
adminRouter.post("/admin/reports/:id/suspend", async (req, res) => {
  const { id } = req.params;

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, id))
    .limit(1);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  // Resolve the content owner's user ID
  let ownerUserId: string | null = null;

  if (report.targetType === "post") {
    const [row] = await db
      .select({ ownerId: petsTable.ownerId })
      .from(postsTable)
      .innerJoin(petsTable, eq(petsTable.id, postsTable.petId))
      .where(sql`${postsTable.id}::text = ${report.targetId}`)
      .limit(1);
    ownerUserId = row?.ownerId ?? null;
  } else {
    const [row] = await db
      .select({ userId: commentsTable.userId })
      .from(commentsTable)
      .where(sql`${commentsTable.id}::text = ${report.targetId}`)
      .limit(1);
    ownerUserId = row?.userId ?? null;
  }

  if (!ownerUserId) {
    res.status(404).json({ error: "Content owner not found" });
    return;
  }

  // Suspend the user
  await db
    .update(usersTable)
    .set({ suspended: true })
    .where(eq(usersTable.id, ownerUserId));

  // Resolve report
  await db
    .update(reportsTable)
    .set({ status: "resolved" })
    .where(eq(reportsTable.id, id));

  res.json({ ok: true, id, action: "suspend", suspendedUserId: ownerUserId });
});

/**
 * POST /admin/users/:userId/unsuspend
 *
 * Lifts a suspension. Safe to call on already-active users (no-op).
 */
adminRouter.post("/admin/users/:userId/unsuspend", async (req, res) => {
  const { userId } = req.params;

  const [updated] = await db
    .update(usersTable)
    .set({ suspended: false })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, suspended: usersTable.suspended });

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ ok: true, userId, suspended: false });
});

// ─── Invite requests ──────────────────────────────────────────────────────────

/**
 * GET /admin/invite-requests
 *
 * Returns all invite requests, newest-first, with email, note, age, and status.
 */
adminRouter.get("/admin/invite-requests", async (_req, res) => {
  const rows = await db
    .select()
    .from(inviteRequestsTable)
    .orderBy(asc(inviteRequestsTable.requestedAt));

  res.json({ inviteRequests: rows });
});

/**
 * POST /admin/invite-requests/:id/contact
 *
 * Marks an invite request as contacted.
 */
adminRouter.post("/admin/invite-requests/:id/contact", async (req, res) => {
  const { id } = req.params;

  const [updated] = await db
    .update(inviteRequestsTable)
    .set({ status: "contacted" })
    .where(eq(inviteRequestsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Invite request not found" });
    return;
  }

  res.json({ ok: true, id, status: "contacted" });
});

/**
 * POST /admin/invite-requests/:id/close
 *
 * Closes an invite request (no invitation issued — Invites v2 concern).
 */
adminRouter.post("/admin/invite-requests/:id/close", async (req, res) => {
  const { id } = req.params;

  const [updated] = await db
    .update(inviteRequestsTable)
    .set({ status: "closed" })
    .where(eq(inviteRequestsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Invite request not found" });
    return;
  }

  res.json({ ok: true, id, status: "closed" });
});

// ─── Breed suggestions ────────────────────────────────────────────────────────

/**
 * GET /admin/breed-suggestions
 *
 * Returns distinct free-text breed submissions (pets where breedId IS NULL
 * and breed IS NOT NULL and speciesId IS NOT NULL), grouped by species + name
 * with a count of how many pets share each suggestion.
 */
adminRouter.get("/admin/breed-suggestions", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      p.species_id     AS "speciesId",
      sp.name          AS "speciesName",
      p.breed          AS "breedName",
      COUNT(*)::int    AS "petCount"
    FROM pets p
    INNER JOIN species sp ON sp.id = p.species_id
    WHERE p.breed_id IS NULL
      AND p.breed IS NOT NULL
      AND p.species_id IS NOT NULL
    GROUP BY p.species_id, sp.name, p.breed
    ORDER BY sp.name ASC, p.breed ASC
  `);

  res.json({ suggestions: rows as unknown as Record<string, unknown>[] });
});

/**
 * POST /admin/breed-suggestions/approve
 *
 * Body: { speciesId, breedName }
 *
 * Duplicate-aware: if a breed with that name already exists for the species
 * (case-insensitive), ci-matches to the existing breed rather than creating a
 * twin. Updates all matching pets to use the canonical breedId.
 */
adminRouter.post("/admin/breed-suggestions/approve", async (req, res) => {
  const { speciesId, breedName } = req.body as {
    speciesId?: string;
    breedName?: string;
  };

  if (!speciesId || !breedName?.trim()) {
    res.status(400).json({ error: "speciesId and breedName are required" });
    return;
  }

  const trimmedName = breedName.trim();

  // Verify species exists
  const [species] = await db
    .select()
    .from(speciesTable)
    .where(eq(speciesTable.id, speciesId))
    .limit(1);

  if (!species) {
    res.status(400).json({ error: "Species not found" });
    return;
  }

  // Check for existing breed (case-insensitive)
  const [existing] = await db
    .select()
    .from(breedsTable)
    .where(
      and(
        eq(breedsTable.speciesId, speciesId),
        sql`lower(${breedsTable.name}) = lower(${trimmedName})`,
      ),
    )
    .limit(1);

  let canonicalBreed = existing;

  if (!canonicalBreed) {
    // Create the new breed
    const [created] = await db
      .insert(breedsTable)
      .values({ speciesId, name: trimmedName })
      .returning();
    canonicalBreed = created;
  }

  // Update all matching pets to use the canonical breed
  const updated = await db
    .update(petsTable)
    .set({ breedId: canonicalBreed.id, breed: canonicalBreed.name })
    .where(
      and(
        eq(petsTable.speciesId, speciesId),
        isNull(petsTable.breedId),
        sql`lower(${petsTable.breed}) = lower(${trimmedName})`,
      ),
    )
    .returning({ id: petsTable.id });

  res.json({
    ok:       true,
    breed:    { id: canonicalBreed.id, name: canonicalBreed.name, speciesId },
    created:  !existing,
    petsUpdated: updated.length,
  });
});

/**
 * POST /admin/breed-suggestions/reject
 *
 * Body: { speciesId, breedName }
 *
 * Clears the free-text breed from all matching pets (sets breed = null).
 * The pet owner can re-enter a breed if they wish.
 */
adminRouter.post("/admin/breed-suggestions/reject", async (req, res) => {
  const { speciesId, breedName } = req.body as {
    speciesId?: string;
    breedName?: string;
  };

  if (!speciesId || !breedName?.trim()) {
    res.status(400).json({ error: "speciesId and breedName are required" });
    return;
  }

  const trimmedName = breedName.trim();

  const updated = await db
    .update(petsTable)
    .set({ breed: null })
    .where(
      and(
        eq(petsTable.speciesId, speciesId),
        isNull(petsTable.breedId),
        sql`lower(${petsTable.breed}) = lower(${trimmedName})`,
      ),
    )
    .returning({ id: petsTable.id });

  res.json({ ok: true, petsUpdated: updated.length });
});

export default adminRouter;
