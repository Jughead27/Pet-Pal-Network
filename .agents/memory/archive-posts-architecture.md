---
name: Archive Posts Architecture
description: How archive/unarchive works — DB column, API endpoints, feed filtering, pet profile response shape, and mobile UI pattern.
---

## Rule
Posts have a nullable `archived_at` timestamp. Archived posts are hidden from all public reads (feed, nursery, pet grid) but remain in the DB with reactions, comments, and media intact.

**Why:** Soft-delete pattern — owner can restore; data is never destroyed.

**How to apply:**
- All public queries (`feed.ts`, main posts query in `pets.ts`) must include `isNull(postsTable.archivedAt)` in WHERE.
- `GET /pets/:id` response always includes `archivedPosts: FeedPost[]` (empty array for non-owners) and `viewerOwnsPet: boolean` (top-level on PetProfile).
- `POST /posts/:id/archive` and `POST /posts/:id/unarchive` are owner-only, idempotent (always set/clear archivedAt regardless of current value), registered in posts router.
- `FeedPost` schema includes `archivedAt` as nullable string (required field, null for active posts).
- `viewerIsOwner` is computed once in pets.ts before `petSummary` and reused for archivedPosts query and response.

## Mobile UI
- `archiveConfirm: boolean` state — mutually exclusive with `deleteConfirm` and `isEditMode`.
- `isSelectedPostArchived = !!selectedPost?.archivedAt` drives Archive ↔ Unarchive label.
- `selectedPost` searches `pet.posts` first, then `pet.archivedPosts` (so archived modal works).
- `archivedExpanded: boolean` controls the collapsible "Archived (N)" row below the grid.
- Archived section hidden when `pet.archivedPosts.length === 0` (non-owners always get empty array).
- `closePostModal` resets `archiveConfirm` in addition to `deleteConfirm` and `isEditMode`.
