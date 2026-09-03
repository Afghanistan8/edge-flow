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
import { isConfigured } from "./genlayer";

function requireAccount(address?: string): string {
  if (!address) throw new Error("Connect a wallet before sending a transaction");
  return address;
}

// Ensures the connected wallet is on Bradbury (chain 4221) before a
// write goes out. If the wallet is on the wrong chain, wagmi's
// switchChain triggers wallet_switchEthereumChain and, when the wallet
// doesn't know Bradbury yet, wallet_addEthereumChain — both surface a
// prompt in the wallet UI.
function useEnsureBradbury() {
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  return async () => {
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

export function useCreateMarket() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  return useMutation({
    mutationFn: async ({ asset, day }: { asset: Asset; day: string }) => {
      await ensureChain();
      return createMarketTx(requireAccount(address), asset, day);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["markets"] });
      qc.invalidateQueries({ queryKey: ["open-markets"] });
    },
  });
}

export function useTakePosition() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  return useMutation({
    mutationFn: async ({
      marketId,
      side,
      stakeWei,
    }: {
      marketId: number;
      side: "UP" | "DOWN";
      stakeWei: bigint;
    }) => {
      await ensureChain();
      return takePositionTx(requireAccount(address), marketId, side, stakeWei);
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["market", vars.marketId] });
      qc.invalidateQueries({ queryKey: ["markets"] });
      qc.invalidateQueries({ queryKey: ["position", vars.marketId] });
    },
  });
}

export function useResolve() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  return useMutation({
    mutationFn: async (marketId: number) => {
      await ensureChain();
      return resolveMarketTx(requireAccount(address), marketId);
    },
    onSuccess: (_r, marketId) => {
      qc.invalidateQueries({ queryKey: ["market", marketId] });
      qc.invalidateQueries({ queryKey: ["evidence", marketId] });
    },
  });
}

export function useClaim() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const ensureChain = useEnsureBradbury();
  return useMutation({
    mutationFn: async (marketId: number) => {
      await ensureChain();
      return claimTx(requireAccount(address), marketId);
    },
    onSuccess: (_r, marketId) => {
      qc.invalidateQueries({ queryKey: ["market", marketId] });
      qc.invalidateQueries({ queryKey: ["claimable", marketId] });
    },
  });
}
