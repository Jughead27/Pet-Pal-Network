import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API routes ───────────────────────────────────────────────────────────────
// Registered first so /api/* is never shadowed by static serving below.
app.use("/api", router);

// ─── Static web app serving ───────────────────────────────────────────────────
// Serves the Expo web export built by `expo export --platform web`.
// Only active when dist-web/ exists (production). In development the Expo dev
// server handles / directly on its own port, and dist-web/ is absent, so
// neither block below registers — the dev workflow is unchanged.
const WEB_DIST = path.resolve(process.cwd(), "artifacts/mobile/dist-web");

if (fs.existsSync(WEB_DIST)) {
  // Serve JS bundles, fonts, images, and other static assets.
  app.use(express.static(WEB_DIST));

  // SPA fallback: any route that doesn't start with /api returns index.html so
  // client-side routes (e.g. /profile, /post/123) survive a hard refresh.
  //
  // Uses a regex route — required for Express 5 / path-to-regexp v8 which
  // rejects bare * wildcards. The negative lookahead ensures /api and /api/*
  // (including /api/media/<key>) are never matched here.
  app.get(/^(?!\/api(?:\/|$))/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

export default app;
