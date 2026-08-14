// Shared relative-time formatter for admin screens ("5s ago", "3m ago",
// "2h ago", "4d ago"). Canonical version with seconds-level granularity —
// previously duplicated (with drift) across the five admin screens.
export function formatAge(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
