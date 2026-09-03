# Edge-Flow

Edge-Flow is a permissionless daily crypto prediction market on GenLayer.
For four assets — **JUP, ZAMA, ATOM, ZRO** — users predict whether the
completed GMT+1 daily candle closes up or down, staking **2–8 GEN**.
There is no admin, no privileged oracle, and no single feed that decides
the outcome. The deployed contract itself re-fetches two independent
public data sources and only finalizes a direction when both agree.

- **Live app:** https://edge-flow-rose.vercel.app
- **Network:** GenLayer Bradbury Testnet, **chain id 4221**
- **RPC:** https://rpc-bradbury.genlayer.com
- **Explorer:** https://explorer-bradbury.genlayer.com
- **Contract:** `0x3E726A419600Fd7b59de44fA12c3Daf154Df7953`
- **Faucet:** https://testnet-faucet.genlayer.foundation

## Assets, slugs and pairs

| Asset | CoinGecko id              | Gate.io pair |
|-------|---------------------------|--------------|
| JUP   | `jupiter-exchange-solana` | `JUP_USDT`   |
| ZAMA  | `zama`                    | `ZAMA_USDT`  |
| ATOM  | `cosmos`                  | `ATOM_USDT`  |
| ZRO   | `layerzero`               | `ZRO_USDT`   |

All four are verified working against the live endpoints — run
`python scripts/check_sources.py` to re-check.

## Timing (GMT+1, no DST)

The market day is a calendar date in a fixed **+1 hour** offset from
UTC — never DST-shifted. For target day `D`:

- Entries close at `D 00:00 GMT+1`
- Candle window runs `[D 00:00 GMT+1, D+1 00:00 GMT+1)`
- `resolve_market` becomes callable at `D+1 00:00 GMT+1`
- Terminal refund fallback becomes callable **5 days** later

All lifecycle math reads `gl.message_raw["datetime"]` — the consensus
transaction time GenVM hands every validator — never the node wall
clock, so all validators compute the same phase. (`gl.message` has no
`timestamp` field; the raw message is where the time lives.)

## Staking rules

- Minimum stake **2 GEN**, maximum **8 GEN** per wallet per market.
- Same-side top-ups allowed while `OPEN`; side switching is rejected.
- Payouts are pro-rata on the winning pool with integer GEN math.
- A directional result with zero stake on the winning side refunds all
  original stakes.

## Settlement — 2-of-2, two independent sources

Callers of `resolve_market(market_id)` cannot pass market data. The
contract owns the pairs, URL templates, parsers, direction math, and the
final result. Inside a `gl.eq_principle.strict_eq` block it fetches:

- **CoinGecko** `/coins/{id}/market_chart/range` — public and keyless —
  reconstructing one completed GMT+1 daily candle.
- **Gate.io** hourly spot candlesticks — reconstructing the same 24-hour
  GMT+1 window. Gate's `interval=1d` is deliberately *not* used because
  Gate's daily bars are not GMT+1-aligned.

> **Naming note.** Contract storage fields and the original spec call the
> first source "Coinmarket". The URL the contract actually locks and
> fetches is CoinGecko's public market-chart API — a keyless endpoint
> every validator can GET. The UI says CoinGecko; the storage field names
> (`coinmarket_slug`, `coinmarket_direction`, …) keep the old name to
> avoid a breaking storage migration.

For each source independently: `direction = UP if close > open else DOWN`
(a flat candle is DOWN).

- `UP + UP` → **UP**
- `DOWN + DOWN` → **DOWN**
- disagreement → **INCONCLUSIVE**, all stakes refundable
- unavailable / malformed / incomplete → revert `TRANSIENT` or
  `EXTERNAL`, market stays `READY_TO_SETTLE`, anyone may retry
- 5 days past eligibility with evidence still unavailable → terminal
  refund path finalizes `INCONCLUSIVE` with `terminal_refund=true`. No
  source direction is ever fabricated.
