import type { Market } from "@/lib/contract";
import { formatGmt1, humanRemaining } from "@/lib/time";

interface Node {
  label: string;
  ts: number;
  done: boolean;
  active: boolean;
}

export function Lifecycle({ market }: { market: Market }) {
  const now = Math.floor(Date.now() / 1000);
  const nodes: Node[] = [
    {
      label: "Created",
      ts: market.createdAt,
      done: true,
      active: false,
    },
    {
      label: "Entries close (GMT+1 day starts)",
      ts: market.cutoffAt,
      done: now >= market.cutoffAt,
      active: now < market.cutoffAt,
    },
    {
      label: "Candle completes",
      ts: market.settlesAt,
      done: now >= market.settlesAt,
      active: now >= market.cutoffAt && now < market.settlesAt,
    },
    {
      label: "Resolve or retry",
      ts: market.resolvedAt || market.settlesAt,
      done: market.state !== "PENDING" && !market.refundAll,
      active: now >= market.settlesAt && market.state === "PENDING",
    },
    {
      label: "Terminal refund fallback",
      ts: market.terminalRefundAt,
      done: market.state === "REFUNDED",
      active: false,
    },
  ];

  return (
    <ol className="relative border-l border-[var(--ef-edge)] pl-5 space-y-4">
      {nodes.map((n) => {
        const remaining = n.ts - now;
        return (
          <li key={n.label} className="relative">
            <span
              className={`absolute -left-[27px] top-1 w-3 h-3 rounded-full border ${
                n.done
                  ? "bg-[var(--ef-accent)] border-[var(--ef-accent)]"
                  : n.active
                  ? "bg-[var(--ef-warn)] border-[var(--ef-warn)] animate-pulse"
                  : "bg-[var(--ef-panel)] border-[var(--ef-edge-hi)]"
              }`}
            />
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm">{n.label}</span>
              <span className="text-xs text-[var(--ef-ink-dim)] ef-mono">
                {formatGmt1(n.ts)}
              </span>
              {!n.done && remaining > 0 && (
                <span className="text-xs text-[var(--ef-accent)] ef-mono">
                  in {humanRemaining(remaining)}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
