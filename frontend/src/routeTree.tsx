import {
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { Header } from "./components/Header";
import { MarketsPage } from "./pages/Markets";
import { MarketDetailPage } from "./pages/MarketDetail";
import { CreatePage } from "./pages/Create";
import { PortfolioPage } from "./pages/Portfolio";
import { ActivityPage } from "./pages/Activity";
import { HowItWorksPage } from "./pages/HowItWorks";
import { NotConfigured } from "./pages/NotConfigured";
import { isConfigured } from "./lib/genlayer";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl w-full mx-auto px-5 py-8">
        {isConfigured() ? <Outlet /> : <NotConfigured />}
      </main>
      <footer className="mt-16 border-t border-[var(--ef-edge)]">
        <div className="max-w-6xl mx-auto px-5 py-6 text-xs text-[var(--ef-ink-dim)] flex flex-wrap items-center gap-3 justify-between">
          <span className="ef-mono">
            edge·flow · Bradbury testnet · GMT+1 candle · Coinmarket + Gate.io
          </span>
          <span>Contract is source of truth.</span>
        </div>
      </footer>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/markets" });
  },
});

const marketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/markets",
  component: MarketsPage,
});

const marketDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/market/$id",
  component: MarketDetailPage,
});

const createRouteDef = createRoute({
  getParentRoute: () => rootRoute,
  path: "/create",
  component: CreatePage,
});

const portfolioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portfolio",
  component: PortfolioPage,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});

const howRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/how-it-works",
  component: HowItWorksPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  marketsRoute,
  marketDetailRoute,
  createRouteDef,
  portfolioRoute,
  activityRoute,
  howRoute,
]);
