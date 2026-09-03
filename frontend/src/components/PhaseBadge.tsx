import type { Phase } from "@/lib/contract";

const LABEL: Record<Phase, string> = {
  OPEN: "Open",
  CANDLE_LIVE: "Candle live",
  READY_TO_SETTLE: "Ready to settle",
  UP: "Settled · UP",
  DOWN: "Settled · DOWN",
  INCONCLUSIVE: "Inconclusive",
};

const STYLE: Record<Phase, string> = {
  OPEN: "border-[var(--ef-accent-dim)] text-[var(--ef-accent)] bg-[color-mix(in_srgb,var(--ef-accent)_10%,transparent)]",
  CANDLE_LIVE: "border-[var(--ef-warn)] text-[var(--ef-warn)]",
  READY_TO_SETTLE: "border-white/40 text-white",
  UP: "border-[var(--ef-up)] text-[var(--ef-up)]",
  DOWN: "border-[var(--ef-down)] text-[var(--ef-down)]",
  INCONCLUSIVE: "border-[var(--ef-ink-dim)] text-[var(--ef-ink-dim)]",
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] uppercase tracking-widest border ef-mono ${STYLE[phase]}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {LABEL[phase]}
    </span>
  );
}
