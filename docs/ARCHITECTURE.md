# Edge-Flow Architecture

## Layers

1. **Contract** — `contracts/EdgeFlow.py`. Single `gl.Contract` subclass.
   Storage lives in TreeMaps only. Records are `NamedTuple`s in the
   direct-test shim; in a real GenVM deployment, replace with
   `@allow_storage` classes if fine-grained field access is desired.

2. **Direct tests** — `tests/direct/`. Run against an in-process shim
   at `tests/conftest.py` that mocks `gl.message`, `gl.nondet.web.get`,
   `gl.TreeMap` and native token send. This isolates all deterministic
   logic (date math, parsers, payout distribution, refund fallback).

3. **Consensus tests** — `tests/consensus/`. Verify that two validators
   with byte-different but semantically equivalent responses produce
   identical *normalized* evidence, and that unavailable evidence
   raises the correct error class.

4. **Frontend** — `frontend/`. React + TanStack Router + Wagmi +
   RainbowKit + genlayer-js. Reads only contract views. Uses Gate.io
   hourly bars for a live *display-only* chart on the market detail
   page.

## Deterministic vs nondeterministic

- **Deterministic**: date parsing, GMT+1 boundary math, stake bookkeeping,
  pool accounting, payout math, terminal-refund path, all view methods.
- **Nondeterministic**: `gl.nondet.web.get(url)` inside `resolve_market`
  for the two source fetches. Validators re-fetch and compare
  normalized fields (asset, pairs/slugs, target day, per-source
  direction, final result) — not raw response bytes.

## Error classes

| Class      | Meaning                                    | Retry? |
|------------|--------------------------------------------|--------|
| EXPECTED   | user-facing rejection (bad input, phase)   | no     |
| INVARIANT  | contract bug — must never happen           | no     |
| TRANSIENT  | HTTP timeout / 429 / 5xx / empty body      | yes    |
| EXTERNAL   | malformed / incomplete / oversized payload | yes    |

Only `TRANSIENT` and `EXTERNAL` triggered *before* the terminal-refund
deadline keep the market in `READY_TO_SETTLE` for retry. At/after the
deadline they trigger the refund fallback instead.

## GMT+1 in code

Fixed offset `+3600 s`. Never `Europe/Paris`. Never DST.

- `_gmt1_day_start_utc("YYYY-MM-DD")` returns UNIX seconds at the
  target GMT+1 midnight.
- The candle window is `[start, start + 86400)`.
- Gate row `t == start` is asserted to be the first candle open, and
  `t == start + 82800` (start + 23h) is asserted to be the last candle
  open; the last candle then completes at `start + 86400`.
