// genlayer-js client for the Edge-Flow contract on GenLayer Bradbury.
//
// Reads use an account-less client. Writes need both a connected address
// and the injected provider, so genlayer-js routes eth_sendTransaction to
// the wallet instead of the read-only public RPC.
//
// IMPORTANT — where writes actually go. genlayer-js keeps
// eth_sendTransaction in its PROVIDER_METHODS set, so that call is handed
// to window.ethereum and the WALLET broadcasts it using whatever RPC it
// has stored for chain 4221. Our RPC config governs reads only. A wallet
// that added Bradbury from ChainList holds the public zkSync-OS endpoint,
// which rate-limits and returns -32005. We cannot silently rewrite the
// wallet's endpoint, so we do three things: pin our own chain object to
// the canonical RPC, ask the wallet to adopt it (see useEnsureBradbury),
// and retry -32005 using the retryAfterMs the node hands back.

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  CONTRACT_ADDRESS,
  NETWORK_CHAIN_ID,
  PRIMARY_RPC,
  RPC_URL,
  isBannedRpc,
} from "./config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Injected EIP-1193 provider, when a browser wallet is present. */
function injectedProvider(): unknown | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: unknown }).ethereum;
}

/**
 * Chain object for the SDK. genlayer-js ships Bradbury with the correct
 * consensus addresses; we always override rpcUrls so a future SDK change
 * (or a stale cached copy) can never point our traffic at a rate-limited
 * endpoint. Chain id stays 4221 either way.
 */
function chain() {
  const rpc = isBannedRpc(RPC_URL) ? PRIMARY_RPC : RPC_URL || PRIMARY_RPC;
  return {
    ...testnetBradbury,
    rpcUrls: { default: { http: [rpc] } },
  };
}

let readClient: AnyClient | null = null;

export function isConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS);
}

export function hasWallet(): boolean {
  return injectedProvider() !== undefined;
}

function getReadClient(): AnyClient {
  if (!readClient) readClient = createClient({ chain: chain() });
  return readClient;
}

function getWriteClient(address: string): AnyClient {
  const provider = injectedProvider();
  if (!provider) {
    throw new Error(
      "No browser wallet detected. Install MetaMask (or another EIP-1193 wallet) to send transactions.",
    );
  }
  return createClient({
    chain: chain(),
    account: address as `0x${string}`,
    provider,
  });
}

export async function readContract<T = unknown>(
  method: string,
  args: unknown[] = [],
): Promise<T> {
  if (!isConfigured()) {
    throw new Error(
      "Edge-Flow contract address is not configured. Set VITE_EDGEFLOW_CONTRACT_ADDRESS and rebuild.",
    );
  }
  return (await getReadClient().readContract({
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
  })) as T;
}

// ---------------------------------------------------------------------
// Rate-limit aware retry
// ---------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 800;

/** Progress callback so the UI can say "retrying, attempt 2 of 5". */
export type WriteProgress = (info: {
  attempt: number;
  maxAttempts: number;
  waitMs: number;
}) => void;

function errText(e: unknown): string {
  const err = e as {
    shortMessage?: string;
    details?: string;
    message?: string;
    cause?: { message?: string };
  };
  return [
    err?.shortMessage,
    err?.details,
    err?.message,
    err?.cause?.message,
    typeof e === "string" ? e : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function errCode(e: unknown): number | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "number") return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Pull retryAfterMs out of the node's error payload, if present. */
function retryAfterMs(e: unknown): number | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const data = (cur as { data?: { retryAfterMs?: unknown } }).data;
    const v = data?.retryAfterMs;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    cur = (cur as { cause?: unknown }).cause;
  }
  // Fall back to scraping the serialized message.
  const m = errText(e).match(/"?retryAfterMs"?\s*:\s*(\d+)/);
  if (m?.[1]) return Number(m[1]);
  return undefined;
}

/** User rejection / wrong network / no funds must never be retried. */
function isTerminal(e: unknown): boolean {
  const code = errCode(e);
  if (code === 4001) return true;
  const t = errText(e).toLowerCase();
  return (
    /user rejected|user denied|rejected the request/.test(t) ||
    /insufficient funds/.test(t) ||
    /chain \d+ but client is configured|wrong network|chain mismatch/.test(t)
  );
}

/** The node is momentarily at capacity — safe and correct to retry. */
function isRateLimited(e: unknown): boolean {
  if (isTerminal(e)) return false;
  if (errCode(e) === -32005) return true;
  const t = errText(e).toLowerCase();
  return (
    t.includes("gas rate limit exceeded") ||
    t.includes("node is at capacity") ||
    t.includes("zksync-os-testnet-genlayer") ||
    t.includes("retryafterms") ||
    t.includes("too many requests")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function writeContract(
  method: string,
  args: unknown[] = [],
  opts: {
    value?: bigint;
    account?: string;
    onProgress?: WriteProgress;
  } = {},
): Promise<string> {
  if (!isConfigured()) {
    throw new Error(
      "Edge-Flow contract address is not configured. Set VITE_EDGEFLOW_CONTRACT_ADDRESS and rebuild.",
    );
  }
  if (!opts.account) {
    throw new Error("Connect a wallet before sending a transaction.");
  }
  const client = getWriteClient(opts.account);

  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return (await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: method,
        args,
        value: opts.value ?? 0n,
      })) as string;
    } catch (e) {
      last = e;
      if (!isRateLimited(e) || attempt === MAX_ATTEMPTS) break;
      // Honour the node's own hint when it gives one, else exponential.
      const hinted = retryAfterMs(e);
      const wait = hinted ?? BASE_BACKOFF_MS * 2 ** (attempt - 1);
      opts.onProgress?.({ attempt, maxAttempts: MAX_ATTEMPTS, waitMs: wait });
      // Pad the node's hint slightly; retrying exactly on the boundary
      // tends to collide with the same window again.
      await sleep(wait + 150);
    }
  }
  throw normalizeWriteError(last);
}

/** Turn viem/wallet noise into something a user can act on. */
export function normalizeWriteError(e: unknown): Error {
  const raw = errText(e) || String(e);

  if (errCode(e) === 4001 || /user rejected|user denied/i.test(raw)) {
    return new Error("Transaction rejected in wallet.");
  }
  if (isRateLimited(e)) {
    // Never surface the bare viem "[From https://zksync-os-...]" blob as
    // the whole message — it tells the user nothing actionable.
    return new Error(
      "The Bradbury node your wallet is using is at capacity (gas rate limit). " +
        "Wait a moment and press Create again.\n\n" +
        "If this keeps happening, your wallet is broadcasting through the " +
        "public zkSync-OS endpoint. In MetaMask open Settings > Networks > " +
        "GenLayer Bradbury Testnet and set the RPC URL to " +
        `${PRIMARY_RPC} (chain id ${NETWORK_CHAIN_ID}).`,
    );
  }
  if (
    /chain \d+ but client is configured|wrong network|chain mismatch/i.test(raw)
  ) {
    return new Error(
      `Wallet is on the wrong network. Switch to ${testnetBradbury.name} (chain ${NETWORK_CHAIN_ID}) and try again.`,
    );
  }
  if (/insufficient funds/i.test(raw)) {
    return new Error(
      "Insufficient GEN for this transaction. Top up at https://testnet-faucet.genlayer.foundation.",
    );
  }
  return new Error(raw);
}
