import { Link } from "@tanstack/react-router";
import type { Market } from "@/lib/contract";
import { PhaseBadge } from "./PhaseBadge";
import { AssetGlyph } from "./AssetGlyph";
import { formatGen, formatPercent } from "@/lib/format";
import { formatGmt1, humanRemaining } from "@/lib/time";

export function MarketCard({ market }: { market: Market }) {
  const upPct = formatPercent(market.upPool, market.totalPool || 1n);
  const now = Math.floor(Date.now() / 1000);
  let phaseHint = "";
  if (market.phase === "OPEN") {
    phaseHint = `Entries close in ${humanRemaining(market.cutoffAt - now)}`;
  } else if (market.phase === "CANDLE_LIVE") {
    phaseHint = `Settles in ${humanRemaining(market.settlesAt - now)}`;
  } else if (market.phase === "READY_TO_SETTLE") {
    phaseHint = "Anyone can call resolve";
  } else {
    phaseHint = `Resolved ${formatGmt1(market.resolvedAt)}`;
  }

  const upPortion =
    market.totalPool > 0n
      ? Number((market.upPool * 10_000n) / market.totalPool) / 100
      : 50;

  return (
    <Link
      to="/market/$id"
      params={{ id: String(market.id) }}
      className="group block rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] hover:border-[var(--ef-edge-hi)] transition-colors overflow-hidden ef-glow"
    >
      <div className="p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--ef-panel-2)] border border-[var(--ef-edge)] flex items-center justify-center text-[var(--ef-accent)]">
          <AssetGlyph asset={market.asset} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="ef-mono text-sm">{market.asset}</span>
            <span className="text-[var(--ef-ink-dim)] text-xs">/</span>
            <span className="ef-mono text-xs text-[var(--ef-ink-dim)]">
              {market.targetDay} GMT+1
            </span>
          </div>
          <div className="mt-1">
            <PhaseBadge phase={market.phase} />
          </div>
        </div>
        <div className="text-right ef-mono text-xs text-[var(--ef-ink-dim)]">
          #{market.id}
        </div>
      </div>

      {/* pool split */}
      <div className="px-4">
        <div className="h-1.5 rounded-full overflow-hidden bg-[var(--ef-panel-2)] border border-[var(--ef-edge)] flex">
          <div
            className="bg-[var(--ef-up)]"
            style={{ width: `${upPortion}%` }}
          />
          <div
            className="bg-[var(--ef-down)]"
            style={{ width: `${100 - upPortion}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] ef-mono">
          <span className="text-[var(--ef-up)]">UP {upPct}</span>
          <span className="text-[var(--ef-ink-dim)]">
            pool {formatGen(market.totalPool)}
          </span>
          <span className="text-[var(--ef-down)]">
            {formatPercent(market.downPool, market.totalPool || 1n)} DOWN
          </span>
        </div>
      </div>

      <div className="px-4 pt-3 pb-4 mt-2 border-t border-[var(--ef-edge)] flex items-center justify-between text-xs text-[var(--ef-ink-dim)]">
        <span>{phaseHint}</span>
        <span className="text-[var(--ef-accent)] group-hover:translate-x-1 transition-transform">
          →
        </span>
      </div>
    </Link>
  );
}
