/**
 * IG/TikTok-style count abbreviation for numbers at scale.
 *
 *   0–999        → exact number ("284", "999")
 *   1K–999,999   → one decimal + "K", decimal dropped when .0, rounded
 *                  (1284 → "1.3K", 15000 → "15K")
 *   1M and up    → same pattern with "M" ("3,400,000" → "3.4M")
 *
 * Rounds (1250 → "1.3K"), never truncates. A K-value that rounds up to
 * 1000K promotes to "1M". Negative or non-finite input renders as "0"
 * (counts can never legitimately be negative; don't render broken text).
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));

  const scale = (value: number, suffix: string): string => {
    const r = Math.round(value * 10) / 10;
    return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}${suffix}`;
  };

  if (n < 1_000_000) {
    // 999,950+ rounds to 1000.0K — promote to M instead.
    if (Math.round(n / 100) >= 10_000) return scale(n / 1_000_000, 'M');
    return scale(n / 1000, 'K');
  }
  return scale(n / 1_000_000, 'M');
}
