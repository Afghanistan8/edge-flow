import { NATIVE_DECIMALS, NATIVE_SYMBOL } from "./config";

export function formatGen(raw: bigint | number | string, maxDp = 3): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(NATIVE_DECIMALS);
  const whole = abs / scale;
  const frac = abs % scale;
  const fracStr = frac.toString().padStart(NATIVE_DECIMALS, "0");
  let out = `${whole.toString()}.${fracStr.slice(0, maxDp)}`;
  // trim trailing zeros
  out = out.replace(/\.?0+$/, "");
  if (!out || out === "-") out = "0";
  return `${neg ? "-" : ""}${out} ${NATIVE_SYMBOL}`;
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatPercent(num: bigint, denom: bigint): string {
  if (denom === 0n) return "—";
  const p = Number((num * 10_000n) / denom) / 100;
  return `${p.toFixed(1)}%`;
}
