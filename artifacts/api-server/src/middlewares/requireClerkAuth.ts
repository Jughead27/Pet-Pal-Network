import { verifyToken } from "@clerk/backend";
import type { RequestHandler } from "express";

/**
 * Middleware that rejects requests without a valid Clerk session token.
 *
 * Reads the Bearer token from the Authorization header, verifies it with
 * Clerk's public key infrastructure, and attaches { userId } to req.auth.
 *
 * Excluded routes (e.g. /healthz) must be mounted BEFORE this middleware.
 */
export const requireClerkAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    // Attach userId so downstream handlers can use it.
    (req as Express.RequestWithAuth).auth = { userId: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// Augment Express Request so TypeScript knows about req.auth.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface RequestWithAuth extends Request {
      auth?: { userId: string };
    }
  }
}
