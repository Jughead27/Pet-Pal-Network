#!/bin/bash
set -e

# Apply any pending schema changes to the database (idempotent — drizzle-kit
# compares the live schema to the Drizzle definitions and only runs DDL for
# columns/tables that are missing).  Must run BEFORE the seed so the seed's
# SELECT/UPDATE queries can reference every column in the current schema.
echo "Pushing schema to database..."
pnpm --filter @workspace/db run push-force

# Seed production database with reference data (idempotent — ON CONFLICT DO NOTHING).
# Safe to run on every deploy. Only inserts species, breeds, config, and backfills
# existing pets; never touches user/post content.
echo "Seeding production database..."
pnpm -C lib/db exec tsx src/seed.ts

# Clean pnpm store to reduce image size
pnpm store prune
