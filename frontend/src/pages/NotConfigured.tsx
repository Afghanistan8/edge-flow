export function NotConfigured() {
  return (
    <div className="rounded-xl border border-[var(--ef-warn)] p-8 space-y-3 bg-[var(--ef-panel)]">
      <h1 className="text-lg ef-mono uppercase tracking-widest text-[var(--ef-warn)]">
        Contract address missing
      </h1>
      <p className="text-sm text-[var(--ef-ink-dim)]">
        Set <code className="ef-mono">VITE_EDGEFLOW_CONTRACT_ADDRESS</code> in{" "}
        <code className="ef-mono">.env</code> to the deployed Edge-Flow contract
        on the GenLayer Bradbury testnet, then reload.
      </p>
      <p className="text-sm text-[var(--ef-ink-dim)]">
        You can also override{" "}
        <code className="ef-mono">VITE_GENLAYER_RPC_URL</code> to point at a
        custom RPC.
      </p>
    </div>
  );
}
