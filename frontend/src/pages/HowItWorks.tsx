export function HowItWorksPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <span className="ef-tick" />
          <h1 className="ef-mono text-xl uppercase tracking-widest">
            How Edge-Flow works
          </h1>
        </div>
        <p className="mt-2 text-sm text-[var(--ef-ink-dim)]">
          A permissionless daily market that does not trust any one feed or any
          admin.
        </p>
      </div>

      <Section title="1 · The market" body={
        "You predict whether the day’s GMT+1 candle for JUP, ZAMA, ATOM or ZRO " +
        "closes up or down. Stake is 2–8 GEN per wallet. You may top up the " +
        "same side before the cutoff but cannot switch sides."
      } />

      <Section title="2 · The clock" body={
        "The market day is a calendar date in GMT+1 — a fixed +1 hour offset, " +
        "with no DST. Entries close at the start of the target GMT+1 day. The " +
        "candle window runs 00:00 → next 00:00 GMT+1. resolve_market becomes " +
        "callable when that window ends."
      } />

      <Section
        title="3 · Two independent sources"
        body={
          "The contract re-fetches two public, keyless feeds: CoinGecko's " +
          "market-chart range endpoint and Gate.io spot candlesticks. For " +
          "each feed the contract picks the open at day-start and the close " +
          "at day-end, then labels UP if close > open, DOWN otherwise. " +
          "(Contract storage still names the first source's fields " +
          "coinmarket_* for historical reasons — the URL it actually fetches " +
          "is CoinGecko's public API.)"
        }
      />

      <Section
        title="4 · 2-of-2 agreement"
        body={
          "UP + UP → market settles UP. DOWN + DOWN → DOWN. Disagreement → " +
          "INCONCLUSIVE and every original stake is refundable. Prices from " +
          "the two feeds need not match; only the independently derived " +
          "directions are compared."
        }
      />

      <Section
        title="5 · Unavailable evidence is retried, never faked"
        body={
          "If any source is missing, malformed, incomplete, or oversized, the " +
          "resolve call reverts with a TRANSIENT or EXTERNAL class and the " +
          "market stays READY_TO_SETTLE. Anyone may call resolve again later. " +
          "Five days after the settle time, a terminal fallback finalizes an " +
          "INCONCLUSIVE result with terminal_refund=true so stakes are " +
          "reclaimable — but if valid evidence exists after the deadline, " +
          "normal directional settlement still wins."
        }
      />

      <Section
        title="Wallet setup · use the right RPC"
        body={
          "Your wallet must use https://rpc-bradbury.genlayer.com for chain " +
          "4221. ChainList lists Bradbury with a public zkSync-OS endpoint " +
          "that rate-limits and rejects transactions with -32005 'gas rate " +
          "limit exceeded'. Edge-Flow asks your wallet to adopt the correct " +
          "RPC and retries that error automatically, but MetaMask will not " +
          "overwrite an endpoint you already saved — fix it under " +
          "Settings > Networks if creates keep failing."
        }
      />

      <Section
        title="6 · Contract is source of truth"
        body={
          "The frontend only reads views and submits transactions. Charts and " +
          "live prices in the UI are display-only. They never decide outcomes. " +
          "All permissions are permissionless — any wallet can create, take " +
          "position, resolve, or claim (from their own position)."
        }
      />
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border border-[var(--ef-edge)] bg-[var(--ef-panel)] p-5">
      <div className="text-xs uppercase tracking-widest text-[var(--ef-accent)] ef-mono">
        {title}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ef-ink)]">
        {body}
      </p>
    </section>
  );
}
