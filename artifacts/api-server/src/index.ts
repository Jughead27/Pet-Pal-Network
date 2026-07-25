import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Temporary startup diagnostic — remove after confirming CLERK_SECRET_KEY ──
const ck = process.env.CLERK_SECRET_KEY;
logger.info(
  { set: !!ck, length: ck?.length ?? 0, prefix: ck?.slice(0, 8) ?? "(unset)" },
  "CLERK_SECRET_KEY diagnostic",
);
// ── End diagnostic ────────────────────────────────────────────────────────────

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
