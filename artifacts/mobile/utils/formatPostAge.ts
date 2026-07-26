/**
 * Formats a post's createdAt timestamp into a compact, all-lowercase age string.
 *
 * Rules (from spec):
 *   < 1 minute  → "now"
 *   < 1 hour    → "12m"
 *   < 24 hours  → "3h"
 *   < 7 days    → "3d"
 *   ≥ 7 days    → "jun 12"  (or "jun 12, 2025" when year ≠ current year)
 *
 * All lowercase. No "ago", no label, no prefix.
 */

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const;

export function formatPostAge(createdAt: string): string {
  const now     = Date.now();
  const then    = new Date(createdAt).getTime();
  const diffMs  = Math.max(0, now - then);
  const diffMin = Math.floor(diffMs  / 60_000);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr  / 24);

  if (diffMin < 1)  return 'now';
  if (diffHr  < 1)  return `${diffMin}m`;
  if (diffDay < 1)  return `${diffHr}h`;
  if (diffDay < 7)  return `${diffDay}d`;

  // Absolute date
  const d    = new Date(createdAt);
  const mon  = MONTHS[d.getMonth()];
  const day  = d.getDate();
  const year = d.getFullYear();

  return year !== new Date().getFullYear()
    ? `${mon} ${day}, ${year}`
    : `${mon} ${day}`;
}
