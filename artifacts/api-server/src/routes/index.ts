import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mediaRouter  from "./media";
import feedRouter from "./feed";
import petsRouter from "./pets";
import postsRouter from "./posts";
import uploadsRouter from "./uploads";
import speciesRouter from "./species";
import packRouter from "./pack";
import followsRouter from "./follows";
import usersRouter from "./users";
import adminRouter from "./admin";
import reportsRouter from "./reports";
import blocksRouter from "./blocks";
import feedbackRouter from "./feedback";
import invitesMemberRouter from "./invites-member";
import tosRouter from "./tos";
import coOwnersRouter from "./co-owners";
import quotaRequestsRouter from "./quota-requests";
import notificationsRouter from "./notifications";
import { requireClerkAuth } from "../middlewares/requireClerkAuth";
import invitesRouter from "./invites";
import spotlightRouter from "./spotlight";

const router: IRouter = Router();

// ─── Public routes ────────────────────────────────────────────────────────────
// Mounted BEFORE requireClerkAuth — always reachable without a token.
router.use(healthRouter);  // GET /healthz
router.use(mediaRouter);   // GET /media/* — HMAC-token-gated, no Clerk session
router.use(invitesRouter); // POST /invites/request — public invite capture

// ─── Auth boundary ────────────────────────────────────────────────────────────
// Every route registered after this point requires a valid Clerk session token.
// Unauthenticated requests receive HTTP 401.
router.use(requireClerkAuth);

// ─── Protected routes ─────────────────────────────────────────────────────────
router.use(feedRouter);    // GET /feed
router.use(spotlightRouter); // GET /spotlight — featured pet for Sniff banner
router.use(petsRouter);    // GET /pets/:id  POST /pets  GET /me/pets
router.use(postsRouter);   // GET /posts/:id/comments  POST /posts/:id/{boops,treats,comments}
router.use(uploadsRouter); // POST /uploads/presign
router.use(speciesRouter); // GET /species  GET /species/:id/breeds
router.use(packRouter);    // POST /pets/:id/pack  DELETE /pets/:id/pack
router.use(followsRouter); // POST/DELETE /follows/species/:id  POST/DELETE /follows/breeds/:id  GET /me/follows
router.use(usersRouter);  // GET /me  PATCH /me
router.use(adminRouter);  // GET /admin/ping — and future admin routes
router.use(reportsRouter); // POST /reports
router.use(blocksRouter);  // POST /blocks  DELETE /blocks/:id  GET /blocks
router.use(feedbackRouter);      // POST /feedback
router.use(invitesMemberRouter); // POST /invites/redeem  POST /invites  GET /invites/mine  POST /invites/:id/revoke
router.use(tosRouter);           // POST /tos/accept
router.use(coOwnersRouter);      // co-owner invite + management routes
router.use(quotaRequestsRouter); // POST /quota-requests  GET /quota-requests/mine
router.use(notificationsRouter); // GET /notifications  PATCH /notifications/read-all

export default router;
