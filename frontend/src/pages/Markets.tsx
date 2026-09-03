import { useMemo, useState } from "react";
import { useMarkets, useUserMarkets } from "@/lib/hooks";
import { MarketCard } from "@/components/MarketCard";
import { SUPPORTED_ASSETS, type Asset } from "@/lib/config";
import type { Market, Phase } from "@/lib/contract";
import { useAccount } from "wagmi";
import { formatGen } from "@/lib/format";
import { AssetGlyph } from "@/components/AssetGlyph";

type Filter = "ALL" | "OPEN" | "CANDLE_LIVE" | "READY_TO_SETTLE" | "SETTLED";
type Sort = "CLOSING_SOONEST" | "NEWEST" | "LARGEST_POOL";

function passFilter(m: Market, f: Filter): boolean {
  if (f === "ALL") return true;
  if (f === "SETTLED")
    return m.phase === "UP" || m.phase === "DOWN" || m.phase === "INCONCLUSIVE";
  return m.phase === (f as Phase);
}

function sortFn(a: Market, b: Market, s: Sort) {
  if (s === "NEWEST") return b.createdAt - a.createdAt;
  if (s === "LARGEST_POOL") return Number(b.totalPool - a.totalPool);
  // closing soonest: by cutoffAt if open, then settlesAt
  const ka = a.phase === "OPEN" ? a.cutoffAt : a.settlesAt;
  const kb = b.phase === "OPEN" ? b.cutoffAt : b.settlesAt;
  return ka - kb;
}

export function MarketsPage() {
  const { data: markets, isLoading, isError, refetch } = useMarkets(0, 50);
  const { address } = useAccount();
  const { data: userMarkets } = useUserMarkets(address);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<Sort>("CLOSING_SOONEST");
  const [asset, setAsset] = useState<Asset | "ALL">("ALL");

  const visible = useMemo(() => {
    const rows = (markets ?? [])
      .filter((m) => (asset === "ALL" ? true : m.asset === asset))
      .filter((m) => passFilter(m, filter));
    return [...rows].sort((a, b) => sortFn(a, b, sort));
  }, [markets, filter, sort, asset]);

  const stats = useMemo(() => {
    const rows = markets ?? [];
    const openPool = rows
      .filter((m) => m.phase === "OPEN" || m.phase === "CANDLE_LIVE")
      .reduce((s, m) => s + m.totalPool, 0n);
    const live = rows.filter(
      (m) => m.phase === "OPEN" || m.phase === "CANDLE_LIVE",
    ).length;
    const ready = rows.filter((m) => m.phase === "READY_TO_SETTLE").length;
    return {
      openPool,
      live,
      ready,
      yourCount: userMarkets?.length ?? 0,
    };
  }, [markets, userMarkets]);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <span className="ef-tick" />
          <h1 className="ef-mono text-xl tracking-widest uppercase">
            Daily crypto edges
          </h1>
        </div>
        <p className="mt-2 text-sm text-[var(--ef-ink-dim)] max-w-2xl">
          Predict whether JUP, ZAMA, ATOM or ZRO closes up or down on the GMT+1
          daily candle. Stake 2–8 GEN. Settlement needs Coinmarket and Gate.io
          to agree — no admin, no single feed.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Open pool" value={formatGen(stats.openPool)} />
        <Stat label="Live markets" value={String(stats.live)} />
        <Stat label="Your positions" value={String(stats.yourCount)} />
        <Stat label="Ready to settle" value={String(stats.ready)} />
      </div>

      <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setAsset("ALL")}
          className={`text-xs px-2 py-1.5 rounded border ${
            asset === "ALL"
              ? "border-[var(--ef-accent)] text-[var(--ef-accent)]"
              : "border-[var(--ef-edge)] text-[var(--ef-ink-dim)]"
          } ef-mono`}
        >
          all assets
        </button>
        {SUPPORTED_ASSETS.map((a) => (
          <button
            key={a}
            onClick={() => setAsset(a)}
            className={`text-xs px-2 py-1.5 rounded border flex items-center gap-1 ef-mono ${
              asset === a
                ? "border-[var(--ef-accent)] text-[var(--ef-accent)]"
                : "border-[var(--ef-edge)] text-[var(--ef-ink-dim)] hover:border-[var(--ef-edge-hi)]"
            }`}
          >
            <AssetGlyph asset={a} size={14} />
            {a}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-[var(--ef-edge)]" />
        {(
          ["ALL", "OPEN", "CANDLE_LIVE", "READY_TO_SETTLE", "SETTLED"] as Filter[]
        ).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-1.5 rounded border ef-mono ${
              filter === f
                ? "border-[var(--ef-accent)] text-[var(--ef-accent)]"
                : "border-[var(--ef-edge)] text-[var(--ef-ink-dim)]"
            }`}
          >
            {f.toLowerCase().replaceAll("_", " ")}
          </button>
        ))}
        <div className="flex-1" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="text-xs ef-mono bg-[var(--ef-panel-2)] border border-[var(--ef-edge)] rounded px-2 py-1.5"
        >
          <option value="CLOSING_SOONEST">closing soonest</option>
          <option value="NEWEST">newest</option>
          <option value="LARGEST_POOL">largest pool</option>
        </select>
      </div>

      {isLoading && <Skeleton />}
      {isError && (
        <ErrorState message="Could not load markets." onRetry={() => refetch()} />
      )}
      {!isLoading && !isError && visible.length === 0 && <Empty />}
      {!isLoading && visible.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {visible.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-3">
      <div className="text-[10px] uppercase tracking-widest text-[var(--ef-ink-dim)] ef-mono">
        {label}
      </div>
      <div className="mt-1 ef-mono text-lg">{value}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-40 rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] animate-pulse"
        />
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div className="p-8 border border-dashed border-[var(--ef-edge)] rounded-xl text-center text-sm text-[var(--ef-ink-dim)]">
      No markets match. Try a different filter or{" "}
      <a href="/create" className="text-[var(--ef-accent)]">
        create the first one
      </a>
      .
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-4 border border-[var(--ef-down)] rounded-xl flex items-center justify-between">
      <span className="text-sm">{message}</span>
      <button
        onClick={onRetry}
        className="text-xs ef-mono px-2 py-1 rounded border border-[var(--ef-down)]"
      >
        retry
      </button>
    </div>
  );
}
