import app from "./app";
import { logger } from "./lib/logger";
import { runStartupBackfill } from "./lib/startupBackfill.js";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run data backfills that depend on the schema migration already being
  // applied.  Non-fatal: a failure is logged but won't take down the server.
  runStartupBackfill();
});
