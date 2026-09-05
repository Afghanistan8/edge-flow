// Typed views on top of the raw genlayer client. Each function returns
// data shaped for the UI. Errors bubble up so React Query can retry.

import { readContract, writeContract, type WriteProgress } from "./genlayer";
import type { Asset } from "./config";

export type Phase =
  | "OPEN"
  | "CANDLE_LIVE"
  | "READY_TO_SETTLE"
  | "UP"
  | "DOWN"
  | "INCONCLUSIVE";

export type MarketResult = "" | "UP" | "DOWN" | "INCONCLUSIVE" | "REFUNDED";

export interface Market {
  id: number;
  asset: Asset;
  coinmarketSlug: string;
  gatePair: string;
  targetDay: string;
  createdAt: number;
  cutoffAt: number;
  settlesAt: number;
  terminalRefundAt: number;
  upPool: bigint;
  downPool: bigint;
  totalPool: bigint;
  paidOut: bigint;
  state: string;
  result: MarketResult;
  refundAll: boolean;
  resolvedAt: number;
  phase: Phase;
}

export interface Position {
  marketId: number;
  owner: string;
  side: "UP" | "DOWN" | "";
  stake: bigint;
  claimed: boolean;
  exists: boolean;
}

export interface SettlementEvidence {
  exists: boolean;
  marketId: number;
  resolvedAt: number;
  coinmarketOpen: bigint;
  coinmarketClose: bigint;
  coinmarketDirection: "UP" | "DOWN" | "";
  gateOpen: bigint;
  gateClose: bigint;
  gateDirection: "UP" | "DOWN" | "";
  finalResult: MarketResult;
  terminalRefund: boolean;
  priceScale: bigint;
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  return 0n;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number(v);
  return 0;
}

function marketFromRaw(raw: Record<string, unknown>): Market {
  return {
    id: toNum(raw.id),
    asset: String(raw.asset ?? "") as Asset,
    coinmarketSlug: String(raw.coinmarket_slug ?? ""),
    gatePair: String(raw.gate_pair ?? ""),
    targetDay: String(raw.target_day ?? ""),
    createdAt: toNum(raw.created_at),
    cutoffAt: toNum(raw.cutoff_at),
    settlesAt: toNum(raw.settles_at),
    terminalRefundAt: toNum(raw.terminal_refund_at),
    upPool: toBigInt(raw.up_pool),
    downPool: toBigInt(raw.down_pool),
    totalPool: toBigInt(raw.total_pool),
    paidOut: toBigInt(raw.paid_out),
    state: String(raw.state ?? ""),
    result: String(raw.result ?? "") as MarketResult,
    refundAll: Boolean(raw.refund_all),
    resolvedAt: toNum(raw.resolved_at),
    phase: String(raw.phase ?? "OPEN") as Phase,
  };
}

function evidenceFromRaw(raw: Record<string, unknown>): SettlementEvidence {
  return {
    exists: Boolean(raw.exists),
    marketId: toNum(raw.market_id),
    resolvedAt: toNum(raw.resolved_at),
    coinmarketOpen: toBigInt(raw.coinmarket_open),
    coinmarketClose: toBigInt(raw.coinmarket_close),
    coinmarketDirection: String(raw.coinmarket_direction ?? "") as
      | "UP"
      | "DOWN"
      | "",
    gateOpen: toBigInt(raw.gate_open),
    gateClose: toBigInt(raw.gate_close),
    gateDirection: String(raw.gate_direction ?? "") as "UP" | "DOWN" | "",
    finalResult: String(raw.final_result ?? "") as MarketResult,
    terminalRefund: Boolean(raw.terminal_refund),
    priceScale: toBigInt(raw.price_scale ?? 100_000_000n),
  };
}

export async function getSupportedAssets(): Promise<
  { asset: Asset; coinmarketSlug: string; gatePair: string }[]
> {
  const raw = await readContract<Array<Record<string, unknown>>>(
    "get_supported_assets",
  );
  return raw.map((r) => ({
    asset: String(r.asset) as Asset,
    coinmarketSlug: String(r.coinmarket_slug ?? ""),
    gatePair: String(r.gate_pair ?? ""),
  }));
}

export async function getMarkets(offset = 0, limit = 25): Promise<Market[]> {
  const raw = await readContract<Array<Record<string, unknown>>>(
    "get_markets",
    [offset, limit],
  );
  return raw.map(marketFromRaw);
}

export async function getOpenMarkets(
  offset = 0,
  limit = 25,
): Promise<Market[]> {
  const raw = await readContract<Array<Record<string, unknown>>>(
    "get_open_markets",
    [offset, limit],
  );
  return raw.map(marketFromRaw);
}

export async function getMarket(id: number): Promise<Market> {
  const raw = await readContract<Record<string, unknown>>("get_market", [id]);
  return marketFromRaw(raw);
}

export async function getMarketByAssetDay(
  asset: Asset,
  day: string,
): Promise<Market | null> {
  const raw = await readContract<Record<string, unknown>>(
    "get_market_by_asset_day",
    [asset, day],
  );
  if (!raw?.exists) return null;
  return marketFromRaw(raw);
}

export async function getPosition(
  marketId: number,
  wallet: string,
): Promise<Position> {
  const raw = await readContract<Record<string, unknown>>("get_position", [
    marketId,
    wallet,
  ]);
  return {
    marketId: toNum(raw.market_id),
    owner: String(raw.owner ?? ""),
    side: String(raw.side ?? "") as "UP" | "DOWN" | "",
    stake: toBigInt(raw.stake),
    claimed: Boolean(raw.claimed),
    exists: Boolean(raw.exists),
  };
}

export async function getClaimable(
  marketId: number,
  wallet: string,
): Promise<bigint> {
  return toBigInt(
    await readContract<unknown>("get_claimable", [marketId, wallet]),
  );
}

export async function getUserMarkets(
  wallet: string,
  offset = 0,
  limit = 25,
): Promise<Market[]> {
  const raw = await readContract<Array<Record<string, unknown>>>(
    "get_user_markets",
    [wallet, offset, limit],
  );
  return raw.map(marketFromRaw);
}

export async function getSettlementEvidence(
  marketId: number,
): Promise<SettlementEvidence> {
  const raw = await readContract<Record<string, unknown>>(
    "get_settlement_evidence",
    [marketId],
  );
  return evidenceFromRaw(raw);
}

// ------------------- writes -------------------
//
// All writes require the caller to pass the connected wallet address so
// genlayer-js can route signing through the injected wallet.

export function createMarketTx(
  account: string,
  asset: Asset,
  targetDay: string,
  onProgress?: WriteProgress,
) {
  return writeContract("create_market", [asset, targetDay], {
    account,
    onProgress,
  });
}

export function takePositionTx(
  account: string,
  marketId: number,
  side: "UP" | "DOWN",
  stakeWei: bigint,
  onProgress?: WriteProgress,
) {
  return writeContract("take_position", [marketId, side], {
    account,
    value: stakeWei,
    onProgress,
  });
}

export function resolveMarketTx(
  account: string,
  marketId: number,
  onProgress?: WriteProgress,
) {
  return writeContract("resolve_market", [marketId], { account, onProgress });
}

export function claimTx(
  account: string,
  marketId: number,
  onProgress?: WriteProgress,
) {
  return writeContract("claim", [marketId], { account, onProgress });
}
