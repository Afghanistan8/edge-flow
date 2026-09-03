import type { Market, SettlementEvidence } from "@/lib/contract";
import { formatGmt1 } from "@/lib/time";

function scaledToDecimal(v: bigint, scale: bigint): string {
  if (scale === 0n) return "-";
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(scale.toString().length - 1, "0");
  return `${whole}.${frac.slice(0, 6).replace(/0+$/, "") || "0"}`;
}

export function EvidencePanel({
  market,
  evidence,
}: {
  market: Market;
  evidence: SettlementEvidence;
}) {
  if (market.state === "PENDING") {
    return (
      <div className="p-4 rounded-lg border border-dashed border-[var(--ef-edge)] text-xs text-[var(--ef-ink-dim)]">
        Evidence appears once <code className="ef-mono">resolve_market</code> is
        called successfully.
      </div>
    );
  }
  if (evidence.terminalRefund) {
    return (
      <div className="p-4 rounded-lg border border-[var(--ef-edge)] bg-[var(--ef-panel-2)] space-y-2 text-sm">
        <div className="text-[var(--ef-warn)] uppercase text-xs tracking-widest ef-mono">
          Terminal refund
        </div>
        <p className="text-[var(--ef-ink-dim)]">
          No CoinGecko + Gate.io evidence became verifiable within{" "}
          {formatGmt1(market.terminalRefundAt)}. Original stakes are refundable.
          No source direction was fabricated.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--ef-edge)] bg-[var(--ef-panel-2)] p-4 space-y-4 text-sm">
      <div className="text-xs uppercase tracking-widest text-[var(--ef-ink-dim)] ef-mono">
        Settlement evidence · resolved {formatGmt1(evidence.resolvedAt)}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <SourceRow
          name="CoinGecko"
          open={evidence.coinmarketOpen}
          close={evidence.coinmarketClose}
          dir={evidence.coinmarketDirection}
          scale={evidence.priceScale}
        />
        <SourceRow
          name="Gate.io"
          open={evidence.gateOpen}
          close={evidence.gateClose}
          dir={evidence.gateDirection}
          scale={evidence.priceScale}
        />
      </div>
      <div className="pt-3 border-t border-[var(--ef-edge)] flex items-center justify-between">
        <span className="text-xs text-[var(--ef-ink-dim)] uppercase tracking-widest ef-mono">
          Final
        </span>
        <span className="ef-mono text-sm">{evidence.finalResult}</span>
      </div>
    </div>
  );
}

function SourceRow({
  name,
  open,
  close,
  dir,
  scale,
}: {
  name: string;
  open: bigint;
  close: bigint;
  dir: string;
  scale: bigint;
}) {
  const color =
    dir === "UP"
      ? "text-[var(--ef-up)]"
      : dir === "DOWN"
      ? "text-[var(--ef-down)]"
      : "text-[var(--ef-ink-dim)]";
  return (
    <div className="p-3 rounded border border-[var(--ef-edge)] bg-[var(--ef-panel)]">
      <div className="text-xs text-[var(--ef-ink-dim)] uppercase tracking-widest ef-mono">
        {name}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <div className="text-xs text-[var(--ef-ink-dim)]">
          open
          <div className="ef-mono text-sm text-[var(--ef-ink)]">
            {scaledToDecimal(open, scale)}
          </div>
        </div>
        <div className="text-xs text-[var(--ef-ink-dim)]">
          close
          <div className="ef-mono text-sm text-[var(--ef-ink)]">
            {scaledToDecimal(close, scale)}
          </div>
        </div>
        <div className={`text-sm ef-mono uppercase ${color}`}>{dir || "—"}</div>
      </div>
    </div>
  );
}
