/**
 * processClerkDeletions — delayed Clerk-side hard delete for tombstoned accounts.
 *
 * Grace period: after deleteAccount() tombstones a user locally, the Clerk
 * account is kept for GRACE_PERIOD_DAYS so the deletion could in principle be
 * reversed by support. During the window the user still cannot use the app —
 * requireClerkAuth rejects any user whose row has deleted_at set.
 *
 * TRIGGER MECHANISM — identical to the comment/pet purge helpers: called from
 * GET /admin/cron/purge (X-Purge-Secret guarded), so any external daily cron
 * completes pending Clerk deletions. Idempotent: only rows past the grace
 * period with clerk_deleted_at still NULL are touched; a Clerk-side 404
 * (already gone) is treated as success so the row is marked complete.
 */

import { createClerkClient } from "@clerk/backend";
import { db, usersTable } from "@workspace/db";
import { and, isNotNull, isNull, lt, eq } from "drizzle-orm";
import { logger } from "./logger";

const GRACE_PERIOD_DAYS = 7;
const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1_000;

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export async function processClerkDeletions(): Promise<{ processed: number; failed: number }> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);

  const due = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      isNotNull(usersTable.deletedAt),
      lt(usersTable.deletedAt, cutoff),
      isNull(usersTable.clerkDeletedAt),
    ));

  let processed = 0;
  let failed = 0;

  for (const { id } of due) {
    try {
      try {
        await clerkClient.users.deleteUser(id);
      } catch (err: unknown) {
        // Already deleted on Clerk's side → treat as success.
        const status = (err as { status?: number })?.status;
        if (status !== 404) throw err;
      }
      await db
        .update(usersTable)
        .set({ clerkDeletedAt: new Date() })
        .where(eq(usersTable.id, id));
      processed++;
      logger.info({ userId: id }, "Clerk account hard-deleted after grace period");
    } catch (err) {
      // Leave clerk_deleted_at NULL so the next cron run retries.
      failed++;
      logger.error({ err, userId: id }, "Clerk deletion failed — will retry on next cron run");
    }
  }

  return { processed, failed };
}
