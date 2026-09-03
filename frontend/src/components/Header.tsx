import { Link } from "@tanstack/react-router";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useChainId, useSwitchChain } from "wagmi";
import { NETWORK_NAME, NETWORK_CHAIN_ID, NATIVE_SYMBOL } from "@/lib/config";
import { formatGen } from "@/lib/format";

const links: { to: string; label: string }[] = [
  { to: "/markets", label: "Markets" },
  { to: "/create", label: "Create" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/activity", label: "Activity" },
  { to: "/how-it-works", label: "How it works" },
];

export function Header() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onWrongChain = isConnected && chainId !== NETWORK_CHAIN_ID;

  return (
    <header className="border-b border-[var(--ef-edge)] backdrop-blur bg-[color-mix(in_srgb,var(--ef-ground)_85%,transparent)] sticky top-0 z-40">
      {onWrongChain && (
        <div className="w-full bg-[var(--ef-warn)] text-black text-xs ef-mono">
          <div className="max-w-6xl mx-auto px-5 py-1.5 flex items-center gap-3">
            <span>
              Your wallet is on chain {chainId}. Edge-Flow lives on Bradbury
              (chain {NETWORK_CHAIN_ID}).
            </span>
            <button
              className="ml-auto rounded bg-black/80 text-[var(--ef-warn)] px-2 py-0.5 uppercase tracking-widest"
              onClick={() => switchChain({ chainId: NETWORK_CHAIN_ID })}
            >
              switch network
            </button>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto flex items-center gap-6 px-5 py-3">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="ef-tick" />
          <span className="ef-mono text-[13px] tracking-widest uppercase">
            edge<span className="text-[var(--ef-accent)]">·</span>flow
          </span>
        </Link>
        <nav className="hidden md:flex gap-4 text-sm">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="text-[var(--ef-ink-dim)] hover:text-[var(--ef-ink)] transition-colors"
              activeProps={{ className: "text-[var(--ef-ink)]" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-3 text-xs text-[var(--ef-ink-dim)] ef-mono">
          <span className="px-2 py-1 rounded border border-[var(--ef-edge)] bg-[var(--ef-panel)]">
            {NETWORK_NAME}
          </span>
          {isConnected && balance && (
            <span className="px-2 py-1 rounded border border-[var(--ef-edge)] bg-[var(--ef-panel)]">
              {formatGen(balance.value)} {NATIVE_SYMBOL}
            </span>
          )}
        </div>
        <ConnectButton
          showBalance={false}
          accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
        />
      </div>
    </header>
  );
}
