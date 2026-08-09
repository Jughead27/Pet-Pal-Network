---
name: Co-Ownership Rebuild
description: Symmetric co-ownership system replacing the role-based model. No primary/co distinction.
---

## What changed

### Database
- `pet_owners` — dropped `role` (enum `pet_owner_role`) and `invited_by` columns. Now: `id`, `pet_id`, `user_id`, `added_at`. Unique on (pet_id, user_id).
- `pet_owner_invites` table — **dropped**. Replaced by `co_ownership_requests`.
- `co_ownership_requests` — new table: `id`, `pet_id`, `inviter_user_id`, `invitee_user_id`, `status` (enum: pending/accepted/declined), `created_at`, `resolved_at`. Partial concept: one pending request per pet+invitee pair (enforced at API level, not DB constraint).

### API routes (co-owners.ts — complete rewrite)
- `POST /pets/:id/co-owners` — any owner invites by username
- `GET /co-ownership-requests/mine` — pending requests addressed to the viewer
- `GET /pets/:id/co-ownership-requests` — pending outgoing requests (any owner may call)
- `GET /pets/:id/co-owners` — list all current owners
- `POST /co-ownership-requests/:id/accept` — invitee accepts; creates pet_owners row
- `POST /co-ownership-requests/:id/decline` — invitee declines
- `DELETE /pets/:id/co-owners/me` — self-removal only; 400 if last owner

### isPetOwner.ts
- Removed `isPetPrimaryOwner` export.
- `getPetOwnerRow` returns `{ id: string } | null` (no role field).

### pets.ts
- Removed `viewerIsPrimaryOwner` from all responses.
- `viewerCanManagePost = viewerIsOwner` (any owner manages any post).
- `GET /pets/:id` now includes `owners: [{ userId, username }]` array.
- `GET /me/pets` no longer returns `role`.
- `POST /pets` creates ownership row without role field.

### posts.ts
- All 4 write routes (patch/delete/archive/unarchive) replaced `isPetPrimaryOwner` with `isPetOwner`.

### purgePets.ts
- Replaced `petOwnerInvitesTable` delete with `coOwnershipRequestsTable`.

### Mobile
- `pet/[id].tsx`: invite modal removed; invite UI moved to edit screen. Pending invite banner updated to use new routes. "About the owners" section added (shown when >1 owner). UserPlus button now any-owner, navigates to edit screen.
- `pet/edit.tsx`: Added "add a co-owner" quiet link + inline form + "remove yourself as owner" quiet link.
- `(tabs)/profile.tsx`: Co-owner invites section updated to co-ownership requests, new route names.

### OpenAPI
- `PetProfile` schema: added `owners` array field, removed `viewerIsPrimaryOwner`.
- `MyPetsResponse`: still uses `Pet` schema (no `role` removed from spec — not present).

**Why:** Spec required fully symmetric ownership — no role distinction between owners. All owners have equal rights.

**How to apply:** Any permission check that previously needed `isPetPrimaryOwner` now uses `isPetOwner`. Any ownership addition goes through `co_ownership_requests` accept flow.

## Schema migration note
`drizzle-kit push` needs a TTY for interactive enum-conflict prompts — it will fail silently in non-TTY shells. Use `executeSql()` directly in CodeExecution for schema migrations that add/drop enums or tables.

## Primary owner + forced revoke (Aug 2026)
- "Primary" = pets.owner_id (original creator) — no new column, no backfill needed. Primary status gates ONLY forced revoke; post management stays symmetric via isPetOwner.
- DELETE /pets/:id/co-owners/:userId — primary-only forced revoke; all checks + delete + co_owner.revoked audit inside one tx with SELECT…FOR UPDATE on the pet's pet_owners rows (architect flagged TOCTOU on first draft; lock-in-tx pattern is the fix).
- Voluntary self-leave (/me, co_owner.left) untouched; mobile "remove"/"confirm remove?" whisper in Owners list visible only to primary, never own row.
