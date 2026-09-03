import { useMemo } from "react";
import { useAccount } from "wagmi";
import { useUserMarkets } from "@/lib/hooks";
import { formatGen } from "@/lib/format";
import { MarketCard } from "@/components/MarketCard";
import { Link } from "@tanstack/react-router";
import type { Market } from "@/lib/contract";

export function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { data: markets, isLoading } = useUserMarkets(address);

  const grouped = useMemo(() => {
    const pending: Market[] = [];
    const settled: Market[] = [];
    for (const m of markets ?? []) {
      if (m.state === "PENDING") pending.push(m);
      else if (m.state === "REFUNDED" || m.result) settled.push(m);
      else pending.push(m);
    }
    // The per-market claim button lives on the detail page, which has
    // the per-wallet claimable amount from the contract.
    return { pending, settled };
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
          Markets you have staked into. Claims are one-shot; the detail page
          has the claim button per market.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-[var(--ef-ink-dim)]">Loading…</p>
      )}
      {!isLoading && (markets?.length ?? 0) === 0 && (
        <div className="p-6 border border-dashed border-[var(--ef-edge)] rounded-xl text-sm text-[var(--ef-ink-dim)]">
          No positions yet.{" "}
          <Link to="/markets" className="text-[var(--ef-accent)]">
            browse open markets
          </Link>
          .
        </div>
      )}

      <Group title="Pending" rows={grouped.pending} />
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
          <div key={m.id} className="space-y-2">
            <MarketCard market={m} />
            {m.state !== "PENDING" && (
              <div className="text-xs ef-mono text-[var(--ef-ink-dim)] px-1">
                pool {formatGen(m.totalPool)} · paid {formatGen(m.paidOut)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
