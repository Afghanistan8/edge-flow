"""End-to-end demonstration of Edge-Flow's full lifecycle.

Runs five real prediction scenarios against the actual contract using
the in-process shim from tests/conftest.py. Every step exercises the
real contract code:

  create_market -> take_position (multi-user) -> resolve_market
  -> get_settlement_evidence -> claim

This is NOT a mocked test summary -- each print line reflects the
contract's actual return value or view result. Any deviation from the
expected outcome raises AssertionError and the script exits non-zero.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

# Register the GenLayer shim before importing the contract.
import conftest as C  # noqa: E402

from contracts.EdgeFlow import EdgeFlow  # noqa: E402

DAY = 86_400
HOUR = 3_600
GEN = 10**18

ALICE = "0x00000000000000000000000000000000000000a1"
BOB = "0x00000000000000000000000000000000000000b2"
CARL = "0x00000000000000000000000000000000000000c3"
DEV = "0x00000000000000000000000000000000000000d4"


def set_time(ts: int) -> None:
    C.gl.message.timestamp = int(ts)


def set_sender(addr: str, value: int = 0) -> None:
    C.gl.message.sender_address = C._Address(addr)
    C.gl.message.value = int(value)


def set_nondet(handler) -> None:
    C.gl.nondet.set_handler(handler)


def clear_ledger() -> None:
    C.ledger.clear()


def _day_start(target: str) -> int:
    from contracts.EdgeFlow import _gmt1_day_start_utc
    return _gmt1_day_start_utc(target)


def cm_body(day_start: int, open_p: float, close_p: float) -> str:
    return C.full_coinmarket(day_start, open_p, close_p)


def gate_body(day_start: int, open_p: float, close_p: float) -> str:
    return C.full_gate(day_start, open_p, close_p)


def bar(label: str) -> None:
    print()
    print("=" * 72)
    print(label)
    print("=" * 72)


def kv(k: str, v) -> None:
    print(f"  {k:<28} {v}")


def check(cond: bool, msg: str) -> None:
    tag = "  [OK]  " if cond else "  [FAIL]"
    print(f"{tag} {msg}")
    if not cond:
        raise AssertionError(msg)


def run() -> None:
    contract = EdgeFlow()

    scenarios = [
        # (label, asset, target_day, coinmarket (open, close), gate (open, close),
        #  expected_result, positions [(wallet, side, gen)], expected_payouts)
        {
            "label": "Prediction 1 -- JUP UP, 2-of-2 agreement, Alice wins",
            "asset": "JUP",
            "day": "2027-01-15",
            "cm": (1.00, 1.20),
            "gt": (1.02, 1.25),
            "expect": "UP",
            "positions": [(ALICE, "UP", 5 * GEN), (BOB, "DOWN", 3 * GEN)],
            # up_pool=5, down_pool=3, total=8. Alice UP=5 -> 5 * 8 / 5 = 8 GEN.
            "expect_payouts": {ALICE: 8 * GEN, BOB: 0},
        },
        {
            "label": "Prediction 2 -- ATOM DOWN, pro-rata across 3 down bettors",
            "asset": "ATOM",
            "day": "2027-02-10",
            "cm": (7.50, 6.80),
            "gt": (7.60, 6.90),
            "expect": "DOWN",
            "positions": [
                (ALICE, "UP", 4 * GEN),
                (BOB, "DOWN", 2 * GEN),
                (CARL, "DOWN", 2 * GEN),
            ],
            # up_pool=4, down_pool=4, total=8. Each 2 GEN down -> 2 * 8 / 4 = 4 GEN.
            "expect_payouts": {ALICE: 0, BOB: 4 * GEN, CARL: 4 * GEN},
        },
        {
            "label": "Prediction 3 -- ZAMA disagreement -> INCONCLUSIVE, all refunded",
            "asset": "ZAMA",
            "day": "2027-03-05",
            "cm": (1.00, 1.10),   # UP
            "gt": (1.10, 1.00),   # DOWN
            "expect": "INCONCLUSIVE",
            "positions": [(ALICE, "UP", 3 * GEN), (BOB, "DOWN", 5 * GEN)],
            "expect_payouts": {ALICE: 3 * GEN, BOB: 5 * GEN},
        },
        {
            "label": "Prediction 4 -- ZRO UP but only DOWN stakers -> refund_all safety",
            "asset": "ZRO",
            "day": "2027-04-20",
            "cm": (2.00, 2.30),
            "gt": (2.05, 2.35),
            "expect": "UP",
            "positions": [(ALICE, "DOWN", 3 * GEN), (BOB, "DOWN", 2 * GEN)],
            # No UP stake exists but result is UP -- refund_all should refund both.
            "expect_payouts": {ALICE: 3 * GEN, BOB: 2 * GEN},
        },
        {
            "label": "Prediction 5 -- JUP DOWN with same-side top-up before cutoff",
            "asset": "JUP",
            "day": "2027-05-01",
            "cm": (1.30, 1.10),
            "gt": (1.28, 1.12),
            "expect": "DOWN",
            # Alice tops up: 2 GEN + 3 GEN = 5 GEN on DOWN. Bob 3 GEN on UP.
            "positions": [
                (ALICE, "DOWN", 2 * GEN),
                (ALICE, "DOWN", 3 * GEN),
                (BOB, "UP", 3 * GEN),
            ],
            # down_pool=5, up_pool=3, total=8. Alice DOWN=5 -> 5 * 8 / 5 = 8 GEN.
            "expect_payouts": {ALICE: 8 * GEN, BOB: 0},
        },
    ]

    for i, s in enumerate(scenarios, start=1):
        bar(s["label"])
        day_start = _day_start(s["day"])
        # Move clock to 1 day before cutoff and create market
        set_time(day_start - DAY)
        set_sender(DEV, 0)
        mid = int(contract.create_market(s["asset"], s["day"]))
        m = contract.get_market(C._U256(mid))
        kv("Market #id", mid)
        kv("Asset / target GMT+1", f"{s['asset']} / {s['day']}")
        kv("Cutoff (unix)", m["cutoff_at"])
        kv("Settles at (unix)", m["settles_at"])
        kv("Terminal refund at", m["terminal_refund_at"])
        check(
            m["settles_at"] - m["cutoff_at"] == DAY,
            "candle window is exactly 24 hours",
        )
        check(
            m["terminal_refund_at"] - m["settles_at"] == 5 * DAY,
            "terminal refund is exactly 5 days after settle",
        )

        # Take positions
        set_time(day_start - HOUR)
        for w, side, stake in s["positions"]:
            set_sender(w, stake)
            contract.take_position(C._U256(mid), side)
        m = contract.get_market(C._U256(mid))
        kv("UP pool  ", f"{m['up_pool'] / GEN:>6.2f} GEN")
        kv("DOWN pool", f"{m['down_pool'] / GEN:>6.2f} GEN")

        # Resolve
        set_time(m["settles_at"] + 60)
        set_sender(DEV, 0)
        set_nondet(C.make_nondet({
            "coingecko.com": cm_body(day_start, *s["cm"]),
            "gateio.ws": gate_body(day_start, *s["gt"]),
        }))
        result = contract.resolve_market(C._U256(mid))
        kv("Resolved result", result)
        check(result == s["expect"], f"result matches expected: {s['expect']}")

        ev = contract.get_settlement_evidence(C._U256(mid))
        kv("Coinmarket direction", ev["coinmarket_direction"])
        kv("Gate.io direction   ", ev["gate_direction"])
        kv("Terminal refund",     ev["terminal_refund"])

        # Claim from each unique wallet, verify payouts
        clear_ledger()
        unique_wallets = list({w for (w, _s, _st) in s["positions"]})
        for w in unique_wallets:
            set_sender(w, 0)
            expected = s["expect_payouts"].get(w, 0)
            if expected == 0:
                try:
                    contract.claim(C._U256(mid))
                    check(False, f"claim by loser {w[:8]}... should have reverted")
                except Exception as e:
                    check(
                        "nothing to claim" in str(e),
                        f"loser {w[:8]}... rejected with 'nothing to claim'",
                    )
            else:
                got = int(contract.claim(C._U256(mid)))
                kv(f"Payout to {w[:8]}...", f"{got / GEN:>6.2f} GEN")
                check(
                    got == expected,
                    f"payout to {w[:8]}... equals {expected / GEN:.2f} GEN",
                )
                check(
                    C.ledger[w.lower()] == expected,
                    "native send credited the wallet ledger",
                )

        # Never pay out more than the pool
        m = contract.get_market(C._U256(mid))
        check(
            m["paid_out"] <= m["total_pool"],
            f"paid_out ({m['paid_out']}) <= total_pool ({m['total_pool']})",
        )

    bar("SUMMARY")
    print(f"  All {len(scenarios)} prediction scenarios completed successfully.")
    print(f"  Contract markets tracked: {int(contract.market_count)}")


if __name__ == "__main__":
    try:
        run()
        print()
        print("[PASS] All predictions executed and settled correctly.")
    except AssertionError as e:
        print(f"\n[FAIL] {e}", file=sys.stderr)
        sys.exit(1)
