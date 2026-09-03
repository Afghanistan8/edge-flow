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
  RPC_URL,
  WALLETCONNECT_PROJECT_ID,
} from "./config";

export const bradbury = defineChain({
  id: NETWORK_CHAIN_ID,
  name: NETWORK_NAME,
  nativeCurrency: {
    name: "GEN Token",
    symbol: NATIVE_SYMBOL,
    decimals: NATIVE_DECIMALS,
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
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
      transports: { [bradbury.id]: http(RPC_URL) },
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
    transports: { [bradbury.id]: http(RPC_URL) },
    ssr: false,
  });
}

export const wagmiConfig = buildConfig();

export { RainbowKitProvider };
