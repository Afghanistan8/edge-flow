# Edge-Flow

Edge-Flow is a permissionless daily crypto prediction market on GenLayer.
For four assets — **JUP, ZAMA, ATOM, ZRO** — users predict whether the
completed GMT+1 daily candle closes up or down, staking **2–8 GEN**.
There is no admin, no privileged oracle, and no single feed that decides
the outcome. The deployed contract itself re-fetches two independent
public data sources and only finalizes a direction when both agree.

## Assets and pairs

| Asset | Coinmarket slug            | Gate.io pair |
|-------|----------------------------|--------------|
| JUP   | `jupiter-exchange-solana`  | `JUP_USDT`   |
| ZAMA  | `zama`                     | `ZAMA_USDT`  |
| ATOM  | `cosmos`                   | `ATOM_USDT`  |
| ZRO   | `layerzero`                | `ZRO_USDT`   |

## Timing (GMT+1, no DST)

The market day is a calendar date in a fixed **+1 hour** offset from
UTC — never DST-shifted. For target day `D`:

- Entries close at `D 00:00 GMT+1`
- Candle window runs `[D 00:00 GMT+1, D+1 00:00 GMT+1)`
- `resolve_market` becomes callable at `D+1 00:00 GMT+1`
- Terminal refund fallback becomes callable **5 days** later

## Staking rules

- Minimum stake: **2 GEN**. Maximum stake per wallet per market: **8 GEN**.
- Same-side top-ups are allowed while `OPEN`.
- Side switching is rejected.
- Payouts are pro-rata on the winning pool with integer GEN math.
- A directional result with zero stake on the winning side refunds all
  original stakes.

## Settlement — 2-of-2 Coinmarket + Gate.io

Callers of `resolve_market(market_id)` cannot pass market data. The
contract owns pairs, URL templates, parsers, direction math, and the
final result. It fetches two feeds through `gl.nondet.web.get`:

- **Coinmarket** (public keyless market-chart endpoint aligned to
  Coinmarket-tracked USD prices) — reconstructs one completed GMT+1
  daily candle.
- **Gate.io** hourly candlesticks — reconstructs the same 24-hour GMT+1
  window (Gate’s `interval=1d` is deliberately not used because Gate’s
  daily bars are not GMT+1-aligned).

For each source independently: `direction = UP if close > open else DOWN`.

- `UP + UP` → market settles **UP**
- `DOWN + DOWN` → market settles **DOWN**
- disagreement → **INCONCLUSIVE**, all stakes refundable
- unavailable / malformed / incomplete data → revert with
  `TRANSIENT` or `EXTERNAL` class, market stays `READY_TO_SETTLE`,
  anyone may retry
- 5 days past settlement eligibility with still-unavailable evidence →
  a terminal refund path finalizes an `INCONCLUSIVE` state with
  `terminal_refund=true`. No source direction is ever fabricated.
- Valid evidence after the deadline still settles normally.

## Permissions

| Method            | Who may call                                     |
|-------------------|--------------------------------------------------|
| `create_market`   | any caller (valid future GMT+1 day, unique)     |
| `take_position`   | any caller while `OPEN`                          |
| `resolve_market`  | any caller once settlement-eligible              |
| `claim`           | only the position’s owner, once                  |

## Architecture

```
User wallet ──▶ Bradbury RPC ──▶ EdgeFlow (gl.Contract)
                                      │
                                      └── validator fetch: Coinmarket + Gate.io
```

The frontend reads only contract views and submits wallet transactions.
Chart and live prices in the UI are display-only affordances — they
never decide outcomes.

## Layout

```
edge-flow/
  contracts/EdgeFlow.py         # the contract
  tests/direct/                 # deterministic direct-VM tests
  tests/consensus/              # normalized-evidence consensus tests
  scripts/check_sources.py      # operational live probe (not consensus)
  frontend/                     # React + TanStack + Wagmi + genlayer-js
  docs/
  requirements.txt              # runtime
  requirements-dev.txt          # pytest + gltest
  .env.example
```

## Local commands

Tests (56 direct + consensus tests):

```bash
python -m pytest tests/direct tests/consensus -q
```

Live source probe:

```bash
python scripts/check_sources.py --day 2026-09-04
```

Frontend:

```bash
cd frontend
bun install       # or: npm install / pnpm install
bun run dev       # http://localhost:5173
bun run build     # production bundle
bun run typecheck
bun run lint
```

Set `VITE_EDGEFLOW_CONTRACT_ADDRESS` in `frontend/.env` before running.

## Limitations

- Bradbury testnet only.
- Payouts use integer floor division — small dust may remain in the
  pool after all claims. It is never possible to pay out more than the
  tracked pool.
- Two-source dependency: if either Coinmarket or Gate.io is down for
  more than 5 days, the terminal-refund path returns original stakes
  (not the pro-rata result).
- Contract storage grows with each market. `TreeMap`-backed indexes
  are paginated to 50 records per page.
