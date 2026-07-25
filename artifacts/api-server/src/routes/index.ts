import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { requireClerkAuth } from "../middlewares/requireClerkAuth";

const router: IRouter = Router();

// ─── Public routes ────────────────────────────────────────────────────────────
// These are mounted BEFORE requireClerkAuth, so they are always reachable.
router.use(healthRouter); // GET /healthz

// ─── Auth boundary ────────────────────────────────────────────────────────────
// Every route registered after this point requires a valid Clerk session token.
// Requests without one receive HTTP 401.
router.use(requireClerkAuth);

// ─── Protected routes ─────────────────────────────────────────────────────────
// (add feature routers here as the API grows)

export default router;
