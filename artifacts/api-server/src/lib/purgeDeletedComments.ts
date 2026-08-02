/**
 * purgeDeletedComments — hard-delete comments soft-deleted for > 30 days.
 *
 * Comments have no associated media, so unlike purgeSoftDeletedPets there is
 * no R2 cleanup step — this is a straight DB delete.
 *
 * ─── TRIGGER MECHANISM ────────────────────────────────────────────────────────
 * Called by GET /admin/cron/purge alongside purgeSoftDeletedPets().  That route
 * is guarded by an X-Purge-Secret header (PURGE_SECRET env var) rather than a
 * Clerk session, so it is safe to invoke from an external cron provider:
 *
 *   • Render Cron Job:  GET /admin/cron/purge  schedule "0 3 * * *"  (03:00 UTC)
 *   • Vercel crons:     add { "path": "/api/admin/cron/purge", "schedule": "0 3 * * *" }
 *   • Self-hosted:      node-cron "0 3 * * *" inside the server process
 *
 * The function is idempotent — only rows with deletedAt < now()-30 days are
 * touched, so running it multiple times per day is safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db, commentsTable } from "@workspace/db";
import { and, isNotNull, lt } from "drizzle-orm";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export async function purgeDeletedComments(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const deleted = await db
    .delete(commentsTable)
    .where(and(isNotNull(commentsTable.deletedAt), lt(commentsTable.deletedAt, cutoff)))
    .returning({ id: commentsTable.id });

  return { purged: deleted.length };
}
