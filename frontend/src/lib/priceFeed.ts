// Display-only price feed. Consumed by the market chart in the UI.
// This is a UX affordance. The contract does its own independent fetch
// for settlement and never reads from here.

import type { Asset } from "./config";
import { DISPLAY_PRICE_SOURCE } from "./config";

export interface Candle {
  t: number; // seconds
  o: number;
  h: number;
  l: number;
  c: number;
}

export async function loadDisplayCandles(asset: Asset): Promise<Candle[]> {
  const res = await fetch(DISPLAY_PRICE_SOURCE[asset], { cache: "no-store" });
  if (!res.ok) throw new Error(`display feed ${res.status}`);
  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]);
    const c = Number(row[2]);
    const h = Number(row[3]);
    const l = Number(row[4]);
    const o = Number(row[5]);
    if (Number.isFinite(t) && Number.isFinite(o) && Number.isFinite(c)) {
      out.push({ t, o, h, l, c });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
