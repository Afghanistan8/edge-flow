import type { ReactElement } from "react";
import type { Asset } from "@/lib/config";

// Original monochrome asset glyphs. Simple abstract marks — a specific
// visual for each supported asset without leaning on any external
// brand asset.

const GLYPHS: Record<Asset, ReactElement> = {
  JUP: (
    <>
      <circle cx="12" cy="12" r="10" opacity="0.15" />
      <path d="M4 12 L12 4 L20 12 L12 20 Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </>
  ),
  ZAMA: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" opacity="0.15" />
      <path d="M6 8 L18 8 M6 12 L18 12 M6 16 L18 16" />
      <path d="M9 4 L15 20" strokeDasharray="1 2" />
    </>
  ),
  ATOM: (
    <>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-60 12 12)" />
    </>
  ),
  ZRO: (
    <>
      <circle cx="12" cy="12" r="9" opacity="0.15" />
      <path d="M6 6 L18 18 M6 18 L18 6" />
      <circle cx="12" cy="12" r="5" />
    </>
  ),
};

export function AssetGlyph({
  asset,
  size = 20,
}: {
  asset: Asset;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-label={asset}
      role="img"
    >
      {GLYPHS[asset]}
    </svg>
  );
}
