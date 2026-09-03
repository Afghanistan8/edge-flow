import { useMarkets } from "@/lib/hooks";
import { formatGen } from "@/lib/format";
import { formatGmt1 } from "@/lib/time";
import { Link } from "@tanstack/react-router";
import { PhaseBadge } from "@/components/PhaseBadge";
import type { Market } from "@/lib/contract";

export function ActivityPage() {
  const { data, isLoading } = useMarkets(0, 50);

  const events = (data ?? [])
    .flatMap((m) => {
      const rows: {
        kind: "created" | "resolved" | "refunded";
        ts: number;
        marketId: number;
        asset: string;
        day: string;
        note?: string;
        m: Market;
      }[] = [
        {
          kind: "created",
          ts: m.createdAt,
          marketId: m.id,
          asset: m.asset,
          day: m.targetDay,
          m,
        },
      ];
      if (m.resolvedAt > 0) {
        rows.push({
          kind: m.state === "REFUNDED" ? "refunded" : "resolved",
          ts: m.resolvedAt,
          marketId: m.id,
          asset: m.asset,
          day: m.targetDay,
          note: m.result || "",
          m,
        });
      }
      return rows;
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 100);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="ef-tick" />
          <h1 className="ef-mono text-xl uppercase tracking-widest">
            Activity
          </h1>
        </div>
        <p className="mt-2 text-sm text-[var(--ef-ink-dim)]">
          Reads directly from contract views. Newest first.
        </p>
      </div>
      {isLoading && (
        <p className="text-sm text-[var(--ef-ink-dim)]">Loading…</p>
      )}
      <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] divide-y divide-[var(--ef-edge)] overflow-hidden">
        {events.map((e, i) => (
          <Link
            key={i}
            to="/market/$id"
            params={{ id: String(e.marketId) }}
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--ef-panel-2)]"
          >
            <span className="text-xs ef-mono text-[var(--ef-ink-dim)] w-40 shrink-0">
              {formatGmt1(e.ts)}
            </span>
            <span className="ef-mono text-xs uppercase tracking-widest w-20 shrink-0 text-[var(--ef-accent)]">
              {e.kind}
            </span>
            <span className="ef-mono text-xs w-16 shrink-0">
              #{e.marketId}
            </span>
            <span className="ef-mono text-sm">{e.asset}</span>
            <span className="text-xs text-[var(--ef-ink-dim)]">
              {e.day} GMT+1
            </span>
            <div className="flex-1" />
            {e.note && (
              <span className="text-xs ef-mono text-[var(--ef-ink-dim)]">
                {e.note}
              </span>
            )}
            <PhaseBadge phase={e.m.phase} />
            <span className="text-xs ef-mono text-[var(--ef-ink-dim)]">
              {formatGen(e.m.totalPool)}
            </span>
          </Link>
        ))}
        {events.length === 0 && !isLoading && (
          <div className="p-6 text-sm text-[var(--ef-ink-dim)] text-center">
            No activity yet.
          </div>
        )}
      </div>
    </div>
  );
}