- Valid evidence after the deadline still settles normally.

### What the validators actually compare

The equivalence-principle payload binds **normalized fields only**:

```
market_id | asset | coingecko_id | gate_pair | target_day
          | source_a_direction | source_b_direction | final_result
```

Raw open/close prices are **excluded from the consensus key** on purpose.
Two validators polling the public feeds seconds apart legitimately see
different sample points; making prices part of the key would stall
settlement even when both sources plainly agree on direction. Prices are
still recorded as evidence after agreement, for display.

A single source can never produce `UP` or `DOWN` — the contract asserts
`cm_dir == gt_dir` before writing a directional result.

## Permissions

| Method            | Who may call                                |
|-------------------|---------------------------------------------|
| `create_market`   | any caller (valid future GMT+1 day, unique) |
| `take_position`   | any caller while `OPEN`                     |
| `resolve_market`  | any caller once settlement-eligible         |
| `claim`           | only the position's owner, once             |

## Architecture

```
Browser wallet ──▶ Bradbury RPC ──▶ EdgeFlow (gl.Contract)
                                        │
                                        └── validator fetch:
                                            CoinGecko + Gate.io
```

The frontend reads only contract views and submits wallet transactions.
Chart and live prices in the UI are display-only — they never decide
outcomes.

## Using the app

1. **Get GEN.** Claim testnet GEN from
   https://testnet-faucet.genlayer.foundation.
2. **Connect.** The header's Connect button defaults to Bradbury. If your
   wallet is on another chain a yellow banner appears with a one-click
   switch; every write also auto-prompts a switch before signing.
3. **Create a market** (`/create`): pick an asset and a future GMT+1
   date. The form previews the exact cutoff, settle, and refund times.
   One market per asset per day.
4. **Stake** (`/market/:id`): choose UP or DOWN and an amount between 2
   and 8 GEN while the market is `OPEN`. You may top up the same side;
   you cannot switch sides.
5. **Resolve**: once the candle completes the market shows
   `READY_TO_SETTLE` and *anyone* can press Resolve. If a source is
   temporarily unavailable the call reverts and stays retryable.
6. **Claim** (`/portfolio` or the market page): when the contract reports
   a claimable amount, the claim button appears. Claims are one-shot.

## Deploying the frontend (Vercel)

- **Root Directory must be `frontend`.** Vercel then auto-detects Vite.
- Set these in Project Settings → Environment Variables:

  | Variable | Required | Notes |
  |----------|----------|-------|
  | `VITE_EDGEFLOW_CONTRACT_ADDRESS` | recommended | falls back to the address above if unset |
  | `VITE_GENLAYER_RPC_URL` | optional | defaults to the Bradbury public RPC |
  | `VITE_WALLETCONNECT_PROJECT_ID` | optional | from https://cloud.reown.com; without it injected wallets still work, only the WalletConnect QR flow is disabled |

- **Vite inlines `VITE_*` at build time.** Changing an env var does
  nothing until you **Redeploy**. There is no runtime override.
- `frontend/vercel.json` rewrites all unmatched paths to `index.html`
  (client-side routing) and proxies `/gate/*` to `api.gateio.ws` for the
  display-only chart, which has no CORS headers of its own.

## Local commands

```bash
python -m pytest tests/direct tests/consensus -q   # 68 tests
python scripts/check_sources.py                    # live endpoint probe
python scripts/demo_predictions.py                 # 5 end-to-end lifecycles
```

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build
```

## Limitations

- Bradbury testnet only.
- Payouts use integer floor division — small dust may remain in the pool
  after all claims. It is never possible to pay out more than the tracked
  pool.
- Two-source dependency: if either CoinGecko or Gate.io is down for more
  than 5 days, the terminal-refund path returns original stakes rather
  than a pro-rata result.
- Contract storage grows with each market; `TreeMap`-backed indexes are
  paginated to 50 records per page.
