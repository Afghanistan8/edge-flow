// Runtime configuration for the GenLayer Bradbury testnet.
//
// Vite inlines import.meta.env at BUILD time. A Vercel deploy that is
// missing VITE_* vars therefore ships with empty strings baked in, and no
// amount of reconfiguring at runtime will help — the project must be
// rebuilt. To keep the hosted app usable when an env var is forgotten, we
// fall back to the known Bradbury deployment rather than rendering the
// "not configured" screen.

// Known Bradbury deployment. Kept in sync with frontend/.env.example.
const FALLBACK_CONTRACT_ADDRESS =
  "0x91Bb7FDD22dE81109Eca288F3CC5921352cD637f";
const FALLBACK_RPC_URL = "https://rpc-bradbury.genlayer.com";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function pickAddress(): string {
  const fromEnv = (import.meta.env.VITE_EDGEFLOW_CONTRACT_ADDRESS ?? "").trim();
  if (ADDRESS_RE.test(fromEnv)) return fromEnv;
  if (fromEnv) {
    // Present but malformed — surface it, don't silently swap in the
    // fallback and leave the operator chasing a ghost.
    console.warn(
      `[edge-flow] VITE_EDGEFLOW_CONTRACT_ADDRESS is not a valid address ("${fromEnv}"); using built-in Bradbury deployment instead.`,
    );
  }
  return FALLBACK_CONTRACT_ADDRESS;
}

export const CONTRACT_ADDRESS = pickAddress();

export const RPC_URL =
  (import.meta.env.VITE_GENLAYER_RPC_URL ?? "").trim() || FALLBACK_RPC_URL;

// WalletConnect Cloud project id. Optional: without it, injected wallets
// (MetaMask, Rabby, Brave) still work — only the WalletConnect QR path is
// degraded. Get one at https://cloud.reown.com.
export const WALLETCONNECT_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();

export const NETWORK_NAME = "GenLayer Bradbury Testnet";
export const NETWORK_CHAIN_ID = 4221;
export const EXPLORER_URL = "https://explorer-bradbury.genlayer.com";
export const FAUCET_URL = "https://testnet-faucet.genlayer.foundation";
export const NATIVE_SYMBOL = "GEN";
export const NATIVE_DECIMALS = 18;

export const SUPPORTED_ASSETS = ["JUP", "ZAMA", "ATOM", "ZRO"] as const;
export type Asset = (typeof SUPPORTED_ASSETS)[number];

// Display-only price feed. Proxied same-origin (see vercel.json /
// vite.config.ts) because api.gateio.ws does not send CORS headers for
// browser callers.
//
// This is UX only. Settlement uses the contract's own Gate.io +
// CoinGecko fetch inside the equivalence-principle block and never
// touches this proxy.
const GATE_PROXY = "/gate/api/v4/spot/candlesticks";

export const DISPLAY_PRICE_SOURCE: Record<Asset, string> = {
  JUP: `${GATE_PROXY}?currency_pair=JUP_USDT&interval=1h&limit=48`,
  ZAMA: `${GATE_PROXY}?currency_pair=ZAMA_USDT&interval=1h&limit=48`,
  ATOM: `${GATE_PROXY}?currency_pair=ATOM_USDT&interval=1h&limit=48`,
  ZRO: `${GATE_PROXY}?currency_pair=ZRO_USDT&interval=1h&limit=48`,
};

export const MIN_STAKE_GEN = 2n;
export const MAX_STAKE_GEN = 8n;
export const TERMINAL_REFUND_DAYS = 5;
