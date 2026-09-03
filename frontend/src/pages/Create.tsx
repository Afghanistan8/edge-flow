import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SUPPORTED_ASSETS, type Asset } from "@/lib/config";
import { useCreateMarket } from "@/lib/hooks";
import {
  addDaysGmt1,
  formatGmt1,
  gmt1DayStartUtc,
  todayGmt1,
} from "@/lib/time";
import { AssetGlyph } from "@/components/AssetGlyph";
import { TxDialog, type TxStage } from "@/components/TxDialog";

export function CreatePage() {
  const nav = useNavigate();
  const [asset, setAsset] = useState<Asset>("JUP");
  const [day, setDay] = useState<string>(addDaysGmt1(todayGmt1(), 1));
  const create = useCreateMarket();
  const [stage, setStage] = useState<TxStage | null>(null);
  const [err, setErr] = useState<string | undefined>();

  const preview = useMemo(() => {
    try {
      const start = gmt1DayStartUtc(day);
      return {
        cutoff: formatGmt1(start),
        candleEnd: formatGmt1(start + 86_400),
        refund: formatGmt1(start + 86_400 + 5 * 86_400),
      };
    } catch {
      return null;
    }
  }, [day]);

  async function submit() {
    setStage("wallet");
    setErr(undefined);
    try {
      await create.mutateAsync({ asset, day });
      setStage("success");
      setTimeout(() => nav({ to: "/markets" }), 700);
    } catch (e) {
      setStage("error");
      setErr(String((e as Error).message ?? e));
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span className="ef-tick" />
          <h1 className="ef-mono text-xl uppercase tracking-widest">
            Create a market
          </h1>
        </div>
        <p className="mt-2 text-sm text-[var(--ef-ink-dim)]">
          Permissionless. Any connected wallet can create a market for a future
          GMT+1 day.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {SUPPORTED_ASSETS.map((a) => (
          <button
            key={a}
            onClick={() => setAsset(a)}
            className={`p-3 rounded border flex flex-col items-center gap-1 ef-mono text-xs ${
              asset === a
                ? "border-[var(--ef-accent)] text-[var(--ef-accent)]"
                : "border-[var(--ef-edge)] text-[var(--ef-ink-dim)] hover:border-[var(--ef-edge-hi)]"
            }`}
          >
            <AssetGlyph asset={a} />
            {a}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-xs text-[var(--ef-ink-dim)] ef-mono uppercase tracking-widest">
          Target GMT+1 day
        </span>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="mt-1 w-full bg-[var(--ef-panel-2)] border border-[var(--ef-edge)] rounded px-2 py-1.5 ef-mono text-sm text-[var(--ef-ink)]"
        />
      </label>

      {preview && (
        <div className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-4 text-xs ef-mono space-y-1">
          <Row k="Entries close" v={preview.cutoff} />
          <Row k="Candle completes" v={preview.candleEnd} />
          <Row k="Terminal refund fallback" v={preview.refund} />
        </div>
      )}

      <button
        onClick={submit}
        disabled={!preview}
        className="w-full py-2 rounded bg-[var(--ef-accent)] text-black ef-mono text-sm"
      >
        create market
      </button>

      <TxDialog
        open={stage !== null}
        stage={stage ?? "review"}
        error={err}
        onClose={() => setStage(null)}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--ef-ink-dim)]">{k}</span>
      <span>{v}</span>
    </div>
  );
}
