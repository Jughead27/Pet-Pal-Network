---
name: Co-ownership Architecture
description: pet_owners join table, co-owner invites, permission model, mobile UI surface points.
---

## Schema

- **`pet_owners`** — source of truth for all ownership. Columns: `pet_id`, `user_id`, `role` (enum `primary`/`co`), `invited_by` (nullable FK → users), `added_at`. UNIQUE(pet_id, user_id).
- **`pet_owner_invites`** — consent gate. Columns: `pet_id`, `inviter_id`, `invitee_id`, `status` (enum `pending`/`accepted`/`declined`), `resolved_at`.
- **`posts.posted_by_user_id`** — nullable FK → users, set on every POST /posts. Audit/moderation ONLY — never sent to client.
- `pets.owner_id` kept as denormalized pointer (not dropped).

## Migration

On first deploy, backfill ran:
- `INSERT INTO pet_owners ... SELECT id, owner_id, 'primary' FROM pets ON CONFLICT DO NOTHING`
- `UPDATE posts SET posted_by_user_id = pets.owner_id FROM pets WHERE posts.pet_id = pets.id AND posts.posted_by_user_id IS NULL`

## Helpers (`artifacts/api-server/src/lib/isPetOwner.ts`)

- `isPetOwner(userId, petId)` — EXISTS on `pet_owners`; use for create-post, edit-pet guards.
- `isPetPrimaryOwner(userId, petId)` — same but role=primary; use for invite creation.
- `getPetOwnerRow(userId, petId)` — returns full row or null.

## Permission Model

| Action | Who can do it |
|---|---|
| Create post as pet | Any pet_owners member |
| Edit/archive/delete a post | Original poster (posted_by_user_id) OR primary owner |
| Edit pet name/breed/avatar | Any pet_owners member |
| Invite a co-owner | Primary owner only |
| Remove a co-owner | Primary owner only |
| Accept/decline invite | Invitee only |

## Response Fields

- `viewerOwnsPet` — true if EXISTS on pet_owners (any role). Drives edit pencil, add-co-owner icon visibility.
- `viewerIsPrimaryOwner` — true if role=primary. Drives invite send button, cancel-pending-invite list.
- `viewerCanManagePost` — per-post: `postedByUserId === userId || isPrimaryOwner`. Drives edit/delete affordance in mobile post modal.

## Block Semantics

`notBlockedPostOwner()` JOINs through `pet_owners` — blocking ANY co-owner of a pet hides the entire pet from the feed.

## API Routes (`artifacts/api-server/src/routes/co-owners.ts`)

- `POST /pets/:petId/co-owner-invites` — primary only; body `{ username }` → resolves to userId → inserts invite
- `GET  /me/co-owner-invites` — pending invites addressed TO the viewer (for profile page + pet profile banner)
- `GET  /pets/:petId/co-owner-invites` — pending sent invites (primary only → 403 for others)
- `GET  /pets/:petId/co-owners` — list of current co-owners
- `POST /co-owner-invites/:id/accept` — invitee; inserts pet_owners co row in transaction + audit
- `POST /co-owner-invites/:id/decline` — invitee OR primary (to cancel); updates status + resolvedAt
- `DELETE /pets/:petId/co-owners/:targetUserId` — primary only; removes co-owner row

## Mobile Surface Points

- **`app/pet/[id].tsx`**: user-plus icon (primary only), pending invite banner with accept/decline (invitee), sent-invites list with cancel (primary), co-owner invite modal (`coOwnerStep` state machine), post modal guard changed to `viewerCanManagePost`.
- **`app/(tabs)/profile.tsx`**: "Co-owner invites" section between MY PETS and MY PACK — fetches GET /me/co-owner-invites, renders accept/decline per invite + link to pet profile.

**Why:** `pets.owner_id` alone can't support multiple owners. Join table pattern with roles gives clean permission separation. `posted_by_user_id` is audit-only to avoid UI complexity (post still appears as the pet's post, not attributed to a specific human).
