/**
 * startupBackfill.ts
 *
 * Runs once at server startup, AFTER Replit has applied the schema migration.
 * Handles data backfills that seed.ts cannot run during the build phase
 * (because the build runs before schema promotion).
 *
 * All statements are idempotent — safe to run on every startup.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runStartupBackfill(): Promise<void> {
  try {
    // ── pet_owners primary-row backfill ─────────────────────────────────────
    // Populates pet_owners for every pet created before the table existed.
    // New pets have their primary row inserted atomically in POST /pets.
    // ON CONFLICT DO NOTHING makes this a sub-millisecond no-op after the
    // first run.
    const ownerResult = await db.execute(sql`
      INSERT INTO pet_owners (pet_id, user_id, role)
      SELECT id, owner_id, 'primary'
      FROM   pets
      ON CONFLICT DO NOTHING
    `);
    if ((ownerResult.rowCount ?? 0) > 0) {
      logger.info({ rows: ownerResult.rowCount }, "startup: pet_owners backfill inserted rows");
    }

    // ── posts.posted_by_user_id backfill ────────────────────────────────────
    // Sets the audit column for posts created before co-ownership existed.
    // WHERE IS NULL means this is a no-op once all rows are populated.
    const postsResult = await db.execute(sql`
      UPDATE posts
      SET    posted_by_user_id = pets.owner_id
      FROM   pets
      WHERE  posts.pet_id = pets.id
        AND  posts.posted_by_user_id IS NULL
    `);
    if ((postsResult.rowCount ?? 0) > 0) {
      logger.info({ rows: postsResult.rowCount }, "startup: posts.posted_by_user_id backfill updated rows");
    }
  } catch (err) {
    // Log but do not crash the server — a backfill failure is not fatal.
    logger.error({ err }, "startup: backfill failed (non-fatal)");
  }
}
