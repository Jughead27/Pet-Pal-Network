/**
 * Transaction-per-test harness.
 *
 * Every test runs inside a single database transaction that is ALWAYS rolled
 * back in afterEach — pass or fail, nothing a test does can commit.
 *
 * How: before each test we check out one dedicated client from the app's pg
 * Pool, issue BEGIN on it, then monkeypatch `pool.query` and `pool.connect`
 * so every query the app (and the factories) makes runs on that same client,
 * inside the open transaction. Route code that opens its own transaction
 * (drizzle `db.transaction()` → BEGIN/COMMIT/ROLLBACK) is transparently
 * remapped onto SAVEPOINT / RELEASE / ROLLBACK TO SAVEPOINT, so route
 * transaction semantics (including rollback-on-error) still hold without
 * ever committing the outer test transaction.
 *
 * Concurrency note: because everything shares ONE connection, interleaved
 * savepoints from truly parallel route transactions would corrupt each other
 * (releasing an earlier savepoint destroys later ones). A small async mutex
 * therefore serializes route-transaction *spans* (BEGIN→COMMIT/ROLLBACK),
 * and NON-transaction queries are also held out of any open span (they wait
 * for the mutex), so no request's statement can land inside another
 * request's savepoint. The result: concurrent requests execute their DB work
 * strictly serialized on one session. Concurrency tests built on this
 * harness therefore verify serialized double-submission behavior and final
 * state consistency — NOT multi-connection lock contention.
 */
import { afterEach, beforeEach } from "vitest";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import supertest from "supertest";
import app from "../../src/app.js";

const origQuery = pool.query.bind(pool);
const origConnect = pool.connect.bind(pool);

let client: PoolClient | null = null;
let spCounter = 0;
const spStack: string[] = [];

// ── async mutex over route-transaction spans ─────────────────────────────────
let txChain: Promise<void> = Promise.resolve();
let releaseTx: (() => void) | null = null;
function lockTx(): Promise<() => void> {
  let release!: () => void;
  const span = new Promise<void>((r) => (release = r));
  const acquired = txChain.then(() => release);
  txChain = txChain.then(() => span);
  return acquired;
}

function textOf(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg && typeof (arg as { text?: unknown }).text === "string") {
    return (arg as { text: string }).text;
  }
  return "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function routedQuery(...args: any[]): Promise<any> {
  if (!client) throw new Error("test harness: query outside an open test transaction");
  const text = textOf(args[0]).trim().toLowerCase();

  if (/^begin\b/.test(text)) {
    // EVERY "begin" is a top-level route transaction (drizzle implements
    // nested transactions with explicit SAVEPOINT statements, never a second
    // BEGIN), so every span must take the mutex — otherwise a concurrent
    // request's savepoint nests inside another span and corrupts LIFO order.
    releaseTx = await lockTx();
    const name = `test_sp_${++spCounter}`;
    spStack.push(name);
    return client.query(`SAVEPOINT ${name}`);
  }
  if (/^commit\b/.test(text)) {
    const name = spStack.pop();
    const out = name ? await client.query(`RELEASE SAVEPOINT ${name}`) : undefined;
    if (spStack.length === 0 && releaseTx) { releaseTx(); releaseTx = null; }
    return out;
  }
  if (/^rollback\b/.test(text) && !/^rollback\s+to\b/.test(text)) {
    const name = spStack.pop();
    let out;
    if (name) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      out = await client.query(`RELEASE SAVEPOINT ${name}`);
    }
    if (spStack.length === 0 && releaseTx) { releaseTx(); releaseTx = null; }
    return out;
  }
  // Non-transaction query (pool.query path): keep it out of any open route
  // transaction span — wait for the mutex, run, release immediately.
  const release = await lockTx();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (client.query as any)(...args);
  } finally {
    release();
  }
}

/**
 * Queries issued INSIDE a route transaction span arrive via the proxy client
 * drizzle received from pool.connect(). Control statements go through the
 * shared remapping; everything else runs directly — the span already holds
 * the mutex, so gating these would self-deadlock.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function spanQuery(...args: any[]): Promise<any> {
  if (!client) throw new Error("test harness: query outside an open test transaction");
  const text = textOf(args[0]).trim().toLowerCase();
  if (/^begin\b/.test(text) || /^commit\b/.test(text) || (/^rollback\b/.test(text) && !/^rollback\s+to\b/.test(text))) {
    return routedQuery(...args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client.query as any)(...args);
}

/** Facade handed to drizzle when route code calls pool.connect(). */
function makeProxyClient(): PoolClient {
  return new Proxy({} as PoolClient, {
    get(_t, prop) {
      if (prop === "query") return spanQuery;
      if (prop === "release") return () => {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (client as any)?.[prop];
      return typeof v === "function" ? v.bind(client) : v;
    },
  });
}

beforeEach(async () => {
  client = await origConnect();
  await client.query("BEGIN");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).query = routedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).connect = async () => makeProxyClient();
});

afterEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).query = origQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).connect = origConnect;
  spStack.length = 0;
  spCounter = 0;
  if (releaseTx) { releaseTx(); releaseTx = null; }
  txChain = Promise.resolve();
  if (client) {
    // ALWAYS roll back — win or fail, nothing a test did survives.
    await client.query("ROLLBACK");
    client.release();
    client = null;
  }
});

// ── request helpers ───────────────────────────────────────────────────────────
export const api = supertest(app);

/** Authenticated request builder for a test user id (mock accepts test_* tokens). */
export function asUser(userId: string) {
  return {
    get:    (path: string) => api.get(`/api${path}`).set("Authorization", `Bearer ${userId}`),
    post:   (path: string) => api.post(`/api${path}`).set("Authorization", `Bearer ${userId}`),
    patch:  (path: string) => api.patch(`/api${path}`).set("Authorization", `Bearer ${userId}`),
    delete: (path: string) => api.delete(`/api${path}`).set("Authorization", `Bearer ${userId}`),
  };
}
