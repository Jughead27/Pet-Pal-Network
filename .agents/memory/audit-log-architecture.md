---
name: Audit Log Architecture
description: Append-only admin audit_log — writeAudit helper, transaction wiring, viewer endpoint, no update/delete path.
---

## Rule

Every admin mutation must call `writeAudit(tx, actorId, action, targetType, targetId, metadata)` as its LAST step inside a `db.transaction(async (tx) => { ... })` block. If the transaction rolls back, the log entry rolls back with it.

```ts
await db.transaction(async (tx) => {
  await tx.update(...).set(...).where(...);
  await writeAudit(tx, actorId, "report.dismiss", "report", reportId, { reason });
});
```

**Why:** Audit and action must be atomic. Any new admin mutation that doesn't follow this pattern creates invisible gaps in the audit trail.

**How to apply:**
- Import `writeAudit` from `../lib/writeAudit.js`
- Read `actorId` from `(req as Express.RequestWithAuth).auth!.userId`
- action strings: `report.dismiss` | `report.hide` | `report.restore` | `user.suspend` | `user.unsuspend` | `invite_request.contact` | `invite_request.close` | `breed.approve` | `breed.reject`
- metadata: jsonb bag of supporting context (reportId, reason, breedName, petsUpdated, etc.)

## Append-only invariant

**NO update or delete route exists or will be added on audit_log.** The `writeAudit` helper only exports an insert path. No `UPDATE audit_log` or `DELETE FROM audit_log` exists anywhere in the codebase.

## Schema

```
audit_log(
  id         uuid PK default gen_random_uuid(),
  actor_id   text NOT NULL FK → users.id,
  action     text NOT NULL,
  target_type text,
  target_id   text,
  metadata   jsonb,
  created_at timestamp NOT NULL default now()
)
```

## Viewer endpoint

`GET /api/admin/audit?limit=20&offset=0` — uses Drizzle fluent API (not raw SQL), so result is a plain array (no `.rows` destructuring needed). Returns `{ entries: AuditEntry[], total: number }`.

## Production schema path

audit_log reaches production automatically on next Publish via Replit's publish-time schema diff — no manual migration script needed. The dev schema (pushed via `drizzle-kit push`) is the source of truth; Publish diffs it against prod and applies it.
