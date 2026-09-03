// genlayer-js wrapper against GenLayer Bradbury.
//
// Reads go through a bare client (HTTP RPC). Writes need a connected
// wallet, so we build a per-call client with the wallet address; when
// `account` is a plain string, genlayer-js routes signing methods to
// window.ethereum (the injected wallet). This is the pattern the SDK
// exposes for browser wallets.

import { CONTRACT_ADDRESS, RPC_URL } from "./config";
import { createClient, chains } from "genlayer-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const BRADBURY_MAIN = "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D";
const BRADBURY_DATA = "0x85D7bf947A512Fc640C75327A780c90847267697";

function bradburyChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asimov = (chains as any).testnetAsimov;
  return {
    ...asimov,
    id: 4221,
    name: "Genlayer Bradbury Testnet",
    rpcUrls: { default: { http: [RPC_URL] } },
    blockExplorers: {
      default: {
        name: "GenLayer Bradbury Explorer",
        url: "https://explorer-bradbury.genlayer.com/",
      },
    },
    consensusMainContract: {
      ...asimov.consensusMainContract,
      address: BRADBURY_MAIN,
    },
    consensusDataContract: {
      ...asimov.consensusDataContract,
      address: BRADBURY_DATA,
    },
  };
}

let readClient: AnyClient | null = null;

export function isConfigured(): boolean {
  return CONTRACT_ADDRESS.startsWith("0x") && CONTRACT_ADDRESS.length === 42;
}

function getReadClient(): AnyClient {
  if (readClient) return readClient;
  readClient = createClient({ chain: bradburyChain() });
  return readClient;
}

function getWriteClient(address: string): AnyClient {
  // Pass account as a plain address string so genlayer-js routes signing
  // methods (eth_sendTransaction, personal_sign, etc.) to window.ethereum.
  return createClient({
    chain: bradburyChain(),
    account: address as `0x${string}`,
  });
}

export async function readContract<T = unknown>(
  method: string,
  args: unknown[] = [],
): Promise<T> {
  if (!isConfigured()) throw new Error("Edge-Flow contract not configured");
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
  if (!isConfigured()) throw new Error("Edge-Flow contract not configured");
  if (!opts.account) {
    throw new Error("Connect a wallet before sending a transaction");
  }
  const client = getWriteClient(opts.account);
  return (await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
    value: opts.value ?? 0n,
  })) as string;
}
