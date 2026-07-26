import type { RequestHandler } from "express";

// ─── requireRole ─────────────────────────────────────────────────────────────
//
// Factory that returns a middleware enforcing a minimum role.
// MUST be composed AFTER requireClerkAuth — it reads req.auth.role which
// that middleware sets from our own users table (never from client input).
//
// Usage:
//   router.get("/admin/ping", requireRole("admin"), handler);
//
// Non-matching sessions get a clean 403 JSON error. This is the ONLY place
// admin-ness (or any role) is checked — no inline role checks in routes.
export function requireRole(role: "member" | "admin"): RequestHandler {
  return (req, res, next) => {
    const auth = (req as Express.RequestWithAuth).auth;

    if (!auth) {
      // requireClerkAuth should have already rejected the request; guard anyway.
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (auth.role !== role) {
      res.status(403).json({ error: "Forbidden", requiredRole: role });
      return;
    }

    next();
  };
}
