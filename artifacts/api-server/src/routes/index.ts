import { Router, type IRouter } from "express";
import healthRouter from "./health";
import feedRouter from "./feed";
import petsRouter from "./pets";
import postsRouter from "./posts";
import { requireClerkAuth } from "../middlewares/requireClerkAuth";

const router: IRouter = Router();

// ─── Public routes ────────────────────────────────────────────────────────────
// Mounted BEFORE requireClerkAuth — always reachable without a token.
router.use(healthRouter); // GET /healthz

// ─── Auth boundary ────────────────────────────────────────────────────────────
// Every route registered after this point requires a valid Clerk session token.
// Unauthenticated requests receive HTTP 401.
router.use(requireClerkAuth);

// ─── Protected routes ─────────────────────────────────────────────────────────
router.use(feedRouter);  // GET /feed
router.use(petsRouter);  // GET /pets/:id
router.use(postsRouter); // GET /posts/:id/comments

export default router;
