#!/bin/bash
set -e

# Seed production database with reference data (idempotent — ON CONFLICT DO NOTHING).
# Safe to run on every deploy. Only inserts species, breeds, config, and backfills
# existing pets; never touches user/post content.
echo "Seeding production database..."
pnpm -C lib/db exec tsx src/seed.ts

# Clean pnpm store to reduce image size
pnpm store prune
