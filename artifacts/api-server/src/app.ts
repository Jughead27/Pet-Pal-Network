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
  // dotfiles: 'allow' is required because Expo's Metro asset pipeline encodes
  // node_modules paths as /assets/__node_modules/.pnpm/... — the ".pnpm"
  // segment starts with a dot, and express.static's default (dotfiles:'ignore')
  // silently returns 404 for any path that contains a dot-prefixed directory.
  app.use(express.static(WEB_DIST, { dotfiles: 'allow' }));

  // SPA fallback: client-side routes (e.g. /profile, /post/123) return
  // index.html so they survive a hard refresh.
  //
  // Uses a regex route — required for Express 5 / path-to-regexp v8 which
  // rejects bare * wildcards. Two negative lookaheads:
  //   1. (?!\/api(?:\/|$))  — never shadows /api/* (including /api/media/<key>)
  //   2. (?!.*\.[a-zA-Z0-9]{1,8}$) — never catches static-asset requests
  //      (.js .css .woff2 .ttf .png .ico .json …); those are served by
  //      express.static above, and if missing they should 404, not return HTML
  //      (returning HTML causes "invalid sfntVersion" font decode errors).
  app.get(/^(?!\/api(?:\/|$))(?!.*\.[a-zA-Z0-9]{1,8}$)/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

export default app;
