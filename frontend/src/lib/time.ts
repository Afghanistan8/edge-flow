// Time helpers. Edge-Flow settles on a fixed GMT+1 day boundary — no DST.
// All display strings must be explicit about the timezone.

export const GMT_PLUS_ONE_SECONDS = 3600;
export const DAY_SECONDS = 86_400;

export function gmt1DayStartUtc(targetDay: string): number {
  // Parse YYYY-MM-DD as a UTC midnight, then shift back by one hour.
  const [y, m, d] = targetDay.split("-").map((s) => Number.parseInt(s, 10));
  if (!y || !m || !d) throw new Error(`bad date: ${targetDay}`);
  const midnightUtc = Date.UTC(y, m - 1, d) / 1000;
  return midnightUtc - GMT_PLUS_ONE_SECONDS;
}

export function formatGmt1(ts: number): string {
  // Show as HH:mm GMT+1, YYYY-MM-DD (GMT+1).
  const d = new Date(ts * 1000 + GMT_PLUS_ONE_SECONDS * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} GMT+1`;
}

export function todayGmt1(): string {
  const now = new Date(Date.now() + GMT_PLUS_ONE_SECONDS * 1000);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDaysGmt1(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map((s) => Number.parseInt(s, 10));
  const base = new Date(Date.UTC(y!, (m ?? 1) - 1, d));
  base.setUTCDate(base.getUTCDate() + delta);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function humanRemaining(seconds: number): string {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / DAY_SECONDS);
  const h = Math.floor((seconds % DAY_SECONDS) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
