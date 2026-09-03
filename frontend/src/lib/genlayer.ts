// Thin wrapper around genlayer-js for the Edge-Flow contract.
//
// The frontend only reads views and submits transactions. It never
// decides settlement — the contract's own validator fetch does.
//
// If VITE_EDGEFLOW_CONTRACT_ADDRESS is unset the app renders a friendly
// "not configured" state instead of crashing.

import { CONTRACT_ADDRESS, RPC_URL } from "./config";

// genlayer-js exports vary across releases; import defensively and give
// callers a stable minimal surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

let cachedClient: AnyClient | null = null;

export function isConfigured(): boolean {
  return CONTRACT_ADDRESS.startsWith("0x") && CONTRACT_ADDRESS.length === 42;
}

async function makeClient(): Promise<AnyClient> {
  if (cachedClient) return cachedClient;
  const mod = (await import("genlayer-js")) as Record<string, unknown> & {
    default?: Record<string, unknown>;
  };
  // Fall back to raw fetch if genlayer-js is not present in this env; the
  // build still succeeds because we import dynamically.
  const create =
    (mod.createClient as (opts: unknown) => AnyClient | undefined) ??
    (mod.default?.createClient as (opts: unknown) => AnyClient | undefined);
  if (typeof create !== "function") {
    throw new Error("genlayer-js: createClient not found");
  }
  cachedClient = create({
    chain: {
      id: 61_999,
      name: "GenLayer Bradbury",
      rpcUrls: { default: { http: [RPC_URL] } },
      nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
    },
  });
  return cachedClient;
}

export async function readContract<T = unknown>(
  method: string,
  args: unknown[] = [],
): Promise<T> {
  if (!isConfigured()) throw new Error("Edge-Flow contract not configured");
  // Prefer genlayer-js client if available; otherwise fall back to a
  // best-effort JSON-RPC readContract call.
  try {
    const client = await makeClient();
    if (typeof client.readContract === "function") {
      return (await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: method,
        args,
      })) as T;
    }
  } catch {
    /* fall through */
  }
  return jsonRpcRead<T>(method, args);
}

export async function writeContract(
  method: string,
  args: unknown[] = [],
  opts: { value?: bigint } = {},
): Promise<string> {
  const client = await makeClient();
  if (typeof client.writeContract !== "function") {
    throw new Error("genlayer-js: writeContract not available in this env");
  }
  return (await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
    value: opts.value,
  })) as string;
}

async function jsonRpcRead<T>(method: string, args: unknown[]): Promise<T> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "gen_readContract",
    params: [{ address: CONTRACT_ADDRESS, method, args }],
  };
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}
