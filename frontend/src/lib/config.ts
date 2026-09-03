// Runtime configuration. All values are env-driven with sane fallbacks
// for local development against the GenLayer Bradbury testnet.

export const CONTRACT_ADDRESS = (
  import.meta.env.VITE_EDGEFLOW_CONTRACT_ADDRESS ?? ""
).trim();

export const RPC_URL = (
  import.meta.env.VITE_GENLAYER_RPC_URL ??
  "https://rpc-bradbury.genlayer.com"
).trim();

export const NETWORK_NAME = "GenLayer Bradbury Testnet";
export const NETWORK_CHAIN_ID = 4221;
export const NATIVE_SYMBOL = "GEN";
export const NATIVE_DECIMALS = 18;

export const SUPPORTED_ASSETS = ["JUP", "ZAMA", "ATOM", "ZRO"] as const;
export type Asset = (typeof SUPPORTED_ASSETS)[number];

// Display-only price sources. NEVER used for settlement — the contract
// re-fetches its own Coinmarket and Gate.io evidence.
export const DISPLAY_PRICE_SOURCE: Record<Asset, string> = {
  JUP: "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=JUP_USDT&interval=1h&limit=48",
  ZAMA: "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=ZAMA_USDT&interval=1h&limit=48",
  ATOM: "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=ATOM_USDT&interval=1h&limit=48",
  ZRO: "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=ZRO_USDT&interval=1h&limit=48",
};

export const MIN_STAKE_GEN = 2n;
export const MAX_STAKE_GEN = 8n;
export const TERMINAL_REFUND_DAYS = 5;
