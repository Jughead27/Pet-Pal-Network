import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Guard against uncaught 'error' events on idle pool clients.
// Without this listener, Node.js treats a socket-level error (e.g. a Neon
// serverless connection reset on wake-from-suspend) as an uncaught exception
// and crashes the entire process.  Logging it here lets the pool reconnect
// on the next request instead.
pool.on("error", (err) => {
  console.error("[pg pool] idle client error — will reconnect on next request:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
