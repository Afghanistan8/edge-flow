import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  return useMutation({
    mutationFn: ({ asset, day }: { asset: Asset; day: string }) =>
      createMarketTx(asset, day),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["markets"] });
      qc.invalidateQueries({ queryKey: ["open-markets"] });
    },
  });
}

export function useTakePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      marketId,
      side,
      stakeWei,
    }: {
      marketId: number;
      side: "UP" | "DOWN";
      stakeWei: bigint;
    }) => takePositionTx(marketId, side, stakeWei),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["market", vars.marketId] });
      qc.invalidateQueries({ queryKey: ["markets"] });
      qc.invalidateQueries({ queryKey: ["position", vars.marketId] });
    },
  });
}

export function useResolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (marketId: number) => resolveMarketTx(marketId),
    onSuccess: (_r, marketId) => {
      qc.invalidateQueries({ queryKey: ["market", marketId] });
      qc.invalidateQueries({ queryKey: ["evidence", marketId] });
    },
  });
}

export function useClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (marketId: number) => claimTx(marketId),
    onSuccess: (_r, marketId) => {
      qc.invalidateQueries({ queryKey: ["market", marketId] });
      qc.invalidateQueries({ queryKey: ["claimable", marketId] });
    },
  });
}
