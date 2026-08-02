---
name: Quota Requests Architecture
description: Member-initiated invite quota request flow — schema, API endpoints, mobile UI, and admin queue.
---

## What it is
Members who have used all their invites can tap "request more" on the profile screen. Admin sees these in a dedicated queue and can grant (+5 quota) or dismiss.

**Distinct from** `invite_requests` table (pre-signup email capture). Do not conflate.

## Schema
`lib/db/src/schema/quota-requests.ts` → `quota_requests` table:
- `id` text PK (gen_random_uuid)
- `user_id` FK → users.id
- `status` text: `pending` | `granted` | `dismissed`
- `created_at` timestamp
- `resolved_at` timestamp nullable
- `resolved_by` FK → users.id nullable

Exported via `lib/db/src/schema/index.ts`. After schema changes, run `cd lib/db && pnpm run push` then `npx tsc --build`.

## API
Member (auth'd, in `artifacts/api-server/src/routes/quota-requests.ts`, registered in routes/index.ts):
- `POST /api/quota-requests` — idempotent; returns existing pending if one exists
- `GET /api/quota-requests/mine` → `{ pendingRequest: { id, createdAt } | null }`

Admin (in `artifacts/api-server/src/routes/admin.ts`, same `requireRole("admin")` gate):
- `GET /api/admin/quota-requests/count` → `{ pending: number }` — badge source
- `GET /api/admin/quota-requests` → `{ requests }` — joined with user info, oldest-first
- `POST /api/admin/quota-requests/:id/grant` — bumps user inviteQuota by +5, marks granted, writes audit log (`quota_request.grant`)
- `POST /api/admin/quota-requests/:id/dismiss` — marks dismissed, writes audit log (`quota_request.dismiss`)

**Grant increment logic**: `effectiveQuota = user.inviteQuota ?? configDefault` → `newQuota = effectiveQuota + 5`. Same pattern as invites-member.ts.

## Mobile
- **Profile screen**: `hasPendingQuotaRequest` + `quotaRequestConfirmed` state. "request more" TouchableOpacity shown when `effectiveQuota > 0 && remaining === 0`. Confirmed state shows "we'll take a look 🐾". Admin badge on the "admin" link shows `quotaPendingCount`.
- **Admin hub** (`app/admin/index.tsx`): now a stateful component, fetches `/api/admin/quota-requests/count`, shows coral badge on "Quota Requests" row.
- **Admin screen** (`app/admin/quota-requests.tsx`): FlatList of pending requests, grant/dismiss actions.

**Why:**
- `invite_requests` = pre-signup email, different table, different admin screen (`/admin/invites`)
- `quota_requests` = post-signup quota bump requests, this flow

**How to apply:**
- If adding more admin action types, follow the transaction + writeAudit pattern in admin.ts
- The `isAdmin` check for the profile badge query uses `enabled: isAdmin` to avoid a 403 for non-admins
