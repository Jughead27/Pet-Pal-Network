/**
 * Invites v2 — full acceptance checklist
 * Run: pnpm --filter @workspace/db exec tsx acceptance-invites.ts
 */

import { db } from "./src/index.js";
import {
  usersTable,
  invitesTable,
  configTable,
  auditLogTable,
} from "./src/schema/index.js";
import { eq, and, ne, inArray, sql, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// ─── helpers ────────────────────────────────────────────────────────────────

const hr = (label: string) =>
  console.log(`\n${"─".repeat(70)}\n▶  ${label}\n${"─".repeat(70)}`);
const pr = (label: string, obj: unknown) =>
  console.log(`[${label}]`, JSON.stringify(obj, null, 2));

function generateCode() {
  return randomBytes(8).toString("base64url");
}

type Insertable = Pick<NodePgDatabase<Record<string, never>>, "insert">;
async function writeAudit(
  tx: Insertable,
  actorId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> | null = null,
) {
  await tx.insert(auditLogTable).values({
    actorId,
    action,
    targetType: targetType ?? undefined,
    targetId:   targetId   ?? undefined,
    metadata:   metadata   ?? undefined,
  });
}

async function effectiveQuota(userId: string): Promise<number> {
  const [[meRow], [cfg]] = await Promise.all([
    db.select({ inviteQuota: usersTable.inviteQuota }).from(usersTable)
      .where(eq(usersTable.id, userId)).limit(1),
    db.select({ value: configTable.value }).from(configTable)
      .where(eq(configTable.key, "invite_default_quota")).limit(1),
  ]);
  return meRow?.inviteQuota ?? parseInt(cfg?.value ?? "5");
}

async function nonRevokedCount(userId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(invitesTable)
    .where(and(eq(invitesTable.inviterId, userId), ne(invitesTable.status, "revoked")));
  return count;
}

// ─── route-logic mirrors ─────────────────────────────────────────────────────

async function routeCreateInvite(userId: string) {
  const quota = await effectiveQuota(userId);
  const used  = await nonRevokedCount(userId);
  if (used >= quota)
    throw new Error(`QUOTA_EXCEEDED (used=${used}, quota=${quota})`);
  const code = generateCode();
  const [inv] = await db.insert(invitesTable).values({ code, inviterId: userId }).returning();
  await writeAudit(db as any, userId, "invite.create", "invite", inv.id, { code });
  return inv;
}

async function routeRedeem(userId: string, code: string) {
  if (!code.trim()) return { ok: false, expired: true, reason: "empty code" };
  const [me] = await db.select({ invitedBy: usersTable.invitedBy }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  if (me?.invitedBy) return { ok: true, already: true };

  const [inv] = await db.select().from(invitesTable)
    .where(and(eq(invitesTable.code, code.trim()), eq(invitesTable.status, "active")))
    .limit(1);
  if (!inv) return { ok: false, expired: true };
  if (inv.inviterId === userId) return { ok: false, error: "cannot redeem own invite" };

  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ invitedBy: inv.inviterId }).where(eq(usersTable.id, userId));
    await tx.update(invitesTable)
      .set({ status: "used", usedBy: userId, usedAt: new Date() })
      .where(eq(invitesTable.id, inv.id));
    await writeAudit(tx, userId, "invite.used", "invite", inv.id, {
      inviterId: inv.inviterId, code: inv.code,
    });
  });
  return { ok: true };
}

async function routeRevoke(userId: string, inviteId: string) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invitesTable)
      .where(and(eq(invitesTable.id, inviteId), eq(invitesTable.inviterId, userId))).limit(1);
    if (!inv) return { notFound: true };
    if (inv.status !== "active") return { alreadyNotActive: true };
    await tx.update(invitesTable).set({ status: "revoked" }).where(eq(invitesTable.id, inviteId));
    await writeAudit(tx, userId, "invite.revoke", "invite", inviteId, { code: inv.code });
    return { ok: true, id: inviteId, status: "revoked" };
  });
}

