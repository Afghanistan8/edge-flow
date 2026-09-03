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
  id: 4221,
  name: "Genlayer Bradbury Testnet",
  nativeCurrency: {
    name: "GEN Token",
    symbol: NATIVE_SYMBOL,
    decimals: NATIVE_DECIMALS,
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: "GenLayer Bradbury Explorer",
      url: "https://explorer-bradbury.genlayer.com",
    },
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
