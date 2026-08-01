/**
 * Centralised pet-query helpers — soft-delete gating.
 *
 * Every route that reads from petsTable MUST compose `activePets` into its
 * WHERE clause.  Admin routes that legitimately need full visibility
 * (including soft-deleted pets) MUST use `PETS_INCLUDING_DELETED` instead.
 *
 *   grep "PETS_INCLUDING_DELETED" → MUST return only admin.ts
 *
 * Usage — regular read (direct):
 *   .where(and(eq(petsTable.id, id), activePets))
 *
 * Usage — regular read (join):
 *   .innerJoin(petsTable, eq(petsTable.id, someTable.petId))
 *   .where(and(..., activePets))
 *
 * Usage — admin opt-out (join):
 *   .innerJoin(petsTable, and(eq(petsTable.id, someTable.petId), PETS_INCLUDING_DELETED))
 */

import { isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { petsTable } from "@workspace/db";

/**
 * WHERE-clause fragment that excludes soft-deleted pets.
 * Compose into every read that touches petsTable.
 */
export const activePets: SQL = isNull(petsTable.deletedAt);

/**
 * Admin-only opt-out from deleted_at filtering.
 *
 * Evaluates to SQL TRUE so it can be composed into a Drizzle and() call
 * without altering the query's semantics.  Its sole purpose is to make the
 * intentional opt-out visible in code and greppable via:
 *
 *   grep "PETS_INCLUDING_DELETED" → MUST return only admin.ts
 */
export const PETS_INCLUDING_DELETED: SQL = sql`TRUE`;
