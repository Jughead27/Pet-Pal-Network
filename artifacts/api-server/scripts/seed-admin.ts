/**
 * Idempotent admin-promotion seed.
 *
 * Run from artifacts/api-server/:
 *   npx tsx scripts/seed-admin.ts
 *
 * Or from the repo root:
 *   pnpm --filter @workspace/api-server exec npx tsx scripts/seed-admin.ts
 *
 * For each address in ADMIN_EMAILS:
 *   1. Resolves the Clerk user by email (using @clerk/backend).
 *   2. Upserts a row in `users` with role='admin':
 *      - INSERT if they have never signed in (no DB row yet).
 *      - UPDATE if the row already exists.
 *
 * Safe to run twice — already-admin rows emit a skip message and no DB write.
 *
 * Requires:
 *   DATABASE_URL      — postgres connection string
 *   CLERK_SECRET_KEY  — server-side Clerk key
 */

import { createClerkClient } from "@clerk/backend";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

if (!process.env.DATABASE_URL)    throw new Error("DATABASE_URL must be set");
if (!process.env.CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY must be set");

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// ─── Admin email list ─────────────────────────────────────────────────────────
// Add any address that should be an admin. Safe to re-run.
const ADMIN_EMAILS = [
  "james.guilfoyle@verizon.net",
];

async function main() {
  console.log("Promoting admin users…");

  for (const email of ADMIN_EMAILS) {
    // 1. Resolve Clerk ID from email.
    const { data: clerkUsers } = await clerkClient.users.getUserList({
      emailAddress: [email],
    });

    if (clerkUsers.length === 0) {
      console.warn(`  ⚠ No Clerk user found for ${email} — skipping.`);
      continue;
    }

    const clerkId  = clerkUsers[0].id;
    const username = email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").toLowerCase();

    // 2. Check for an existing row.
    const [row] = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, clerkId));

    if (row?.role === "admin") {
      console.log(`  ✓ ${email} (${clerkId}) is already admin — no change.`);
      continue;
    }

    if (!row) {
      // User has never signed in — insert a minimal row with role='admin'.
      // requireClerkAuth will fill in display_name etc. on their first sign-in.
      await db
        .insert(usersTable)
        .values({ id: clerkId, username, role: "admin" })
        .onConflictDoNothing();
      console.log(`  ✓ Inserted ${email} (${clerkId}) as admin (no prior sign-in row).`);
    } else {
      await db
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, clerkId));
      console.log(`  ✓ Promoted ${email} (${clerkId}) to admin.`);
    }
  }

  console.log("Done.");
  // pool.end() is not needed here — the process exits cleanly.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
