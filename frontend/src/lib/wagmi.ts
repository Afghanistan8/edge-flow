// Wagmi + RainbowKit configuration for the GenLayer Bradbury testnet.

import { defineChain, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import {
  EXPLORER_URL,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  NETWORK_CHAIN_ID,
  NETWORK_NAME,
  PRIMARY_RPC,
  RPC_URL,
  WALLETCONNECT_PROJECT_ID,
  isBannedRpc,
} from "./config";

// The chain we advertise to wallets. Never the public zkSync-OS endpoint:
// wagmi's connectors copy chain.rpcUrls.default.http[0] straight into
// wallet_addEthereumChain, so a bad value here would be what the wallet
// stores and broadcasts through.
const CHAIN_RPC = isBannedRpc(RPC_URL) ? PRIMARY_RPC : RPC_URL || PRIMARY_RPC;

export const bradbury = defineChain({
  id: NETWORK_CHAIN_ID,
  name: NETWORK_NAME,
  nativeCurrency: {
    name: "GEN Token",
    symbol: NATIVE_SYMBOL,
    decimals: NATIVE_DECIMALS,
  },
  rpcUrls: {
    default: { http: [CHAIN_RPC] },
  },
  blockExplorers: {
    default: { name: "GenLayer Bradbury Explorer", url: EXPLORER_URL },
  },
  testnet: true,
});

// RainbowKit's getDefaultConfig registers WalletConnect-backed connectors,
// which need a real Cloud project id. When one isn't configured we fall
// back to a plain injected-only config so MetaMask/Rabby still work and
// the app doesn't die on a bad WalletConnect handshake.
function buildConfig() {
  if (WALLETCONNECT_PROJECT_ID) {
    return getDefaultConfig({
      appName: "Edge-Flow",
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [bradbury],
      transports: { [bradbury.id]: http(CHAIN_RPC) },
      ssr: false,
    });
  }

  if (import.meta.env.DEV) {
    console.warn(
      "[edge-flow] VITE_WALLETCONNECT_PROJECT_ID is unset — WalletConnect/QR sign-in is disabled. Injected wallets still work.",
    );
  }

  return createConfig({
    chains: [bradbury],
    connectors: [injected()],
    transports: { [bradbury.id]: http(CHAIN_RPC) },
    ssr: false,
  });
}

export const wagmiConfig = buildConfig();

export { RainbowKitProvider };
