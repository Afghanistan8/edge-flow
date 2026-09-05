import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { NETWORK_CHAIN_ID } from "./config";
import type { Asset } from "./config";
import {
  claimTx,
  createMarketTx,
  getClaimable,
  getMarket,
  getMarkets,
  getOpenMarkets,
  getPosition,
  getSettlementEvidence,
  getSupportedAssets,
  getUserMarkets,
  resolveMarketTx,
  takePositionTx,
} from "./contract";
import { isConfigured, type WriteProgress } from "./genlayer";
import { ensureBradburyNetwork } from "./walletNetwork";

function requireAccount(address?: string): string {
  if (!address) throw new Error("Connect a wallet before sending a transaction");
  return address;
}

/** Retry state a page can render while a write is being re-attempted. */
export interface RetryState {
  attempt: number;
  maxAttempts: number;
}

/**
 * Point the wallet at Bradbury *and* at the canonical RPC before a write.
 *
 * Switching the chain id alone is not enough. A wallet that already knows
 * chain 4221 from ChainList keeps the public zkSync-OS endpoint, which
 * rate-limits broadcasts with -32005. wallet_addEthereumChain asks it to
 * adopt rpc-bradbury instead; MetaMask may decline to overwrite an
 * existing entry, which is why writes also retry and the UI explains the
 * manual fix.
 */
function useEnsureBradbury() {
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  return async () => {
    // Always offer the canonical RPC, even when already on 4221 — the
    // chain id can be right while the endpoint is the rate-limited one.
    await ensureBradburyNetwork();
    if (chainId === NETWORK_CHAIN_ID) return;
    try {
      await switchChainAsync({ chainId: NETWORK_CHAIN_ID });
    } catch (e) {
      const msg =
        (e as { shortMessage?: string; message?: string })?.shortMessage ??
        (e as Error)?.message ??
        String(e);
      throw new Error(
        `Please switch your wallet to Genlayer Bradbury Testnet (chain ${NETWORK_CHAIN_ID}). ${msg}`,
      );
    }
  };
}

/** Bridges genlayer-js retry callbacks into React state for the dialog. */
function useRetryTracker() {
  const [retry, setRetry] = useState<RetryState | null>(null);
  const onProgress: WriteProgress = ({ attempt, maxAttempts }) =>
    setRetry({ attempt, maxAttempts });
  const reset = () => setRetry(null);
  return { retry, onProgress, reset };
}

const enabled = () => isConfigured();

export function useSupportedAssets() {
  return useQuery({
    queryKey: ["supported-assets"],
    queryFn: getSupportedAssets,
    enabled: enabled(),
    staleTime: 60 * 60 * 1000,
  });
}

export function useMarkets(offset = 0, limit = 25) {
  return useQuery({
    queryKey: ["markets", offset, limit],
    queryFn: () => getMarkets(offset, limit),
    enabled: enabled(),
    refetchInterval: 15_000,
  });
}

export function useOpenMarkets() {
  return useQuery({
    queryKey: ["open-markets"],
    queryFn: () => getOpenMarkets(0, 25),
    enabled: enabled(),
    refetchInterval: 15_000,
  });
}

export function useMarket(id: number) {
  return useQuery({
    queryKey: ["market", id],
    queryFn: () => getMarket(id),
    enabled: enabled() && Number.isFinite(id),
    refetchInterval: 10_000,
  });
}

export function usePosition(id: number, wallet: string | undefined) {
  return useQuery({
    queryKey: ["position", id, wallet ?? "-"],
    queryFn: () => getPosition(id, wallet!),
    enabled: enabled() && Number.isFinite(id) && Boolean(wallet),
    refetchInterval: 15_000,
  });
}

export function useClaimable(id: number, wallet: string | undefined) {
  return useQuery({
    queryKey: ["claimable", id, wallet ?? "-"],
    queryFn: () => getClaimable(id, wallet!),
    enabled: enabled() && Number.isFinite(id) && Boolean(wallet),
    refetchInterval: 15_000,
  });
}

export function useSettlementEvidence(id: number) {
  return useQuery({
    queryKey: ["evidence", id],
    queryFn: () => getSettlementEvidence(id),
    enabled: enabled() && Number.isFinite(id),
    refetchInterval: 30_000,
  });
}

export function useUserMarkets(wallet: string | undefined) {
  return useQuery({
    queryKey: ["user-markets", wallet ?? "-"],
    queryFn: () => getUserMarkets(wallet!),
    enabled: enabled() && Boolean(wallet),
    refetchInterval: 20_000,
  });
}

// -------- writes ----------

/**
 * After any write the whole market view can shift — pools, phase,
 * position, claimable, evidence, and the portfolio list. Invalidate the
 * lot rather than guessing which slice moved.
 */
function invalidateAll(qc: ReturnType<typeof useQueryClient>, id?: number) {
  qc.invalidateQueries({ queryKey: ["markets"] });
  qc.invalidateQueries({ queryKey: ["open-markets"] });
  qc.invalidateQueries({ queryKey: ["user-markets"] });
  if (id !== undefined) {
    qc.invalidateQueries({ queryKey: ["market", id] });
    qc.invalidateQueries({ queryKey: ["position", id] });
    qc.invalidateQueries({ queryKey: ["claimable", id] });
    qc.invalidateQueries({ queryKey: ["evidence", id] });
  } else {
    qc.invalidateQueries({ queryKey: ["market"] });
    qc.invalidateQueries({ queryKey: ["position"] });
    qc.invalidateQueries({ queryKey: ["claimable"] });
    qc.invalidateQueries({ queryKey: ["evidence"] });
  }
}

export function useCreateMarket() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  const { retry, onProgress, reset } = useRetryTracker();
  const m = useMutation({
    mutationFn: async ({ asset, day }: { asset: Asset; day: string }) => {
      reset();
      await ensureChain();
      return createMarketTx(requireAccount(address), asset, day, onProgress);
    },
    onSuccess: () => invalidateAll(qc),
    onSettled: () => reset(),
  });
  return Object.assign(m, { retry });
}

export function useTakePosition() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  const { retry, onProgress, reset } = useRetryTracker();
  const m = useMutation({
    mutationFn: async ({
      marketId,
      side,
      stakeWei,
    }: {
      marketId: number;
      side: "UP" | "DOWN";
      stakeWei: bigint;
    }) => {
      reset();
      await ensureChain();
      return takePositionTx(
        requireAccount(address), marketId, side, stakeWei, onProgress,
      );
    },
    onSuccess: (_r, vars) => invalidateAll(qc, vars.marketId),
    onSettled: () => reset(),
  });
  return Object.assign(m, { retry });
}

export function useResolve() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  const { retry, onProgress, reset } = useRetryTracker();
  const m = useMutation({
    mutationFn: async (marketId: number) => {
      reset();
      await ensureChain();
      return resolveMarketTx(requireAccount(address), marketId, onProgress);
    },
    onSuccess: (_r, marketId) => invalidateAll(qc, marketId),
    onSettled: () => reset(),
  });
  return Object.assign(m, { retry });
}

export function useClaim() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  const { retry, onProgress, reset } = useRetryTracker();
  const m = useMutation({
    mutationFn: async (marketId: number) => {
      reset();
      await ensureChain();
      return claimTx(requireAccount(address), marketId, onProgress);
    },
    onSuccess: (_r, marketId) => invalidateAll(qc, marketId),
    onSettled: () => reset(),
  });
  return Object.assign(m, { retry });
}