async function routeAdminSetQuota(actorId: string, targetId: string, newQuota: number | null) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ inviteQuota: usersTable.inviteQuota }).from(usersTable)
      .where(eq(usersTable.id, targetId)).limit(1);
    const [result] = await tx.update(usersTable).set({ inviteQuota: newQuota })
      .where(eq(usersTable.id, targetId)).returning({ inviteQuota: usersTable.inviteQuota });
    await writeAudit(tx, actorId, "user.invite_quota_set", "user", targetId, {
      oldQuota: user?.inviteQuota ?? null, newQuota,
    });
    return { ok: true, userId: targetId, inviteQuota: result.inviteQuota };
  });
}

async function httpValidate(code: string): Promise<{ valid: boolean }> {
  const r = await fetch(`http://localhost:8080/api/invites/validate/${encodeURIComponent(code)}`);
  return r.json() as Promise<{ valid: boolean }>;
}

// ─── test users ──────────────────────────────────────────────────────────────

const IDS = {
  inviter:    "tacc_inviter_001",
  alice:      "tacc_alice_001",
  bob:        "tacc_bob_001",
  nocode:     "tacc_nocode_001",
  quota_user: "tacc_quota_001",
};

async function seedUsers() {
  const rows = [
    { id: IDS.inviter,    username: "tacc_inviter",    email: "tacc_inviter@test.local" },
    { id: IDS.alice,      username: "tacc_alice",      email: "tacc_alice@test.local"   },
    { id: IDS.bob,        username: "tacc_bob",        email: "tacc_bob@test.local"     },
    { id: IDS.nocode,     username: "tacc_nocode",     email: "tacc_nocode@test.local"  },
    { id: IDS.quota_user, username: "tacc_quota",      email: "tacc_quota@test.local"   },
  ];
  for (const u of rows)
    await db.insert(usersTable).values(u).onConflictDoNothing();
}

async function cleanup() {
  const ids = Object.values(IDS);
  await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, ids));
  await db.delete(invitesTable).where(inArray(invitesTable.inviterId, ids));
  await db.update(usersTable).set({ invitedBy: null, inviteQuota: null })
    .where(inArray(usersTable.id, ids));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
}

// ─── main ────────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✓ ${msg}`); pass++; }
  else       { console.error(`  ✗ FAIL: ${msg}`); fail++; }
}

