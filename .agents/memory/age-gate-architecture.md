---
name: Age Gate Architecture (COPPA 13+)
description: age_affirmed_at column, POST /age/affirm, signup checkbox, retroactive blocking gate in TabLayout, pending-affirm storage pattern.
---

## Schema
- `users.age_affirmed_at` — timestamp NULL. Null = never affirmed 13+ → retroactive gate on next app open. No backfill for existing users (deliberate).

## API
- `POST /api/age/affirm` lives in `routes/tos.ts` (mounted with tosRouter). Concurrency-safe idempotency: atomic `UPDATE ... WHERE age_affirmed_at IS NULL RETURNING`; audit `age.affirmed` written only when a row actually flipped.
- GET /me returns `ageAffirmedAt` (ISO or null). **Not in OpenAPI/orval** — house precedent from ToS fields: mobile casts meData, no codegen churn.

## Signup (sign-up.tsx)
- Third consent checkbox, exact copy "I confirm that I am 13 years of age or older." Required for both email and Google SSO paths (button disabled + error messages, same pattern as tos/animals checkboxes).
- Affirmation persisted via `utils/pendingAgeAffirmStorage.ts` ({email, savedAt}) — mirrors pendingDisplayNameStorage (localStorage web / SecureStore native). OAuth stores `email: ''` (email unknown pre-round-trip).

## Silent apply + retroactive gate (tabs/_layout.tsx)
- Effect after sign-in: if storage present and me.ageAffirmedAt null → POST /age/affirm when (email matches clerkUser) OR (email==='' AND savedAt <15min old AND account createdAt >= savedAt−60s). Clears storage either way; sets pendingAgeChecked.
- Gate (after disabled ToS gate block): shows when meData loaded, ageAffirmedAt null, !ageAffirmed local flag. **Fail closed:** while pendingAgeChecked is false for an unaffirmed account, render blank `gt.root` View — prevents both app access pre-check and gate flash for new signups.
- Gate UI reuses gt.* portal styles + new ageCheck* styles; checkbox-gated "Confirm and Continue"; sign-out escape hatch; no dismiss.
- ToS text: eligibility paragraph is 2nd body paragraph in app/terms.tsx.

**Why:** COPPA self-affirmation (13+, checkbox) is the industry standard; server timestamp only ever set via the affirm endpoint so it's auditable.
**How to apply:** any future re-gating (e.g. version bumps) should copy the ToS config-version pattern instead — age affirmation is one-shot by design.
