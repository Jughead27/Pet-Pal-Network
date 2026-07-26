/**
 * Centralized block-exclusion helpers for Drizzle queries.
 *
 * Each helper returns a correlated NOT EXISTS condition that filters out rows
 * whose relevant owner/author has a block relationship (in either direction)
 * with the viewer.  Apply them in the .where() clause of any query that reads
 * public content.
 *
 * DESIGN RULE: import from here — never inline block logic per-route.
 */

import { sql } from "drizzle-orm";
import { petsTable, commentsTable } from "@workspace/db";

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
