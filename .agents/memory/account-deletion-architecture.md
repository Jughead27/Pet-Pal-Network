---
name: Account Deletion Architecture
description: Tombstone-pattern account deletion — core routine, grace-period Clerk delete, auth lockout, deleted-author rendering.
---

# Account Deletion Architecture

- Core routine: `artifacts/api-server/src/lib/deleteAccount.ts` — shared by self-serve `POST /me/delete` (users.ts) and admin `POST /admin/users/:userId/delete` (admin.ts, blocks self + other admins). Everything in ONE transaction.
- **Concurrency rule:** all discovery (ownership counts, survivor pick) happens INSIDE the transaction, after `SELECT ... FOR UPDATE` on the users row and on all owned pets. Tombstone transition is guarded by the lock — concurrent double-delete returns 409 for the loser. **Why:** pre-tx snapshots go stale under concurrent co-owner mutations and can orphan a live pet or double-audit.
- Tombstone: users row KEPT (5 surfaces inner-join users, ~15 FKs); profile fields nulled, `deleted_at` set. `clerk_deleted_at` marks completed Clerk hard delete.
- Clerk hard delete is delayed 7 days: `lib/clerkDeletions.ts` `processClerkDeletions()` wired into `GET /admin/cron/purge` (X-Purge-Secret). 404 from Clerk = success; failures retried next run.
- Auth lockout: `requireClerkAuth` selects `deletedAt` and returns 403 `{error:"account_deleted"}` BEFORE the suspended check; row presence also prevents auto-reprovision resurrection during grace.
- Content policy: solo pets soft-deleted; co-owned pets keep survivors (`pets.owner_id` repointed if target was primary); authored posts kept with `posted_by_user_id` nulled; comments on NON-owned pets' posts soft-deleted, comments on own pets' posts kept and rendered as **"Former pshpsh member"** via `authorDeleted` on PostComment (distinct from 'a pshpsh member' fallback; author tap disabled). Blocks/boops/treats/follows/own notifications hard-deleted; `actor_user_id` nulled on others'. Reports/audit/feedback/quota_requests/invited_by untouched.
- Profile GET treats `deleted_at` as 404 (indistinguishable from nonexistent).
- **`pet_owner_invites` schema file is DEAD CODE** — not exported from lib/db index, no table in DB; live model is `co_ownership_requests`. Don't trust the schema dir alone; check exports + `to_regclass`.
- Verified via esbuild-bundled direct-invocation script against dev DB (19 assertions incl. concurrent double-delete and orphan-pet invariant). Live Clerk-side verification requires publish (prod Clerk locked to pshpsh.net).
