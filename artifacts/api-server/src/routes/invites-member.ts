/**
 * Protected invite routes — require a valid Clerk session.
 *
 *   POST /api/invites/redeem          — consume an invite code after signup
 *   POST /api/invites                 — create a new invite (quota-gated)
 *   GET  /api/invites/mine            — list caller's invites + quota info
 *   POST /api/invites/:id/revoke      — revoke an active invite (owner only)
 */

import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { db, invitesTable, usersTable, configTable, auditLogTable, petsTable, petOwnersTable, postsTable } from "@workspace/db";
import { eq, and, ne, sql, desc, inArray } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm";
import { writeAudit } from "../lib/writeAudit.js";
import { logger } from "../lib/logger";
import { mediaTokenUrl } from "../lib/r2.js";
import { activePets } from "../lib/petQueries.js";

const router: IRouter = Router();

/** Generates a short, URL-safe, unguessable invite code (11 chars, 64-bit entropy). */
export function generateCode(): string {
  return randomBytes(8).toString("base64url");
}

// ── Redeem ────────────────────────────────────────────────────────────────────

/**
 * POST /api/invites/redeem
 *
 * Called immediately after a successful signup to mark the invite code as used
 * and set the new user's invited_by field.
 *
 * Idempotent: if the user already has invited_by set, returns OK.
 * ONE transaction: UPDATE users.invited_by + UPDATE invites.status + writeAudit.
 */
router.post("/invites/redeem", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;
  const { code } = req.body as { code?: string };

  if (!code || typeof code !== "string" || !code.trim()) {
    res.status(400).json({ ok: false, error: "code is required" });
    return;
  }

  const trimmedCode = code.trim();

  // Check if already attributed (idempotent)
  const [me] = await db
    .select({ invitedBy: usersTable.invitedBy })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (me?.invitedBy) {
    res.json({ ok: true }); // already redeemed
    return;
  }

  // Find the active invite
  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.code, trimmedCode), eq(invitesTable.status, "active")))
    .limit(1);

  if (!invite) {
    // Not found or already used — return 200 gentle response
    res.json({ ok: false, expired: true });
    return;
  }

  // Can't redeem your own invite
  if (invite.inviterId === userId) {
    res.json({ ok: false, error: "cannot redeem your own invite" });
    return;
  }

  // ONE transaction: set invitedBy + mark invite used + writeAudit.
  // The invite UPDATE predicates on status='active' so that if two concurrent
  // requests both pass the SELECT check, only one can commit — the other gets
  // 0 rows affected and we surface the already-used error instead of silently
  // double-crediting the inviter.
  let redeemed = false;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(invitesTable)
      .set({ status: "used", usedBy: userId, usedAt: new Date() })
      .where(and(eq(invitesTable.id, invite.id), eq(invitesTable.status, "active")))
      .returning({ id: invitesTable.id });

    if (!updated.length) {
      // Lost the race — another request already consumed this invite.
      return;
    }

    await tx
      .update(usersTable)
      .set({ invitedBy: invite.inviterId })
      .where(eq(usersTable.id, userId));

    await writeAudit(tx, userId, "invite.used", "invite", invite.id, {
      inviterId: invite.inviterId,
      code: invite.code,
    });

    redeemed = true;
  });

  if (!redeemed) {
    res.json({ ok: false, expired: true });
    return;
  }

  // Attach co-pet info + inviter name to the response so the mobile client can
  // show the one-tap co-ownership confirm without an extra round-trip.
  const [inviterRow] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, invite.inviterId))
    .limit(1);

  const coPetRows: Array<{ id: string; name: string; species: string | null }> =
    invite.coPetIds?.length
      ? await db
          .select({ id: petsTable.id, name: petsTable.name, species: petsTable.species })
          .from(petsTable)
          .where(inArray(petsTable.id, invite.coPetIds))
      : [];

  logger.info({ userId, inviteId: invite.id, inviterId: invite.inviterId }, "Invite redeemed");
  res.json({ ok: true, coPets: coPetRows, inviterUsername: inviterRow?.username ?? null });
});

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * POST /api/invites
 *
 * Creates a new invite for the calling user.
 * Quota: COALESCE(users.invite_quota, config.invite_default_quota).
 * Revoked invites do NOT count against the quota.
 */
