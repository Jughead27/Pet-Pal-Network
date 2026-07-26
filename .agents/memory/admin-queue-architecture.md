---
name: Admin Queue Architecture
description: Role-gated admin area — reports triage, invite requests, breed suggestions, suspension wall, hiddenByAdmin content moderation.
---

## Design decisions

### hiddenByAdmin column (boolean, not timestamp)
- `posts.hidden_by_admin` and `comments.hidden_by_admin` — boolean, NOT NULL DEFAULT false.
- NOT a timestamp like `archivedAt`; simpler for reads, no need to record when hidden.
- All public reads exclude hidden content via `notHiddenByAdminPost()` and `notHiddenByAdminComment()` in `excludeBlocked.ts` — centralized, same pattern as blocks.
- Owner sees their own hidden posts in the pet profile grid with "hidden" overlay (`pet.viewerOwnsPet` + `post.hiddenByAdmin`); the owner query does NOT filter hidden posts.
- `hiddenByAdmin` transmitted in the pet profile response so mobile can render the overlay.

### suspended column (boolean on users)
- Checked in `requireClerkAuth` before `next()` — returns `403 { error: "suspended" }`.
- Suspension wall is in `(tabs)/_layout.tsx` via `useGetMe()` error check: duck-type `{ status: 403, data: { error: "suspended" } }` (ApiError not exported, so plain duck-typing).
- Full-screen notice rendered inline in TabLayout; no redirect needed.

### Admin routes
- All gated by `requireRole("admin")` applied as router-level middleware in `adminRouter.use(requireRole("admin"))` — nothing slips through.
- `GET /me` exposes `role` so mobile shows/hides the admin link without a separate endpoint.
- Admin link on profile tab: `meData.role === 'admin'` check with `as unknown as { role?: string }` cast (API response type not yet codegen'd to include role).

### Reports triage
- Raw SQL via `db.execute(sql\`...\`)` for the multi-table conditional join (posts OR comments per row).
- Cast: `rows as unknown as Record<string, unknown>[]` — Drizzle `execute` returns `QueryResult<...>`, not an array.
- Sort: `CASE WHEN reason = 'animal_cruelty' THEN 0 ELSE 1 END, created_at ASC`.
- Three actions: dismiss (resolve only), hide (set hiddenByAdmin on content + resolve), suspend (set users.suspended + resolve).
- Unsuspend: `POST /admin/users/:userId/unsuspend` — separate endpoint, not on the report.

### Breed suggestions
- Implicit: pets where `breedId IS NULL AND breed IS NOT NULL AND speciesId IS NOT NULL`.
- Approve = upsert breed with `ON CONFLICT (species_id, name) DO UPDATE` for ci-match dedupe, then UPDATE matching pets.
- Reject = clear `breed = null` on matching pets (owner can re-enter).
- No separate suggestions table needed.

### Breed suggestion dedupe
- Approve uses `lower(breed) = lower(trimmedName)` in the WHERE for both the duplicate-breed check and the pet remap.
- `ON CONFLICT (species_id, name)` requires a unique constraint on `(species_id, name)` in breeds table — verify this exists before running in production.

### Mobile admin area
- Route group: `app/admin/` with `_layout.tsx` (Stack, no header).
- Hub screen at `app/admin/index.tsx` — navigation to reports/invites/breeds.
- Registered in root `_layout.tsx` as `<Stack.Screen name="admin" ... />`.
- Admin link in profile tab: quiet, below "Edit profile", only visible to admins.

**Why:** Centralized pattern prevents per-route bypasses; boolean columns keep queries simple; suspension wall at the auth layer means every endpoint is covered without per-handler changes.
