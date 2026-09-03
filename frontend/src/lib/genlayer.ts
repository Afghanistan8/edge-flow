// genlayer-js client for the Edge-Flow contract on GenLayer Bradbury.
//
// Reads use an account-less client. Writes need both a connected address
// and the injected provider, so genlayer-js routes eth_sendTransaction to
// the wallet instead of the read-only public RPC.

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { CONTRACT_ADDRESS, NETWORK_CHAIN_ID, RPC_URL } from "./config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Injected EIP-1193 provider, when a browser wallet is present. */
function injectedProvider(): unknown | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: unknown }).ethereum;
}

/**
 * genlayer-js already ships the Bradbury chain with the correct consensus
 * contract addresses. We only layer an RPC override on top when the
 * operator set one; the chain id stays 4221 either way.
 */
function chain() {
  if (RPC_URL && RPC_URL !== testnetBradbury.rpcUrls.default.http[0]) {
    return {
      ...testnetBradbury,
      rpcUrls: { default: { http: [RPC_URL] } },
    };
  }
  return testnetBradbury;
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

export async function writeContract(
  method: string,
  args: unknown[] = [],
  opts: { value?: bigint; account?: string } = {},
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
  try {
    return (await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: method,
      args,
      value: opts.value ?? 0n,
    })) as string;
  } catch (e) {
    throw normalizeWriteError(e);
  }
}

/** Turn viem/wallet noise into something a user can act on. */
function normalizeWriteError(e: unknown): Error {
  const err = e as {
    code?: number;
    shortMessage?: string;
    details?: string;
    message?: string;
  };
  const raw = err?.shortMessage ?? err?.details ?? err?.message ?? String(e);

  // EIP-1193 user rejection.
  if (err?.code === 4001 || /user rejected|user denied/i.test(raw)) {
    return new Error("Transaction rejected in wallet.");
  }
  if (/chain \d+ but client is configured|wrong network|chain mismatch/i.test(raw)) {
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