router.post("/invites", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  // Get effective quota in parallel; also fetch role for admin bypass
  const [[meRow], [cfg]] = await Promise.all([
    db
      .select({ inviteQuota: usersTable.inviteQuota, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1),
    db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, "invite_default_quota"))
      .limit(1),
  ]);

  // Admins are never subject to the invite quota — skip all quota checks.
  if (meRow?.role !== "admin") {
    const effectiveQuota = meRow?.inviteQuota ?? parseInt(cfg?.value ?? "5");

    // Count non-revoked invites (active + used) — revoked don't count
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invitesTable)
      .where(
        and(
          eq(invitesTable.inviterId, userId),
          ne(invitesTable.status, "revoked"),
        ),
      );

    const nonRevokedCount = countRow?.count ?? 0;

    if (nonRevokedCount >= effectiveQuota) {
      res.status(429).json({ ok: false, quota_exceeded: true });
      return;
    }
  }

  // Optional co-ownership pet IDs — validate that each is actually owned by the caller
  // so a malicious body cannot grant co-ownership of unrelated pets.
  const { petIds } = req.body as { petIds?: unknown };
  const validatedPetIds: string[] = [];
  if (Array.isArray(petIds) && petIds.length > 0) {
    const rawIds = [...new Set((petIds as unknown[]).filter((x): x is string => typeof x === "string"))];
    if (rawIds.length > 0) {
      const owned = await db
        .select({ petId: petOwnersTable.petId })
        .from(petOwnersTable)
        .where(and(inArray(petOwnersTable.petId, rawIds), eq(petOwnersTable.userId, userId)));
      validatedPetIds.push(...owned.map((r) => r.petId));
    }
  }

  const code = generateCode();

  const [invite] = await db
    .insert(invitesTable)
    .values({ inviterId: userId, code, coPetIds: validatedPetIds.length ? validatedPetIds : null })
    .returning();

  logger.info({ userId, inviteId: invite.id, code: invite.code, coPetCount: validatedPetIds.length }, "Invite created");
  res.status(201).json({
    ok: true,
    invite: {
      id:        invite.id,
      code:      invite.code,
      status:    invite.status,
      createdAt: invite.createdAt,
    },
  });
});

// ── Accept co-pets ────────────────────────────────────────────────────────────

/**
 * POST /api/invites/accept-co-pets
 *
 * Called after a new user has redeemed an invite and explicitly accepted
 * co-ownership of the pets the inviter pre-selected.
 *
 * Guard: invite.usedBy must equal the calling user — a third party who somehow
 * obtained the code cannot claim co-ownership via someone else's redeemed link.
 * Insertion is idempotent (ON CONFLICT DO NOTHING) so repeated taps are safe.
 */
router.post("/invites/accept-co-pets", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;
  const { code }   = req.body as { code?: string };

  if (!code?.trim()) {
    res.status(400).json({ ok: false, error: "code is required" });
    return;
  }

  const [invite] = await db
    .select({
      id:       invitesTable.id,
      usedBy:   invitesTable.usedBy,
      coPetIds: invitesTable.coPetIds,
    })
    .from(invitesTable)
    .where(eq(invitesTable.code, code.trim()))
    .limit(1);

  if (!invite || invite.usedBy !== userId) {
    res.status(403).json({ ok: false, error: "not authorized" });
    return;
  }

  const petIds = invite.coPetIds ?? [];
  if (!petIds.length) {
    res.json({ ok: true });
    return;
  }

  await db.transaction(async (tx) => {
    for (const petId of petIds) {
      await tx
        .insert(petOwnersTable)
        .values({ petId, userId })
        .onConflictDoNothing();
    }
    await writeAudit(tx, userId, "invite.co_pets_accepted", "invite", invite.id, { petIds });
  });

  logger.info({ userId, inviteId: invite.id, petCount: petIds.length }, "Invite co-pets accepted");
  res.json({ ok: true });
});

// ── Mine ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/invites/mine
 *
 * Returns the caller's invites, effective quota, and invited-by attribution.
 */
