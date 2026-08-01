#!/bin/bash
set -e

# Schema changes are applied by the Replit Publish flow (diffs dev vs prod,
# surfaces renames for confirmation, applies only the delta).  This script
# must NOT run any schema mutations — DATABASE_URL points to production here.

# Seed production database with reference data (idempotent — ON CONFLICT DO NOTHING).
# Safe to run on every deploy. Only inserts species, breeds, config, and backfills
# existing pets; never touches user/post content.
echo "Seeding production database..."
pnpm -C lib/db exec tsx src/seed.ts

# Clean pnpm store to reduce image size
pnpm store prune
