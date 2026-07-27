---
name: ToS & Legal Architecture
description: Public legal pages, first-login ToS acceptance gate, schema, API route, and migration-to-prod pattern.
---

## Schema additions (users table)
- `accepted_tos_at` — timestamp NULL (never-null after acceptance)
- `accepted_tos_version` — text NULL (null = never accepted; triggers gate on next load)

## Config
- Key: `tos_current_version` — string value (e.g. `"2026-07-27"`). Bump this to re-gate all users on new T&Cs.
- Seeded via `lib/db/seed-tos-config.ts` (one-time; `ON CONFLICT DO NOTHING`).

## API route
`POST /api/tos/accept` (protected, in `routes/tos.ts`, mounted after requireClerkAuth):
- Reads `tos_current_version` from config table at request time (not hardcoded).
- Idempotent: if `user.acceptedTosVersion === currentVersion` → returns `{ ok: true, alreadyAccepted: true }`.
- Otherwise: single transaction — `UPDATE users SET accepted_tos_at, accepted_tos_version` + `writeAudit('tos.accepted', { version })`.

## GET /me additions
`users.ts` GET /me now returns `acceptedTosVersion` and `tosCurrentVersion` (fetched from config in parallel).
Mobile reads these to decide whether to show the gate — no orval codegen needed (cast as `any`).

## Mobile gate (tabs/_layout.tsx)
Pattern mirrors suspension wall: renders inline instead of `<Tabs>` when gate is required.
- Check: `me.acceptedTosVersion !== me.tosCurrentVersion` → show gate.
- `tosAccepted` local state: set to `true` after successful API call; clears gate immediately without /me refetch.
- Gate UI: wordmark, "before you continue." headline, plain-language summary, links to /terms /privacy /guidelines, "agree & continue" bold action, sign-out escape hatch.
- No dismiss button — users can only agree or sign out. They are never trapped without an exit.

## Public pages (no auth guard)
Routes directly in `app/` (not inside `(auth)/` or `(tabs)/`), so no auth redirect applies:
- `app/about.tsx` — full story, portal visual system
- `app/terms.tsx` — T&Cs draft, amber "tester draft — pending legal review" badge
- `app/privacy.tsx` — Privacy draft, same badge
- `app/guidelines.tsx` — anchor line prominent, rule-per-section layout

## Sign-in footer
Credentials step footer: "about · terms · privacy" whisper row added before closing `</View>`.

## Sign-up vision lines (registration step header)
Replaced "follow pets, not people." / "curl up, you're home." in sloganWrap with three vision lines.
Footer: "guidelines · terms · privacy" links added below switchRow.

## Migration to production
1. `pnpm --filter @workspace/db push` — applies `accepted_tos_at` + `accepted_tos_version` columns (safe; nullable, no default).
2. `INSERT INTO config (key, value) VALUES ('tos_current_version', '2026-07-27') ON CONFLICT (key) DO NOTHING` — seeds config if not present.
3. Deploy the updated API server build.
4. All existing users hit the gate once on next load (expected behavior). No data loss; `invited_by` and all other fields unaffected.

**Why:**
Gate must be client-side (inline in TabLayout) rather than middleware to avoid Clerk session timing conflicts on initial load.
Config-driven version means re-gating requires a single DB row update + deploy — no code change.
