import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import type { Market } from "@/lib/contract";
import {
  useClaim,
  useClaimable,
  useMarket,
  useMarkets,
  usePosition,
  useResolve,
  useSettlementEvidence,
  useTakePosition,
} from "@/lib/hooks";
import { AssetGlyph } from "@/components/AssetGlyph";
import { PhaseBadge } from "@/components/PhaseBadge";
import { Lifecycle } from "@/components/Lifecycle";
import { DisplayChart } from "@/components/DisplayChart";
import { EvidencePanel } from "@/components/EvidencePanel";
import { TxDialog, type TxStage } from "@/components/TxDialog";
import { formatGen, formatPercent } from "@/lib/format";
import { MAX_STAKE_GEN, MIN_STAKE_GEN, NATIVE_DECIMALS } from "@/lib/config";
import { MarketCard } from "@/components/MarketCard";

export function MarketDetailPage() {
  const params = useParams({ strict: false });
  const id = Number(params.id);
  const nav = useNavigate();
  const { address } = useAccount();

  const market = useMarket(id);
  const position = usePosition(id, address);
  const claimable = useClaimable(id, address);
  const evidence = useSettlementEvidence(id);
  const relatedAll = useMarkets(0, 25);

  if (market.isLoading) {
    return <p className="text-sm text-[var(--ef-ink-dim)]">Loading…</p>;
  }
  if (market.isError || !market.data) {
    return (
      <div className="p-6 border border-[var(--ef-down)] rounded-xl">
        <p className="text-sm">Market #{id} not found.</p>
        <button
          className="mt-3 text-xs ef-mono px-2 py-1 rounded border border-[var(--ef-edge)]"
          onClick={() => nav({ to: "/markets" })}
        >
          back to markets
        </button>
      </div>
    );
  }
  const m = market.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-xl bg-[var(--ef-panel-2)] border border-[var(--ef-edge)] flex items-center justify-center text-[var(--ef-accent)]">
          <AssetGlyph asset={m.asset} size={32} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="ef-mono text-2xl">{m.asset}</h1>
            <span className="text-[var(--ef-ink-dim)]">/</span>
            <span className="ef-mono text-sm text-[var(--ef-ink-dim)]">
              {m.targetDay} GMT+1
            </span>
            <PhaseBadge phase={m.phase} />
          </div>
          <div className="text-xs text-[var(--ef-ink-dim)] mt-1 ef-mono">
            #{m.id} · slug {m.coinmarketSlug} · pair {m.gatePair}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-4">
            <DisplayChart asset={m.asset} />
          </div>

          <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-4">
            <h2 className="text-sm uppercase tracking-widest ef-mono text-[var(--ef-ink-dim)] mb-4">
              Lifecycle
            </h2>
            <Lifecycle market={m} />
          </div>

          <EvidencePanel
            market={m}
            evidence={evidence.data ?? emptyEvidence(id)}
          />

          <RelatedMarkets
            currentId={m.id}
            asset={m.asset}
            all={relatedAll.data ?? []}
          />
        </section>

        <aside className="space-y-4">
          <PoolCard market={m} />
          <ActionPanel
            market={m}
            position={position.data}
            claimable={claimable.data}
          />
        </aside>
      </div>
    </div>
  );
}

function emptyEvidence(id: number) {
  return {
    exists: false,
    marketId: id,
    resolvedAt: 0,
    coinmarketOpen: 0n,
    coinmarketClose: 0n,
    coinmarketDirection: "" as const,
    gateOpen: 0n,
    gateClose: 0n,
    gateDirection: "" as const,
    finalResult: "" as const,
    terminalRefund: false,
    priceScale: 100_000_000n,
  };
}

function PoolCard({ market }: { market: Market }) {
  const upPct = formatPercent(market.upPool, market.totalPool || 1n);
  const downPct = formatPercent(market.downPool, market.totalPool || 1n);
  return (
    <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-4">
      <div className="text-xs uppercase tracking-widest text-[var(--ef-ink-dim)] ef-mono">
        Pool
      </div>
      <div className="mt-3 space-y-2">
        <PoolRow label="UP" value={market.upPool} pct={upPct} tone="up" />
        <PoolRow label="DOWN" value={market.downPool} pct={downPct} tone="down" />
        <div className="pt-2 mt-2 border-t border-[var(--ef-edge)] flex justify-between text-xs ef-mono">
          <span className="text-[var(--ef-ink-dim)]">total</span>
          <span>{formatGen(market.totalPool)}</span>
        </div>
      </div>
    </div>
  );
}

function PoolRow({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: bigint;
  pct: string;
  tone: "up" | "down";
}) {
  const color = tone === "up" ? "text-[var(--ef-up)]" : "text-[var(--ef-down)]";
  return (
    <div className="flex justify-between text-xs ef-mono">
      <span className={color}>{label}</span>
      <span>{formatGen(value)}</span>
      <span className="text-[var(--ef-ink-dim)]">{pct}</span>
    </div>
  );
}

