/**
 * Global test setup — runs before every test file.
 *
 * 1. HARD SAFEGUARD: refuse to run against anything that is not the known
 *    dev database. The Replit dev DB is always `postgresql://…@helium/heliumdb`;
 *    production (and any other environment) has a different host/db name.
 *    This check runs BEFORE @workspace/db (and therefore the pg Pool) can be
 *    imported by any test, so a mispointed DATABASE_URL can never even open
 *    a connection.
 *
 * 2. Mock @clerk/backend so tests never call Clerk:
 *    - verifyToken accepts any token starting with "test_" and returns it as
 *      the session subject → `Authorization: Bearer <userId>` authenticates
 *      as that user (the middleware still enforces suspended/tombstoned
 *      status from OUR users table, which is what we're testing).
 *    - Anything else throws → exercises the 401 invalid-token path.
 *    - The management client is stubbed to throw: no test may reach Clerk.
 */
import { vi } from "vitest";

const raw = process.env.DATABASE_URL;
if (!raw) {
  throw new Error("TEST SAFEGUARD: DATABASE_URL is not set — refusing to run.");
}
let host = "";
let dbname = "";
try {
  const u = new URL(raw);
  host = u.hostname;
  dbname = u.pathname;
} catch {
  throw new Error("TEST SAFEGUARD: DATABASE_URL is not a parseable URL — refusing to run.");
}
if (host !== "helium" || dbname !== "/heliumdb") {
  throw new Error(
    `TEST SAFEGUARD: DATABASE_URL points at "${host}${dbname}", not the known dev database ` +
    `(helium/heliumdb). Tests NEVER run against production. Refusing to run.`,
  );
}
// node-postgres honors connection-routing overrides in the query string
// (?host=..., ?hostaddr=..., etc.), which would bypass the hostname check —
// reject every query parameter except sslmode.
{
  const u = new URL(raw);
  for (const key of u.searchParams.keys()) {
    if (key.toLowerCase() !== "sslmode") {
      throw new Error(
        `TEST SAFEGUARD: DATABASE_URL carries a "${key}" query parameter, which can ` +
        `override connection routing past the dev-database check. Refusing to run.`,
      );
    }
  }
}

vi.mock("@clerk/backend", () => ({
  verifyToken: async (token: string) => {
    if (typeof token === "string" && token.startsWith("test_")) {
      return { sub: token };
    }
    throw new Error("mock verifyToken: invalid token");
  },
  createClerkClient: () => ({
    users: {
      getUser: async () => {
        throw new Error("Clerk management API is disabled in tests");
      },
      deleteUser: async () => {
        throw new Error("Clerk management API is disabled in tests");
      },
    },
  }),
}));
