// Wallet-side network helpers.
//
// Why this file exists: genlayer-js hands eth_sendTransaction to
// window.ethereum, so the WALLET decides which RPC actually broadcasts.
// A wallet that added chain 4221 from ChainList holds the public
// zkSync-OS endpoint, which rate-limits and answers -32005. Our own
// client config cannot fix that — only the wallet's stored endpoint can.

import {
  BANNED_RPC_HOSTS,
  EXPLORER_URL,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  NETWORK_CHAIN_ID,
  NETWORK_NAME,
  PRIMARY_RPC,
} from "./config";

export const CHAIN_ID_HEX = `0x${NETWORK_CHAIN_ID.toString(16)}`; // 0x107d

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export function getProvider(): Eip1193 | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: NETWORK_NAME,
  nativeCurrency: {
    name: "GEN Token",
    symbol: NATIVE_SYMBOL,
    decimals: NATIVE_DECIMALS,
  },
  rpcUrls: [PRIMARY_RPC],
  blockExplorerUrls: [EXPLORER_URL],
};

/**
 * Ask the wallet to register Bradbury pointing at the canonical RPC, then
 * switch to it.
 *
 * Best-effort by design. If the wallet already knows chain 4221 with a
 * different RPC, MetaMask does not silently replace the stored endpoint —
 * depending on version it either ignores the rpcUrls or prompts the user
 * to add the endpoint. So this raises the odds of landing on the right
 * node but cannot guarantee it, which is exactly why writes also retry on
 * -32005 and why the UI explains how to fix the network by hand.
 *
 * Never throws: a wallet that rejects the prompt should not block a write
 * that might still succeed.
 */
export async function ensureBradburyNetwork(): Promise<void> {
  const provider = getProvider();
  if (!provider) return;
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [ADD_CHAIN_PARAMS],
    });
  } catch {
    /* already present, or user declined — fall through to the switch */
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch {
    /* caller decides what to do about a failed switch */
  }
}

/**
 * Best-effort detection of the wallet broadcasting through a rate-limited
 * endpoint.
 *
 * EIP-1193 exposes no standard "what RPC are you using" call, so there is
 * no reliable way to read MetaMask's stored endpoint. We infer it from
 * errors we have actually seen, rather than pretending to probe it.
 */
export function looksLikeBannedRpcError(text: string): boolean {
  const t = (text || "").toLowerCase();
  return BANNED_RPC_HOSTS.some((h) => t.includes(h));
}

/** Remembered across the session once we see a rate-limited broadcast. */
let sawRateLimitedRpc = false;

export function markRateLimitedRpc(): void {
  sawRateLimitedRpc = true;
}

export function hasSeenRateLimitedRpc(): boolean {
  return sawRateLimitedRpc;
}

export const FIX_RPC_HINT =
  `Your wallet is broadcasting through a rate-limited public endpoint. ` +
  `In MetaMask open Settings > Networks > ${NETWORK_NAME} and set the ` +
  `RPC URL to ${PRIMARY_RPC} (chain id ${NETWORK_CHAIN_ID}). ` +
  `Removing the network and re-adding it from Edge-Flow also works.`;
