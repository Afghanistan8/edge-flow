import { useMemo } from "react";
import { useAccount } from "wagmi";
import { Link } from "@tanstack/react-router";
import { useUserMarkets } from "@/lib/hooks";
import { PositionRow } from "@/components/PositionRow";
import type { Market } from "@/lib/contract";

export function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { data: markets, isLoading, isError, refetch } = useUserMarkets(address);

  // Group by the derived phase, not the stored state. A market can be
  // OPEN / CANDLE_LIVE / READY_TO_SETTLE and still be state=="PENDING",
  // and a terminal refund is state=="REFUNDED" but phase INCONCLUSIVE.
  const grouped = useMemo(() => {
    const active: Market[] = [];
    const settled: Market[] = [];
    for (const m of markets ?? []) {
      if (
        m.phase === "OPEN" ||
        m.phase === "CANDLE_LIVE" ||
        m.phase === "READY_TO_SETTLE"
      ) {
        active.push(m);
      } else {
        settled.push(m);
      }
    }
    return { active, settled };
  }, [markets]);

  if (!isConnected) {
    return (
      <div className="p-6 border border-[var(--ef-edge)] rounded-xl text-sm text-[var(--ef-ink-dim)]">
        Connect a wallet to see your positions.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <span className="ef-tick" />
          <h1 className="ef-mono text-xl tracking-widest uppercase">
            Your positions
          </h1>
        </div>
        <p className="mt-2 text-sm text-[var(--ef-ink-dim)]">
          Every market this wallet has staked into. Claimable amounts come
          straight from the contract; claims are one-shot.
        </p>
      </div>

      {isLoading && <p className="text-sm text-[var(--ef-ink-dim)]">Loading…</p>}

      {isError && (
        <div className="p-4 border border-[var(--ef-down)] rounded-xl flex items-center justify-between">
          <span className="text-sm">Could not load your positions.</span>
          <button
            onClick={() => refetch()}
            className="text-xs ef-mono px-2 py-1 rounded border border-[var(--ef-down)]"
          >
            retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (markets?.length ?? 0) === 0 && (
        <div className="p-6 border border-dashed border-[var(--ef-edge)] rounded-xl text-sm text-[var(--ef-ink-dim)]">
          No positions yet.{" "}
          <Link to="/markets" className="text-[var(--ef-accent)]">
            browse open markets
          </Link>
          .
        </div>
      )}

      <Group title="Active" rows={grouped.active} />
      <Group title="Settled" rows={grouped.settled} />
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: Market[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm ef-mono uppercase tracking-widest text-[var(--ef-ink-dim)] mb-3">
        {title} · {rows.length}
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((m) => (
          <PositionRow key={m.id} market={m} />
        ))}
      </div>
    </section>
  );
}