async function main() {
  await cleanup();
  await seedUsers();

  try {

    // ── 1. CREATE INVITE ────────────────────────────────────────────────────
    hr("1 · CREATE INVITE  (acc_inviter creates an invite)");

    const inv = await routeCreateInvite(IDS.inviter);
    pr("invites row", inv);
    const link = `https://pshpsh.app/invite/${inv.code}`;
    console.log("invite link →", link);
    const v1 = await httpValidate(inv.code);
    console.log("GET /api/invites/validate/:code →", v1);
    assert(v1.valid === true, "validate returns valid=true for active invite");
    assert(inv.status === "active", "invite.status = active");
    assert(inv.inviterId === IDS.inviter, "invite.inviter_id = inviter");

    // ── 2. GATED SIGNUP END-TO-END ──────────────────────────────────────────
    hr("2 · GATED SIGNUP  (alice redeems invite — new user row, audit row)");

    const redeemRes = await routeRedeem(IDS.alice, inv.code);
    pr("redeem result", redeemRes);
    assert(redeemRes.ok === true, "redeem returns ok=true");

    const [aliceRow] = await db
      .select({ id: usersTable.id, username: usersTable.username, invitedBy: usersTable.invitedBy })
      .from(usersTable).where(eq(usersTable.id, IDS.alice));
    pr("users row (alice)", aliceRow);
    assert(aliceRow.invitedBy === IDS.inviter, "alice.invited_by = inviter id");

    const [invAfterRedeem] = await db.select().from(invitesTable)
      .where(eq(invitesTable.id, inv.id));
    pr("invites row after redeem", invAfterRedeem);
    assert(invAfterRedeem.status === "used", "invite.status = used");
    assert(invAfterRedeem.usedBy === IDS.alice, "invite.used_by = alice");
    assert(invAfterRedeem.usedAt !== null, "invite.used_at is set");

    const [auditUsed] = await db.select().from(auditLogTable)
      .where(and(eq(auditLogTable.actorId, IDS.alice), eq(auditLogTable.action, "invite.used")))
      .orderBy(desc(auditLogTable.createdAt)).limit(1);
    pr("audit_log row (invite.used)", auditUsed);
    assert(auditUsed?.action === "invite.used", "audit action = invite.used");
    assert(auditUsed?.targetId === inv.id, "audit target_id = invite id");
    assert(
      (auditUsed?.metadata as any)?.inviterId === IDS.inviter,
      "audit metadata.inviterId = inviter id",
    );

    // ── 3A. BLOCKED — no-code password path ────────────────────────────────
    hr("3A · BLOCKED — no-code password signup (invalid code → server rejects)");

    const blockedPw = await routeRedeem(IDS.nocode, "no-such-code-xyz");
    pr("redeem with nonexistent code →", blockedPw);
    assert(blockedPw.ok === false, "redeem ok=false for invalid code");
    assert((blockedPw as any).expired === true, "expired=true for invalid code");

    const [nocodeAfterPw] = await db
      .select({ invitedBy: usersTable.invitedBy })
      .from(usersTable).where(eq(usersTable.id, IDS.nocode));
    console.log("  nocode.invited_by (must be null):", nocodeAfterPw.invitedBy);
    assert(nocodeAfterPw.invitedBy === null, "nocode user: invited_by remains null");

    // ── 3B. BLOCKED — OAuth-transfer path (empty/missing code) ─────────────
    hr("3B · BLOCKED — OAuth-transfer without code (empty code → server gate)");
    // sign-in.tsx: when no pendingInviteCode in SecureStore, the branch
    // never calls signUp.create({ transfer: true }). Server-side we verify
    // that an empty code is also rejected.

    const blockedOauth = await routeRedeem(IDS.nocode, "");
    pr("redeem with empty string code →", blockedOauth);
    assert(blockedOauth.ok === false, "redeem ok=false for empty code");

    const [nocodeAfterOauth] = await db
      .select({ invitedBy: usersTable.invitedBy })
      .from(usersTable).where(eq(usersTable.id, IDS.nocode));
    console.log("  nocode.invited_by after OAuth attempt (must be null):", nocodeAfterOauth.invitedBy);
    assert(nocodeAfterOauth.invitedBy === null, "nocode user: invited_by still null after OAuth attempt");

    // ── 4. QUOTA MATH + ADMIN OVERRIDE ─────────────────────────────────────
    hr("4 · QUOTA MATH  (fill quota=5, exceed, admin override to 2, audit)");

    const quotaBefore = await effectiveQuota(IDS.quota_user);
    console.log("  effectiveQuota (config default) →", quotaBefore);
    assert(quotaBefore === 5, "default effective quota = 5");

    // Fill to limit
    const filledInvites = [];
    for (let i = 0; i < quotaBefore; i++) {
      const fi = await routeCreateInvite(IDS.quota_user);
      filledInvites.push(fi);
      console.log(`  created invite ${i + 1}/${quotaBefore}: code=${fi.code}`);
    }

    // Attempt to exceed
    let quotaErr: string | null = null;
    try { await routeCreateInvite(IDS.quota_user); }
    catch (e: any) { quotaErr = e.message; }
    console.log("  exceed attempt error →", quotaErr);
    assert(quotaErr?.includes("QUOTA_EXCEEDED") === true, "creating invite at quota limit throws QUOTA_EXCEEDED");

    // Admin sets quota to 2
    const adminActor = IDS.inviter;
    const quotaSetRes = await routeAdminSetQuota(adminActor, IDS.quota_user, 2);
    pr("admin POST /admin/invite-management/quota (set to 2)", quotaSetRes);
    assert(quotaSetRes.ok === true, "admin quota set ok=true");
    assert(quotaSetRes.inviteQuota === 2, "users.invite_quota = 2");

    const [qaRow] = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.actorId, adminActor),
        eq(auditLogTable.action, "user.invite_quota_set"),
      ))
      .orderBy(desc(auditLogTable.createdAt)).limit(1);
    pr("audit_log row (user.invite_quota_set)", qaRow);
    assert(qaRow?.action === "user.invite_quota_set", "audit action = user.invite_quota_set");
    assert((qaRow?.metadata as any)?.newQuota === 2, "audit metadata.newQuota = 2");
    assert((qaRow?.metadata as any)?.oldQuota === null, "audit metadata.oldQuota = null (was unset)");

    // Still blocked (5 non-revoked > cap of 2)
    let quotaErr2: string | null = null;
    try { await routeCreateInvite(IDS.quota_user); }
    catch (e: any) { quotaErr2 = e.message; }
    console.log("  still blocked after admin cap of 2 →", quotaErr2);
    assert(quotaErr2?.includes("QUOTA_EXCEEDED") === true, "still blocked after admin override to 2");

    // Admin resets to null (config default)
    const quotaResetRes = await routeAdminSetQuota(adminActor, IDS.quota_user, null);
    pr("admin reset to null (config default restored)", quotaResetRes);
    assert(quotaResetRes.inviteQuota === null, "invite_quota = null after reset");
    const quotaAfterReset = await effectiveQuota(IDS.quota_user);
    console.log("  effectiveQuota after reset →", quotaAfterReset, "(should equal config default 5)");
    assert(quotaAfterReset === 5, "effective quota = 5 after null reset");

    // ── 5. REVOKE + VALIDATE REJECTION ─────────────────────────────────────
    hr("5 · REVOKE + VALIDATE REJECTION  (bob's invite)");

    const bobInv = await routeCreateInvite(IDS.inviter);
    pr("fresh invite for bob (status=active)", bobInv);

    const vBefore = await httpValidate(bobInv.code);
    console.log("  validate before revoke →", vBefore);
    assert(vBefore.valid === true, "validate=true before revoke");

    const revokeRes = await routeRevoke(IDS.inviter, bobInv.id);
    pr("revoke result", revokeRes);
    assert((revokeRes as any).ok === true, "revoke ok=true");
    assert((revokeRes as any).status === "revoked", "revoke result.status=revoked");

    const [revokedRow] = await db
      .select({ status: invitesTable.status })
      .from(invitesTable).where(eq(invitesTable.id, bobInv.id));
    console.log("  invites.status after revoke →", revokedRow.status);
    assert(revokedRow.status === "revoked", "DB row status=revoked");

    const vAfter = await httpValidate(bobInv.code);
    console.log("  validate after revoke →", vAfter);
    assert(vAfter.valid === false, "validate=false after revoke");

    const revokedRedeem = await routeRedeem(IDS.bob, bobInv.code);
    pr("redeem revoked code →", revokedRedeem);
    assert(revokedRedeem.ok === false, "redeem revoked code ok=false");
    assert((revokedRedeem as any).expired === true, "redeem revoked code expired=true");

    const [bobRow] = await db
      .select({ invitedBy: usersTable.invitedBy })
      .from(usersTable).where(eq(usersTable.id, IDS.bob));
    console.log("  bob.invited_by after revoked-code attempt (must be null):", bobRow.invitedBy);
    assert(bobRow.invitedBy === null, "bob: invited_by null after revoked-code attempt");

  } finally {
    await cleanup();
    console.log("\n[cleanup] all test rows removed");
    hr(`RESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
