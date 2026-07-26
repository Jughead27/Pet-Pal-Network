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
 * Excludes posts whose pet's owner has blocked the viewer or been blocked by
 * the viewer.
 *
 * REQUIRES: `petsTable` to be inner-joined in the calling query so that
 * `"pets"."owner_id"` is a valid correlated column reference.
 */
export function notBlockedPostOwner(viewerId: string) {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ${petsTable.ownerId})
       OR (b.blocker_id = ${petsTable.ownerId} AND b.blocked_id = ${viewerId})
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
