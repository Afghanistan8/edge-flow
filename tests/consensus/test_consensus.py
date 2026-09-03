"""Consensus-shape tests for Edge-Flow.

Validators re-run resolve_market with their own fetch results and must
agree on the *normalized* settlement fields, not on raw bytes. This
suite verifies:

- Two validators with byte-different but semantically identical responses
  produce identical normalized evidence (agreement).
- A validator serving unavailable data produces a TRANSIENT/EXTERNAL
  error class, which the consensus layer treats as retry rather than as
  a settled disagreement.
"""

from __future__ import annotations

import json

import pytest

from tests.conftest import (
    DAY,
    HOUR,
    full_coinmarket,
    full_gate,
    coinmarket_body,
    gate_body,
    make_nondet,
)


TARGET_DAY = "2026-09-04"
DAY_START_UTC = 1788476400
SETTLES_AT = DAY_START_UTC + DAY

ALICE = "0x00000000000000000000000000000000000000a1"
BOB = "0x00000000000000000000000000000000000000b2"
GEN = 10**18


def _prepare(gl_env, contract):
    gl_env.set_time(DAY_START_UTC - DAY)
    gl_env.set_sender(ALICE, 0)
    mid = int(contract.create_market("JUP", TARGET_DAY))
    gl_env.set_time(DAY_START_UTC - HOUR)
    gl_env.set_sender(ALICE, 3 * GEN)
    contract.take_position(gl_env.u256(mid), "UP")
    gl_env.set_sender(BOB, 4 * GEN)
    contract.take_position(gl_env.u256(mid), "DOWN")
    return mid


def _normalized(ev: dict) -> dict:
    return {
        "market_id": ev["market_id"],
        "coinmarket_direction": ev["coinmarket_direction"],
        "gate_direction": ev["gate_direction"],
        "final_result": ev["final_result"],
        "terminal_refund": ev["terminal_refund"],
    }


def test_validators_agree_despite_byte_differences(gl_env, contract):
    """Two validators pull the same window but with different sample
    density and formatting. They must derive identical normalized
    evidence and thus reach consensus."""
    mid = _prepare(gl_env, contract)

    # Validator A: dense (default helper).
    body_cm_a = full_coinmarket(DAY_START_UTC, 1.00, 1.20)
    body_gt_a = full_gate(DAY_START_UTC, 1.00, 1.30)

    # Validator B: same window, different granularity/quotes/whitespace, but
    # the semantic open/close alignment is identical (open sample at start,
    # close sample near end).
    body_cm_b = json.dumps({
        "prices": [
            [DAY_START_UTC * 1000, "1.00"],
            [(DAY_START_UTC + DAY // 2) * 1000, "1.10"],
            [(DAY_START_UTC + DAY - 300) * 1000, "1.20"],
        ]
    }, separators=(",", ":"))
    body_gt_b = full_gate(DAY_START_UTC, 1.00, 1.30)  # candlesticks aligned

    gl_env.set_time(SETTLES_AT + 60)

    # Validator A
    gl_env.set_nondet(make_nondet({
        "coingecko.com": body_cm_a,
        "gateio.ws": body_gt_a,
    }))
    contract.resolve_market(gl_env.u256(mid))
    ev_a = contract.get_settlement_evidence(gl_env.u256(mid))

    # Reset state to re-run as Validator B on a fresh instance.
    from contracts.EdgeFlow import EdgeFlow  # noqa: WPS433 (local import)
    contract2 = EdgeFlow()
    gl_env.set_time(DAY_START_UTC - DAY)
    gl_env.set_sender(ALICE, 0)
    contract2.create_market("JUP", TARGET_DAY)
    gl_env.set_time(DAY_START_UTC - HOUR)
    gl_env.set_sender(ALICE, 3 * GEN)
    contract2.take_position(gl_env.u256(1), "UP")
    gl_env.set_sender(BOB, 4 * GEN)
    contract2.take_position(gl_env.u256(1), "DOWN")
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": body_cm_b,
        "gateio.ws": body_gt_b,
    }))
    contract2.resolve_market(gl_env.u256(1))
    ev_b = contract2.get_settlement_evidence(gl_env.u256(1))

    assert _normalized(ev_a) == _normalized(ev_b)


def test_validator_with_unavailable_source_raises_transient(gl_env, contract):
    mid = _prepare(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)

    def outage(url: str) -> str:
        raise RuntimeError("upstream 503")

    gl_env.set_nondet(outage)
    with pytest.raises(Exception) as exc:
        contract.resolve_market(gl_env.u256(mid))
    assert "TRANSIENT" in str(exc.value)


def test_validator_with_malformed_json_raises_external(gl_env, contract):
    mid = _prepare(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": "not-json",
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    with pytest.raises(Exception) as exc:
        contract.resolve_market(gl_env.u256(mid))
    assert "EXTERNAL" in str(exc.value)


def test_disagreement_finalizes_inconclusive_only_when_valid(gl_env, contract):
    mid = _prepare(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),  # UP
        "gateio.ws": full_gate(DAY_START_UTC, 1.3, 1.0),           # DOWN
    }))
    assert contract.resolve_market(gl_env.u256(mid)) == "INCONCLUSIVE"
    ev = contract.get_settlement_evidence(gl_env.u256(mid))
    assert ev["coinmarket_direction"] == "UP"
    assert ev["gate_direction"] == "DOWN"
    assert ev["final_result"] == "INCONCLUSIVE"
    assert ev["terminal_refund"] is False
