import { useEffect } from "react";

export type TxStage =
  | "review"
  | "wallet"
  | "submitted"
  | "waiting"
  | "success"
  | "uncertain"
  | "error";

const STAGE_COPY: Record<TxStage, { title: string; hint: string }> = {
  review: { title: "Review", hint: "Confirm the action about to be sent." },
  wallet: {
    title: "Waiting for wallet",
    hint: "Approve the transaction in your wallet.",
  },
  submitted: {
    title: "Submitted",
    hint: "The transaction was submitted to Bradbury.",
  },
  waiting: {
    title: "Waiting for consensus",
    hint: "Validators are agreeing on the result.",
  },
  success: { title: "Confirmed", hint: "The action landed on-chain." },
  uncertain: {
    title: "Uncertain",
    hint: "Consensus did not finalize cleanly. Refresh and check state.",
  },
  error: { title: "Error", hint: "" },
};

export function TxDialog({
  open,
  stage,
  error,
  onClose,
  children,
}: {
  open: boolean;
  stage: TxStage;
  error?: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const copy = STAGE_COPY[stage];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--ef-edge-hi)] bg-[var(--ef-panel)] ef-glow overflow-hidden">
        <div className="p-4 border-b border-[var(--ef-edge)] flex items-center gap-2">
          <span className="ef-tick" />
          <h3 className="text-sm ef-mono uppercase tracking-widest">
            {copy.title}
          </h3>
        </div>
        <div className="p-5 text-sm text-[var(--ef-ink-dim)] space-y-3">
          <p>{copy.hint}</p>
          {stage === "error" && error && (
            <pre className="text-xs ef-mono whitespace-pre-wrap text-[var(--ef-down)] p-3 rounded border border-[var(--ef-edge)] bg-[var(--ef-panel-2)]">
              {error}
            </pre>
          )}
          {children}
        </div>
        <div className="px-4 py-3 border-t border-[var(--ef-edge)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-[var(--ef-edge)] hover:border-[var(--ef-edge-hi)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
