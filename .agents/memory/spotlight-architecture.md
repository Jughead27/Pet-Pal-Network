---
name: Spotlight Architecture
description: Featured-pet banner on Sniff — singleton state table, auto/manual resolution, breed filter, admin screen.
---

# Spotlight Architecture

- `spotlight_state` is a **singleton row** (seeded in seed.ts additive block via CREATE TABLE IF NOT EXISTS + guarded INSERT; enum `spotlight_mode` created with DO $$ duplicate_object guard). Updates intentionally have no WHERE — the singleton invariant comes from the seed.
- Resolution (`api-server/src/lib/spotlight.ts`): manual pin wins; vanished/soft-deleted pinned pet **falls through to auto** rather than 404ing. Auto = most treats received over `spotlight_window_days` (config, default 7), tie: most-recent-treat, then pet id. Public payload is id/name/species/coverPhotoUrl ONLY — never expose treat counts or rank (invisible criterion, not a leaderboard).
- `GET /feed` gained `petId` (matches primary pet OR post_pets tag — post_pets is canonical) and `breedId` (**requires** speciesId; server validates breed belongs to species → 400).
- Sniff screen: the Spotlight pet filter is exclusive of species/breed — engaging it resets both. Breed control is progressive disclosure (only when a species chip is selected) and lives inside the chip ScrollView; breed picker is a plain Modal bottom sheet, typographic rows.
- Spec asked banner "between chips and sort", but chips + Fresh|Popular share ONE band (sort absolutely positioned in it) — banner sits directly below the band to honor the preservation clause. **Why:** splitting the band would change the existing header for everyone.
- Admin two-tap confirms must be mutually exclusive: arming pin resets armed clear and vice versa, and every mutation success resets both (review-caught bug: stale armed clear survived a pin, making the next clear one-tap).
