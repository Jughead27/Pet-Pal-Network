---
name: Pet Merge Mechanism
description: Real admin pet-merge (merge_suggestions queue) and the deleted-pet write-guard triggers.
---

## Merge flow
- Admin queue: `POST /admin/merge-suggestions/:id/merge` with `{survivorPetId, mergedPetId}` — must match the suggestion pair (either orientation); admin UI forces a deliberate survivor pick (no default) + confirm summary with per-pet counts from the GET.
- Single transaction: suggestion FOR UPDATE → both pets FOR UPDATE (must be live) → dedupe-then-move post_pets → direct UPDATE posts.pet_id (explicit destination; do NOT reuse reassignPrimaryPetOnDeletion, which is for the no-destination deletion path) → pack_follows and pet_owners via INSERT..SELECT ON CONFLICT ON CONSTRAINT <uniq> DO NOTHING then DELETE → soft-delete merged pet → suggestion actioned + writeAudit last.
- Moved counts = newly inserted (deduped) rows, not source-row counts.
- Boops/treats are post-scoped (post_id only) — they follow posts automatically in any pet migration.

## Deleted-pet write guard (durable rule)
Trigger `reject_writes_to_deleted_pet()` on post_pets/pack_follows/pet_owners (INSERT) and posts (INSERT OR UPDATE OF pet_id), created idempotently in startupBackfill so prod gets it at boot.
**Why:** application-level live-pet checks race with soft-delete/merge transactions holding pets FOR UPDATE; a blocked insert would otherwise attach rows to a retired pet after commit. The trigger takes `FOR KEY SHARE` on the pet row — it blocks behind FOR UPDATE and re-reads deleted_at after the blocker commits, failing loudly (ERRCODE 23503).
**How to apply:** any new table referencing pets.id that must never gain rows for deleted pets should get the same trigger in startupBackfill. Backfills inserting historical rows must filter `pe.deleted_at IS NULL` or they trip the guard.
