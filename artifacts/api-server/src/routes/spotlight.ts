/**
 * GET /spotlight — the current featured pet for the Sniff banner.
 *
 * Response: { pet: { id, name, species, coverPhotoUrl } | null }
 * Never includes treat counts or rank — selection criteria are invisible.
 * Auth-gated globally (requireClerkAuth applied before mounting).
 */

import { Router, type IRouter } from "express";
import { resolveSpotlightPet } from "../lib/spotlight.js";

const router: IRouter = Router();

router.get("/spotlight", async (_req, res) => {
  const pet = await resolveSpotlightPet();
  res.json({ pet });
});

export default router;
