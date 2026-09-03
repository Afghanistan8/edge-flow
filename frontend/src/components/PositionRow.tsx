import { useState } from "react";
import { useAccount } from "wagmi";
import { Link } from "@tanstack/react-router";
import type { Market } from "@/lib/contract";
import { useClaim, useClaimable, usePosition } from "@/lib/hooks";
import { formatGen } from "@/lib/format";
import { PhaseBadge } from "./PhaseBadge";
import { AssetGlyph } from "./AssetGlyph";
import { TxDialog, type TxStage } from "./TxDialog";

/**
 * One portfolio line: the market, this wallet's side and stake, and a
 * claim button when the contract says something is claimable.
 */
export function PositionRow({ market }: { market: Market }) {
  const { address } = useAccount();
  const { data: position } = usePosition(market.id, address);
  const { data: claimable } = useClaimable(market.id, address);
  const claim = useClaim();
  const [stage, setStage] = useState<TxStage | null>(null);
  const [err, setErr] = useState<string | undefined>();

  const canClaim = (claimable ?? 0n) > 0n;

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
    <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-[var(--ef-panel-2)] border border-[var(--ef-edge)] flex items-center justify-center text-[var(--ef-accent)] shrink-0">
          <AssetGlyph asset={market.asset} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to="/market/$id"
            params={{ id: String(market.id) }}
            className="ef-mono text-sm hover:text-[var(--ef-accent)]"
          >
            {market.asset}{" "}
            <span className="text-[var(--ef-ink-dim)]">
              · {market.targetDay} GMT+1
            </span>
          </Link>
          <div className="mt-1">
            <PhaseBadge phase={market.phase} />
          </div>
        </div>
        <span className="ef-mono text-xs text-[var(--ef-ink-dim)]">
          #{market.id}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs ef-mono border-t border-[var(--ef-edge)] pt-3">
        <Cell label="side">
          {position?.side ? (
            <span
              className={
                position.side === "UP"
                  ? "text-[var(--ef-up)]"
                  : "text-[var(--ef-down)]"
              }
            >
              {position.side}
            </span>
          ) : (
            <span className="text-[var(--ef-ink-dim)]">—</span>
          )}
        </Cell>
        <Cell label="stake">{formatGen(position?.stake ?? 0n)}</Cell>
        <Cell label="claimable">
          {position?.claimed ? (
            <span className="text-[var(--ef-ink-dim)]">claimed</span>
          ) : canClaim ? (
            <span className="text-[var(--ef-accent)]">
              {formatGen(claimable!)}
            </span>
          ) : (
            <span className="text-[var(--ef-ink-dim)]">—</span>
          )}
        </Cell>
      </div>

      {canClaim && (
        <button
          onClick={runClaim}
          disabled={claim.isPending}
          className="w-full py-2 rounded bg-[var(--ef-accent)] text-black ef-mono text-sm"
        >
          {claim.isPending ? "claiming…" : `claim ${formatGen(claimable!)}`}
        </button>
      )}

      <TxDialog
        open={stage !== null}
        stage={stage ?? "review"}
        error={err}
        onClose={() => {
          setStage(null);
          setErr(undefined);
          claim.reset();
        }}
      />
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-[var(--ef-ink-dim)]">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
