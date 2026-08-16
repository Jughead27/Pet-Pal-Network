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
      WHERE  deleted_at IS NULL
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
    // Live pets only — deleted pets' tags are never read, and the deleted-pet
    // write guard below would (correctly) reject them.
    const postPetsResult = await db.execute(sql`
      INSERT INTO post_pets (post_id, pet_id, tagged_by_user_id)
      SELECT p.id, p.pet_id, COALESCE(p.posted_by_user_id, pe.owner_id)
      FROM   posts p
      JOIN   pets  pe ON pe.id = p.pet_id
      WHERE  pe.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `);
    if ((postPetsResult.rowCount ?? 0) > 0) {
      logger.info({ rows: postPetsResult.rowCount }, "startup: post_pets backfill inserted rows");
    }

    // ── Deleted-pet write guard (triggers) ───────────────────────────────────
    // Closes the race between any live-pet check in application code and a
    // concurrent soft-delete/merge holding the pets row FOR UPDATE: the
    // trigger takes FOR KEY SHARE on the pet row, which BLOCKS behind FOR
    // UPDATE, then re-reads deleted_at after the blocker commits — so an
    // insert that raced a pet merge/deletion fails loudly instead of leaving
    // a follow/tag/ownership row attached to a retired pet.
    //
    // Normal writes are unaffected: FK checks already take KEY SHARE, and
    // KEY SHARE locks don't conflict with each other.
    //
    // Existing rows referencing deleted pets (e.g. posts whose primary pet
    // died with no surviving tag) are untouched — triggers fire only on new
    // INSERTs and on UPDATEs that actually change pet_id.
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION reject_writes_to_deleted_pet() RETURNS trigger AS $$
      DECLARE dead timestamp;
      BEGIN
        SELECT deleted_at INTO dead FROM pets WHERE id = NEW.pet_id FOR KEY SHARE;
        IF dead IS NOT NULL THEN
          RAISE EXCEPTION 'pet % is deleted — cannot attach new rows', NEW.pet_id
            USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    for (const [table, events] of [
      ["post_pets",    "INSERT OR UPDATE OF pet_id"],
      ["pack_follows", "INSERT"],
      ["pet_owners",   "INSERT"],
      ["posts",        "INSERT OR UPDATE OF pet_id"],
    ] as const) {
      await db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS ${table}_deleted_pet_guard ON ${table};
        CREATE TRIGGER ${table}_deleted_pet_guard
          BEFORE ${events} ON ${table}
          FOR EACH ROW EXECUTE FUNCTION reject_writes_to_deleted_pet()
      `));
    }
    logger.info("startup: deleted-pet write guard triggers ensured");
  } catch (err) {
    // Log but do not crash the server — a backfill failure is not fatal.
    logger.error({ err }, "startup: backfill failed (non-fatal)");
  }
}