function ActionPanel({
  market,
  position,
  claimable,
}: {
  market: Market;
  position: ReturnType<typeof usePosition>["data"] | undefined;
  claimable: bigint | undefined;
}) {
  const { address, isConnected } = useAccount();
  const take = useTakePosition();
  const resolve = useResolve();
  const claim = useClaim();
  const [stage, setStage] = useState<TxStage | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [amount, setAmount] = useState<string>("2");
  const [side, setSide] = useState<"UP" | "DOWN">("UP");
  const lockedSide = position?.exists ? position.side : undefined;

  // Whichever write is in flight owns the retry indicator.
  const activeRetry = take.retry ?? resolve.retry ?? claim.retry ?? null;
  const busy = take.isPending || resolve.isPending || claim.isPending;

  const stakeWei = useMemo(() => {
    try {
      return parseUnits(amount || "0", NATIVE_DECIMALS);
    } catch {
      return 0n;
    }
  }, [amount]);

  const disabled =
    !isConnected ||
    stakeWei < MIN_STAKE_GEN * 10n ** BigInt(NATIVE_DECIMALS) ||
    stakeWei > MAX_STAKE_GEN * 10n ** BigInt(NATIVE_DECIMALS);

  async function runTake() {
    if (!address) return;
    setStage("wallet");
    setErr(undefined);
    try {
      const chosenSide: "UP" | "DOWN" =
        lockedSide === "UP" || lockedSide === "DOWN" ? lockedSide : side;
      await take.mutateAsync({
        marketId: market.id,
        side: chosenSide,
        stakeWei,
      });
      setStage("success");
    } catch (e) {
      setStage("error");
      setErr(String((e as Error).message ?? e));
    }
  }

  async function runResolve() {
    setStage("wallet");
    setErr(undefined);
    try {
      await resolve.mutateAsync(market.id);
      setStage("success");
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (msg.includes("TRANSIENT") || msg.includes("EXTERNAL")) {
        setStage("uncertain");
        setErr(msg + "\n\nTry again in a moment — evidence is retryable.");
      } else {
        setStage("error");
        setErr(msg);
      }
    }
  }

  async function runClaim() {
    setStage("wallet");
    setErr(undefined);
    try {
      await claim.mutateAsync(market.id);
      setStage("success");
    } catch (e) {
      setStage("error");
      setErr(String((e as Error).message ?? e));
    }
  }

  return (
    <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-4 space-y-4">
      {position?.exists && (
        <div className="text-xs text-[var(--ef-ink-dim)] ef-mono">
          your position ·{" "}
          <span className={position.side === "UP" ? "text-[var(--ef-up)]" : "text-[var(--ef-down)]"}>
            {position.side}
          </span>{" "}
          · {formatGen(position.stake)}
          {position.claimed && " · claimed"}
        </div>
      )}

      {market.phase === "OPEN" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(["UP", "DOWN"] as const).map((s) => (
              <button
                key={s}
                disabled={Boolean(lockedSide) && lockedSide !== s}
                onClick={() => setSide(s)}
                className={`py-2 rounded border ef-mono text-sm ${
                  (lockedSide ?? side) === s
                    ? s === "UP"
                      ? "border-[var(--ef-up)] text-[var(--ef-up)]"
                      : "border-[var(--ef-down)] text-[var(--ef-down)]"
                    : "border-[var(--ef-edge)] text-[var(--ef-ink-dim)]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="block text-xs text-[var(--ef-ink-dim)] ef-mono">
            stake (GEN)
            <input
              type="number"
              min={Number(MIN_STAKE_GEN)}
              max={Number(MAX_STAKE_GEN)}
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full bg-[var(--ef-panel-2)] border border-[var(--ef-edge)] rounded px-2 py-1.5 ef-mono text-sm text-[var(--ef-ink)]"
            />
            <span className="mt-1 block text-[10px]">
              min {String(MIN_STAKE_GEN)} · max {String(MAX_STAKE_GEN)}
            </span>
          </label>
          <button
            disabled={disabled || busy}
            onClick={() => {
              setStage("review");
            }}
            className="w-full py-2 rounded bg-[var(--ef-accent)] text-black ef-mono text-sm"
          >
            {position?.exists ? "top up" : "take position"}
          </button>
        </>
      )}

      {market.phase === "READY_TO_SETTLE" && (
        <button
          onClick={runResolve}
          disabled={busy}
          className="w-full py-2 rounded border border-[var(--ef-accent)] text-[var(--ef-accent)] ef-mono text-sm"
        >
          {resolve.isPending
            ? resolve.retry
              ? `node busy — retrying (${resolve.retry.attempt}/${resolve.retry.maxAttempts})`
              : "resolving…"
            : "resolve market"}
        </button>
      )}

      {(claimable ?? 0n) > 0n && (
        <button
          onClick={runClaim}
          disabled={busy}
          className="w-full py-2 rounded bg-[var(--ef-accent)] text-black ef-mono text-sm"
        >
          {claim.isPending ? "claiming…" : `claim ${formatGen(claimable!)}`}
        </button>
      )}

      <TxDialog
        open={stage !== null}
        stage={activeRetry && stage === "wallet" ? "retrying" : stage ?? "review"}
        error={err}
        retry={activeRetry}
        onClose={() => setStage(null)}
      >
        {stage === "review" && (
          <div className="space-y-3">
            <p>
              You will stake <b>{amount} GEN</b> on{" "}
              <b>{lockedSide ?? side}</b> for market #{market.id} ({market.asset}
              , {market.targetDay} GMT+1).
            </p>
            <button
              onClick={runTake}
              disabled={busy}
              className="w-full py-2 rounded bg-[var(--ef-accent)] text-black ef-mono text-sm"
            >
              {take.isPending ? "sending…" : "approve in wallet"}
            </button>
          </div>
        )}
      </TxDialog>
    </div>
  );
}

function RelatedMarkets({
  currentId,
  asset,
  all,
}: {
  currentId: number;
  asset: string;
  all: Market[];
}) {
  const rows = all
    .filter((m) => m.asset === asset && m.id !== currentId)
    .slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <div>
      <h2 className="text-sm uppercase tracking-widest ef-mono text-[var(--ef-ink-dim)] mb-3">
        More {asset} markets
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((m) => (
          <MarketCard key={m.id} market={m} />
        ))}
      </div>
      <div className="mt-3 text-xs">
        <Link to="/markets" className="text-[var(--ef-accent)]">
          all markets →
        </Link>
      </div>
    </div>
  );
}
