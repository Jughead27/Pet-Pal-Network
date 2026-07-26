import { Router } from "express";
import { requireRole } from "../middlewares/requireRole";

// ─── Admin router ─────────────────────────────────────────────────────────────
// All routes here sit behind requireRole("admin").
// The admin queue (moderation, invite approval, etc.) will grow behind this
// same middleware; ping exists solely to prove enforcement end-to-end.
const adminRouter = Router();

adminRouter.get(
  "/admin/ping",
  requireRole("admin"),
  (_req, res) => {
    res.json({ ok: true, role: "admin" });
  },
);

export default adminRouter;
