// Thin wrapper around genlayer-js against GenLayer Bradbury.
//
// genlayer-js ships chain configs for localnet and testnetAsimov only, so
// we clone testnetAsimov (same chain id 4221) and override the RPC and
// the Bradbury consensus contract addresses.

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

let cachedClient: AnyClient | null = null;

export function isConfigured(): boolean {
  return CONTRACT_ADDRESS.startsWith("0x") && CONTRACT_ADDRESS.length === 42;
}

function client(): AnyClient {
  if (cachedClient) return cachedClient;
  cachedClient = createClient({ chain: bradburyChain() });
  return cachedClient;
}

export async function readContract<T = unknown>(
  method: string,
  args: unknown[] = [],
): Promise<T> {
  if (!isConfigured()) throw new Error("Edge-Flow contract not configured");
  return (await client().readContract({
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
  })) as T;
}

export async function writeContract(
  method: string,
  args: unknown[] = [],
  opts: { value?: bigint } = {},
): Promise<string> {
  return (await client().writeContract({
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
    value: opts.value ?? 0n,
  })) as string;
}
