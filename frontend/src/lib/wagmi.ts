// Wagmi configuration for the GenLayer Bradbury testnet.

import { defineChain, http } from "viem";
import { createConfig } from "wagmi";
import {
  getDefaultConfig,
  connectorsForWallets,
  RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { NATIVE_DECIMALS, NATIVE_SYMBOL, RPC_URL } from "./config";

export const bradbury = defineChain({
  id: 61_999,
  name: "GenLayer Bradbury",
  nativeCurrency: {
    name: "GEN",
    symbol: NATIVE_SYMBOL,
    decimals: NATIVE_DECIMALS,
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: "Edge-Flow",
  projectId: "edge-flow-local", // dev-only; users can override for their own build
  chains: [bradbury],
  transports: {
    [bradbury.id]: http(RPC_URL),
  },
  ssr: false,
});

export { RainbowKitProvider };
