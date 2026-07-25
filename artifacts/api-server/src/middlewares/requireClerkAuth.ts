import { verifyToken, createClerkClient } from "@clerk/backend";
import type { RequestHandler } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// ─── Clerk client singleton ───────────────────────────────────────────────────
// Used only for user provisioning (fetching email from Clerk when creating a
// new user row).  Token verification uses the stateless verifyToken() helper.
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

// ─── requireClerkAuth ─────────────────────────────────────────────────────────
//
// 1. Reads the Bearer token from Authorization header.
// 2. Verifies it with Clerk's public key infrastructure.
// 3. Ensures a row exists in `users` for that Clerk ID (creates one on first
//    sight — username derived from the user's email prefix, de-duplicated).
// 4. Attaches { userId } to req so downstream handlers can use it.
//
// Routes mounted BEFORE this middleware are public (e.g. /healthz).
export const requireClerkAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  let userId: string;

  // ── Step 1: Verify token ─────────────────────────────────────────────────
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    userId = payload.sub;
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // ── Step 2: Ensure user row exists ───────────────────────────────────────
  try {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!existing) {
      // Fetch primary email from Clerk to derive a username
      const clerkUser = await clerkClient.users.getUser(userId);
      const primary = clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId,
      );
      const prefix =
        (primary?.emailAddress ?? "")
          .split("@")[0]
          .replace(/[^a-z0-9._-]/gi, "")
          .toLowerCase() || "user";

      // De-duplicate: append a counter until the username is unique
      let username = prefix;
      let counter = 1;
      for (;;) {
        const [taken] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.username, username));
        if (!taken) break;
        username = `${prefix}${counter++}`;
      }

      await db.insert(usersTable).values({ id: userId, username });
      logger.info({ userId, username }, "Provisioned new user");
    }
  } catch (err) {
    // Provisioning failure must never block the API — log and continue.
    logger.error({ err, userId }, "User provisioning failed");
  }

  (req as Express.RequestWithAuth).auth = { userId };
  next();
};

// ─── Express type augmentation ───────────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface RequestWithAuth extends Request {
      auth?: { userId: string };
    }
  }
}
