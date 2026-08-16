---
name: API Test Suite Harness
description: Vitest+Supertest suite in artifacts/api-server/test/ — rollback-per-test harness design, safeguards, and its limits.
---

## Running
`pnpm --filter @workspace/api-server test` (vitest run). 8 files, one per route group, in `artifacts/api-server/test/`; helpers in `test/helpers/`.

## Harness design (durable decisions)
- **Transaction-per-test**: beforeEach checks out one pg client, BEGINs, monkeypatches `pool.query`/`pool.connect` so ALL app queries run on it; afterEach ALWAYS ROLLBACKs. Route-level drizzle `db.transaction()` BEGIN/COMMIT/ROLLBACK are remapped to SAVEPOINT/RELEASE/ROLLBACK TO.
- **Every `begin` must take the harness mutex.** Drizzle implements nested transactions with explicit SAVEPOINTs, never a second BEGIN — so any BEGIN is a new top-level span. Gating the mutex on "stack empty" let a concurrent request nest its savepoint inside another span and corrupt LIFO order (all requests 500 with "Failed query: commit/rollback"). Non-tx pool queries also wait for the mutex so nothing lands inside another request's savepoint.
- **Why:** one shared connection means interleaved savepoints from parallel requests destroy each other (releasing an earlier savepoint releases later ones).
- **Limit (state honestly):** everything is serialized on one session — concurrency tests verify serialized double-submission behavior + final-state consistency, NOT multi-connection lock contention.

## Safeguard
setup.ts throws before @workspace/db can load unless DATABASE_URL is host `helium` + db `heliumdb`, AND rejects any query parameter except `sslmode` — node-postgres honors `?host=`/`?hostaddr=` routing overrides that would bypass a hostname-only check (architect-caught).

## Auth in tests
`@clerk/backend` is vi.mock'd in setup.ts: verifyToken accepts tokens starting `test_` as the session sub → `Bearer <userId>`; management client throws. Middleware still enforces suspended/deletedAt from the users table.

## Gotchas
- Dev DB has real committed rows — feed tests must scope with `petId=` filter or use relative-order assertions.
- Expecting a failed INSERT (e.g. write-guard trigger)? Wrap in `db.transaction` so the failure rolls back to a savepoint instead of aborting the outer test tx; drizzle wraps pg errors — match on `err.cause.message` too.
- Rate-limiter maps are module-level keyed by userId → fresh user per test isolates counters; limiter runs before body validation so invalid bodies consume budget cheaply.
- App-store-critical flows (auth, account deletion, reports/blocks) are tagged `[APP-STORE-CRITICAL]` in describe names — Apple reviewers manually test these.
