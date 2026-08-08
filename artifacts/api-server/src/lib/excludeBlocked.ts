/**
 * Centralized content-exclusion helpers for Drizzle queries.
 *
 * Block exclusion: correlated NOT EXISTS against the blocks table.
 * Admin-hide exclusion: simple column equality checks.
 *
 * DESIGN RULE: import from here — never inline block or admin-hide logic
 * per-route.  All public content reads must go through these helpers.
 */

import { sql, eq } from "drizzle-orm";
import { petsTable, postsTable, commentsTable } from "@workspace/db";

// ─── Block exclusion ─────────────────────────────────────────────────────────

/**
 * Excludes posts where the viewer has a block relationship with ANY co-owner
 * of the post's pet.  If the viewer blocks even one owner, the entire pet and
 * all its posts are hidden (safest per spec).
 *
 * REQUIRES: `petsTable` to be inner-joined in the calling query so that
 * `"pets"."id"` is a valid correlated column reference.
 *
 * Implementation: correlated NOT EXISTS that joins pet_owners to find all
 * owners of the pet, then checks blocks for any of them.
 */
export function notBlockedPostOwner(viewerId: string) {
  return sql<boolean>`NOT EXISTS (
    SELECT 1
    FROM   pet_owners po
    JOIN   blocks b ON (
             (b.blocker_id = ${viewerId}  AND b.blocked_id  = po.user_id)
          OR (b.blocker_id = po.user_id   AND b.blocked_id  = ${viewerId})
    )
    WHERE  po.pet_id = ${petsTable.id}
  )`;
}

/**
 * Excludes comments whose author has blocked the viewer or been blocked by
 * the viewer.
 *
 * REQUIRES: `commentsTable` to be in scope (joined or the FROM table) so that
 * `"comments"."user_id"` is a valid correlated column reference.
 */
export function notBlockedCommentAuthor(viewerId: string) {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ${commentsTable.userId})
       OR (b.blocker_id = ${commentsTable.userId} AND b.blocked_id = ${viewerId})
  )`;
}

/**
 * Boolean flag: does a block relationship (either direction) exist between the
 * viewer and ANY co-owner of the post's pet?  For reaction writes (boops,
 * treats) — blocked users can't interact with content they can't see.
 *
 * REQUIRES: `postsTable` to be the FROM table (or joined) so that
 * `"posts"."pet_id"` is a valid correlated column reference.
 */
export function blockedFromPostPetOwners(viewerId: string) {
  return sql<boolean>`EXISTS (
    SELECT 1
    FROM   pet_owners po
    JOIN   blocks b ON (
             (b.blocker_id = ${viewerId}  AND b.blocked_id  = po.user_id)
          OR (b.blocker_id = po.user_id   AND b.blocked_id  = ${viewerId})
    )
    WHERE  po.pet_id = ${postsTable.petId}
  )`;
}

// ─── Admin-hide exclusion ─────────────────────────────────────────────────────

/**
 * Excludes posts that an admin has hidden.
 *
 * Apply to every public post read.  Owner-only surfaces (pet profile archived
 * section) should NOT apply this — owners see their own hidden posts with a
 * "hidden by moderation" note.
 *
 * REQUIRES: `postsTable` to be in scope in the calling query.
 */
export function notHiddenByAdminPost() {
  return eq(postsTable.hiddenByAdmin, false);
}

/**
 * Excludes comments that an admin has hidden.
 *
 * REQUIRES: `commentsTable` to be in scope in the calling query.
 */
export function notHiddenByAdminComment() {
  return eq(commentsTable.hiddenByAdmin, false);
}
