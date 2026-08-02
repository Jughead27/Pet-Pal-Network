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
    // ── pet_owners backfill ──────────────────────────────────────────────────
    // Populates pet_owners for every pet created before the table existed.
    // New pets have their ownership row inserted atomically in POST /pets.
    // ON CONFLICT DO NOTHING makes this a sub-millisecond no-op after the
    // first run.  No role column — ownership is fully symmetric.
    const ownerResult = await db.execute(sql`
      INSERT INTO pet_owners (pet_id, user_id)
      SELECT id, owner_id
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
    // ── post_pets backfill ───────────────────────────────────────────────────
    // Populates post_pets for all posts created before multi-pet tagging existed.
    // Uses posts.pet_id + posts.posted_by_user_id as the tagged_by_user_id.
    // ON CONFLICT DO NOTHING makes this idempotent.
    const postPetsResult = await db.execute(sql`
      INSERT INTO post_pets (post_id, pet_id, tagged_by_user_id)
      SELECT p.id, p.pet_id, COALESCE(p.posted_by_user_id, pe.owner_id)
      FROM   posts p
      JOIN   pets  pe ON pe.id = p.pet_id
      ON CONFLICT DO NOTHING
    `);
    if ((postPetsResult.rowCount ?? 0) > 0) {
      logger.info({ rows: postPetsResult.rowCount }, "startup: post_pets backfill inserted rows");
    }
  } catch (err) {
    // Log but do not crash the server — a backfill failure is not fatal.
    logger.error({ err }, "startup: backfill failed (non-fatal)");
  }
}
