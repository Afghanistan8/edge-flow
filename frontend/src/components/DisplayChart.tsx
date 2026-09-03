import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Asset } from "@/lib/config";
import { loadDisplayCandles } from "@/lib/priceFeed";

export function DisplayChart({ asset }: { asset: Asset }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["display-chart", asset],
    queryFn: () => loadDisplayCandles(asset),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="h-52 flex items-center justify-center text-xs text-[var(--ef-ink-dim)]">
        Loading chart…
      </div>
    );
  }
  if (isError || !data?.length) {
    return (
      <div className="h-52 flex items-center justify-center text-xs text-[var(--ef-ink-dim)]">
        Display feed unavailable — the contract still settles independently.
      </div>
    );
  }

  return (
    <div className="h-52 w-full text-xs">
      <div className="text-[10px] uppercase tracking-widest text-[var(--ef-ink-dim)] ef-mono mb-1">
        Display only · Gate.io hourly · {asset}/USDT
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="ef-price" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ef-accent)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--ef-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--ef-edge)" strokeDasharray="2 4" />
          <XAxis
            dataKey="t"
            hide
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--ef-ink-dim)" }}
            width={48}
            domain={["auto", "auto"]}
            stroke="var(--ef-edge-hi)"
          />
          <Tooltip
            contentStyle={{
              background: "var(--ef-panel)",
              border: "1px solid var(--ef-edge-hi)",
              fontSize: 11,
            }}
            labelFormatter={(v) =>
              new Date((v as number) * 1000).toISOString().slice(0, 16) + "Z"
            }
            formatter={(v) => Number(v).toFixed(4)}
          />
          <Area
            type="monotone"
            dataKey="c"
            stroke="var(--ef-accent)"
            strokeWidth={1.5}
            fill="url(#ef-price)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
