---
name: Invites v2 Architecture
description: Full invite code system — schema, API routes, mobile gate, quota enforcement, OAuth round-trip code survival, admin management.
---

## Schema
- `invites` table: `id uuid PK, code text UNIQUE, inviter_id FK→users, status invite_status_enum (active/used/revoked) default active, created_at, used_by FK→users NULL, used_at NULL`
- `users.invite_quota integer NULL` — per-user override; NULL = use config default
- `users.invited_by text NULL FK→users` — self-referential, `(): AnyPgColumn => usersTable.id` pattern required for Drizzle
- `config` row: `key=invite_default_quota, value=5` — must be seeded after schema push

## Gate enforcement
Gate is CLIENT-SIDE only. Not enforced at the API level (requireClerkAuth not modified).
- **Password signup**: sign-up.tsx checks `inviteCode` state before rendering the form. If no code → shows gate block + inline invite-request capture.
- **Google OAuth at sign-up**: persists code to SecureStore before startSSOFlow; tabs layout redeems it after session activates.
- **Google OAuth at sign-in (new user transfer)**: sign-in.tsx reads SecureStore in the `firstFactorVerification.status === 'transferable'` branch. If no code → sets step='invite' + shows error.

## OAuth round-trip survival
Use `expo-secure-store` (already in deps) key `'pendingInviteCode'`.
- Written by: `/invite/[code].tsx` landing page, and sign-up.tsx before startSSOFlow.
- Cleared by: `(tabs)/_layout.tsx` useEffect on isSignedIn, after calling POST /api/invites/redeem.
- The tabs layout effect runs every time isSignedIn becomes true — idempotent since redeem is idempotent.

## API routes
Public (before requireClerkAuth):
- `GET /api/invites/validate/:code` — returns `{ valid: boolean }`, no auth needed
- `POST /api/invites/request` — existing invite-request waitlist (preserved)

Protected (in routes/invites-member.ts, mounted after requireClerkAuth):
- `POST /api/invites/redeem` — body: `{ code }`. ONE transaction: UPDATE users.invited_by + UPDATE invites.status='used' + writeAudit('invite.used'). Idempotent.
- `POST /api/invites` — quota-gated invite creation. Remaining = quota - COUNT(non-revoked). Returns `{ invite: { id, code } }`.
- `GET /api/invites/mine` — returns `{ effectiveQuota, invitedByUsername, nonRevokedCount, invites[] }` with usedByUsername via aliasedTable.
- `POST /api/invites/:id/revoke` — writeAudit('invite.revoke'). NOTE: `/invites/redeem` must be defined BEFORE `/:id/revoke` in router.

Admin (in routes/admin.ts):
- `GET /admin/invite-management?limit&offset` — raw SQL GROUP BY with invite stats; uses `COALESCE(invite_quota, ${defaultQuota})` for effectiveQuota.
- `POST /admin/invite-management/quota` — body: `{ userId, quota: number|null }`. null = reset to default. writeAudit('user.invite_quota_set', { oldQuota, newQuota }).

## Code generation
`randomBytes(8).toString('base64url')` — 11 URL-safe chars, ~64-bit entropy. No new dependencies.

## Effective quota computation
`COALESCE(users.invite_quota, config.invite_default_quota)` — computed at query time.
Remaining = effectiveQuota - COUNT(invites WHERE status IN ('active','used') AND inviter_id = userId). Revoked don't count.

## Mobile screens
- `/invite/[code]` — public landing (portal visual system, validates code, "join pshpsh" → SecureStore + sign-up)
- `/invite/_layout.tsx` — no auth redirect, Stack wrapper
- `(tabs)/profile.tsx` — "Your Invites" section: header copy, progress text, "call in a friend" bold action (Share.share native, navigator.share web), invite list with revoke whispers
- `admin/invite-management.tsx` — per-user quota edit with inline TextInput expand/collapse

## Preserved (do not modify)
- `POST /invites/request` — invite waitlist capture (public endpoint)
- `admin/invites.tsx` — invite request triage
- All sign-in flows except the Google OAuth transferable branch (which now checks SecureStore)

**Why:**
The spec requires invite attribution in a single transaction while keeping Clerk as the auth authority. Client-side gating + SecureStore survival + tabs-layout redemption achieves this without modifying requireClerkAuth or Clerk's session flow.
