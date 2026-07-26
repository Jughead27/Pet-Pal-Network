/**
 * writeAudit — append one row to audit_log inside an existing transaction.
 *
 * Call this as the LAST step of every admin mutation, passing the Drizzle
 * transaction object so the audit entry and the mutation commit together:
 *
 *   await db.transaction(async (tx) => {
 *     await tx.update(...).set(...).where(...);
 *     await writeAudit(tx, actorId, "report.dismiss", "report", reportId, { reason });
 *   });
 *
 * The `tx` parameter accepts the Drizzle transaction object (same insert API
 * as `db`) via a structural Pick so we don't need to import NodePgTransaction.
 *
 * DO NOT add update/delete helpers here.  audit_log is append-only by design.
 */

import { auditLogTable } from "@workspace/db";

// Structural type: anything with an `insert` method that matches Drizzle's
// signature — satisfied by both `db` and the transaction object `tx`.
type Insertable = Pick<
  import("drizzle-orm/node-postgres").NodePgDatabase,
  "insert"
>;

export async function writeAudit(
  tx: Insertable,
  actorId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  await tx.insert(auditLogTable).values({
    actorId,
    action,
    targetType: targetType ?? undefined,
    targetId:   targetId   ?? undefined,
    metadata:   metadata   ?? undefined,
  });
}