router.get("/invites/mine", async (req, res) => {
  const { userId } = (req as Express.RequestWithAuth).auth!;

  // Get user info + config default in parallel.
  // `role` is fetched here so `isAdmin` can be included in the response —
  // the client derives admin state from this same payload (no separate /me race).
  const [[meRow], [cfg]] = await Promise.all([
    db
      .select({ inviteQuota: usersTable.inviteQuota, invitedById: usersTable.invitedBy, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1),
    db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, "invite_default_quota"))
      .limit(1),
  ]);

  const effectiveQuota = meRow?.inviteQuota ?? parseInt(cfg?.value ?? "5");

  // Invited-by username (separate query to avoid alias complexity)
  let invitedByUsername: string | null = null;
  if (meRow?.invitedById) {
    const [inviter] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, meRow.invitedById))
      .limit(1);
    invitedByUsername = inviter?.username ?? null;
  }

  // Invites with used-by username
  const usedByAlias = aliasedTable(usersTable, "used_by_user");
  const myInvites = await db
    .select({
      id:             invitesTable.id,
      code:           invitesTable.code,
      status:         invitesTable.status,
      createdAt:      invitesTable.createdAt,
      usedBy:            invitesTable.usedBy,
      usedByUsername:    usedByAlias.username,
      usedByDisplayName: usedByAlias.displayName,
    })
    .from(invitesTable)
    .leftJoin(usedByAlias, eq(usedByAlias.id, invitesTable.usedBy))
    .where(eq(invitesTable.inviterId, userId))
    .orderBy(desc(invitesTable.createdAt));

  const nonRevokedCount = myInvites.filter((i) => i.status !== "revoked").length;

  // Batch-fetch pets for all "used" invite redeemers so the client can show
  // a "friends who joined" block with pet avatars.
  const usedInvites = myInvites.filter((i) => i.status === "used" && i.usedBy);
  const redeemerIds = [...new Set(usedInvites.map((i) => i.usedBy!))];

  const friendsMap: Record<string, { id: string; name: string; thumbnailUrl: string | null }[]> = {};

  if (redeemerIds.length > 0) {
    const redeemerPets = await db
      .select({
        ownerId:        petOwnersTable.userId,
        id:             petsTable.id,
        name:           petsTable.name,
        avatarKey:      petsTable.avatarKey,
        recentMediaKey: sql<string | null>`(
          SELECT ${postsTable.mediaKey}
          FROM   ${postsTable}
          WHERE  ${postsTable.petId} = ${petsTable.id}
            AND  ${postsTable.archivedAt} IS NULL
          ORDER  BY ${postsTable.createdAt} DESC
          LIMIT  1
        )`,
      })
      .from(petsTable)
      .innerJoin(petOwnersTable, eq(petOwnersTable.petId, petsTable.id))
      .where(and(inArray(petOwnersTable.userId, redeemerIds), activePets));

    for (const p of redeemerPets) {
      const thumbnailUrl = p.avatarKey
        ? mediaTokenUrl(p.avatarKey)
        : p.recentMediaKey
          ? mediaTokenUrl(p.recentMediaKey)
          : null;
      if (!friendsMap[p.ownerId]) friendsMap[p.ownerId] = [];
      friendsMap[p.ownerId].push({ id: p.id, name: p.name, thumbnailUrl });
    }
  }

  // One entry per used invite (= one per friend who joined via this user's link).
  const friendsWhoJoined = usedInvites.map((i) => ({
    userId:      i.usedBy!,
    username:    i.usedByUsername,
    displayName: i.usedByDisplayName ?? null,
    pets:        friendsMap[i.usedBy!] ?? [],
  }));

  res.json({
    effectiveQuota,
    isAdmin:          meRow?.role === "admin",
    invitedByUsername,
    nonRevokedCount,
    invites: myInvites,
    friendsWhoJoined,
  });
});

// ── Revoke ────────────────────────────────────────────────────────────────────

/**
 * POST /api/invites/:id/revoke
 *
 * Revokes an active invite owned by the caller.
 * Audit: invite.revoke
 */
router.post("/invites/:id/revoke", async (req, res) => {
  const { id } = req.params;
  const { userId } = (req as Express.RequestWithAuth).auth!;

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invitesTable)
      .where(
        and(
          eq(invitesTable.id, id),
          eq(invitesTable.inviterId, userId),
        ),
      )
      .limit(1);

    if (!invite) return null;
    if (invite.status !== "active") return { alreadyNotActive: true };

    await tx
      .update(invitesTable)
      .set({ status: "revoked" })
      .where(eq(invitesTable.id, id));

    await writeAudit(tx, userId, "invite.revoke", "invite", id, {
      code: invite.code,
    });

    return { id };
  });

  if (!result) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  if ("alreadyNotActive" in result) {
    res.status(409).json({ error: "Invite is no longer active" });
    return;
  }

  res.json({ ok: true, id, status: "revoked" });
});

export default router;
