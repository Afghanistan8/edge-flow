"""Direct-VM tests for Edge-Flow."""

from __future__ import annotations

import json

import pytest

from tests.conftest import (
    DAY,
    HOUR,
    coinmarket_body,
    full_coinmarket,
    full_gate,
    gate_body,
    make_nondet,
)


# ---------------------------------------------------------------------------
# Time helpers for tests. Target GMT+1 date 2026-09-04.
# 2026-09-04 UTC midnight = 20700 days * 86400 = 1788480000.
# GMT+1 day starts one hour earlier: 1788480000 - 3600 = 1788476400.
# ---------------------------------------------------------------------------

TARGET_DAY = "2026-09-04"
DAY_START_UTC = 1788476400
CUTOFF = DAY_START_UTC
SETTLES_AT = DAY_START_UTC + DAY
REFUND_AT = SETTLES_AT + 5 * DAY

ALICE = "0x00000000000000000000000000000000000000a1"
BOB = "0x00000000000000000000000000000000000000b2"
CARL = "0x00000000000000000000000000000000000000c3"

GEN = 10**18


# =============================================================================
# metadata & construction
# =============================================================================

def test_supported_assets_are_only_the_four(gl_env, contract):
    assets = contract.get_supported_assets()
    assert [a["asset"] for a in assets] == ["JUP", "ZAMA", "ATOM", "ZRO"]


def test_supported_assets_include_pairs_and_slugs(gl_env, contract):
    by = {a["asset"]: a for a in contract.get_supported_assets()}
    assert by["JUP"]["gate_pair"] == "JUP_USDT"
    assert by["ZAMA"]["gate_pair"] == "ZAMA_USDT"
    assert by["ATOM"]["gate_pair"] == "ATOM_USDT"
    assert by["ZRO"]["gate_pair"] == "ZRO_USDT"
    for a in by.values():
        assert a["coinmarket_slug"]


def test_market_count_starts_at_zero(gl_env, contract):
    assert int(contract.market_count) == 0


# =============================================================================
# create_market
# =============================================================================

def _create(gl_env, contract, asset="JUP", day=TARGET_DAY, now=None):
    if now is None:
        now = DAY_START_UTC - DAY  # 1 day before cutoff
    gl_env.set_time(now)
    gl_env.set_sender(ALICE, 0)
    return int(contract.create_market(asset, day))


def test_create_market_returns_ids_sequentially(gl_env, contract):
    a = _create(gl_env, contract, "JUP", "2026-09-04")
    b = _create(gl_env, contract, "ZAMA", "2026-09-04")
    c = _create(gl_env, contract, "ATOM", "2026-09-04")
    assert (a, b, c) == (1, 2, 3)


def test_create_market_rejects_unsupported_asset(gl_env, contract):
    gl_env.set_time(DAY_START_UTC - DAY)
    gl_env.set_sender(ALICE, 0)
    with pytest.raises(Exception, match="unsupported asset"):
        contract.create_market("BTC", TARGET_DAY)


def test_create_market_rejects_bad_date_format(gl_env, contract):
    gl_env.set_time(DAY_START_UTC - DAY)
    gl_env.set_sender(ALICE, 0)
    with pytest.raises(Exception, match="invalid date"):
        contract.create_market("JUP", "20260904")


def test_create_market_rejects_past_day(gl_env, contract):
    gl_env.set_time(DAY_START_UTC + 10)  # target day already started
    gl_env.set_sender(ALICE, 0)
    with pytest.raises(Exception, match="already started"):
        contract.create_market("JUP", TARGET_DAY)


def test_create_market_rejects_far_future(gl_env, contract):
    gl_env.set_time(DAY_START_UTC - DAY)
    gl_env.set_sender(ALICE, 0)
    with pytest.raises(Exception, match="too far ahead"):
        contract.create_market("JUP", "2999-01-01")


def test_create_market_rejects_duplicate(gl_env, contract):
    _create(gl_env, contract, "JUP", TARGET_DAY)
    gl_env.set_time(DAY_START_UTC - DAY)
    with pytest.raises(Exception, match="duplicate market"):
        contract.create_market("JUP", TARGET_DAY)


def test_create_market_sets_gmt_plus_one_timestamps(gl_env, contract):
    mid = _create(gl_env, contract)
    m = contract.get_market(mid)
    assert m["cutoff_at"] == CUTOFF
    assert m["settles_at"] == SETTLES_AT
    assert m["terminal_refund_at"] == REFUND_AT


def test_get_market_by_asset_day_hits(gl_env, contract):
    mid = _create(gl_env, contract, "ATOM", TARGET_DAY)
    got = contract.get_market_by_asset_day("ATOM", TARGET_DAY)
    assert got["exists"] is True
    assert got["id"] == mid


def test_get_market_by_asset_day_misses(gl_env, contract):
    got = contract.get_market_by_asset_day("ZRO", TARGET_DAY)
    assert got == {"exists": False}


# =============================================================================
# take_position
# =============================================================================

def _bet(gl_env, contract, mid, wallet, side, amount, now=None):
    if now is None:
        now = DAY_START_UTC - HOUR
    gl_env.set_time(now)
    gl_env.set_sender(wallet, amount)
    contract.take_position(gl_env.u256(mid), side)


def test_take_position_min_stake_enforced(gl_env, contract):
    mid = _create(gl_env, contract)
    with pytest.raises(Exception, match="below minimum"):
        _bet(gl_env, contract, mid, ALICE, "UP", 1 * GEN)


def test_take_position_max_stake_enforced(gl_env, contract):
    mid = _create(gl_env, contract)
    with pytest.raises(Exception, match="above maximum"):
        _bet(gl_env, contract, mid, ALICE, "UP", 9 * GEN)


def test_take_position_side_switch_rejected(gl_env, contract):
    mid = _create(gl_env, contract)
    _bet(gl_env, contract, mid, ALICE, "UP", 2 * GEN)
    with pytest.raises(Exception, match="side switch"):
        _bet(gl_env, contract, mid, ALICE, "DOWN", 2 * GEN)


def test_take_position_topup_same_side_allowed(gl_env, contract):
    mid = _create(gl_env, contract)
    _bet(gl_env, contract, mid, ALICE, "UP", 2 * GEN)
    _bet(gl_env, contract, mid, ALICE, "UP", 3 * GEN)
    p = contract.get_position(gl_env.u256(mid), gl_env.Address(ALICE))
    assert p["stake"] == 5 * GEN


def test_take_position_topup_capped_at_max(gl_env, contract):
    mid = _create(gl_env, contract)
    _bet(gl_env, contract, mid, ALICE, "UP", 5 * GEN)
    with pytest.raises(Exception, match="above maximum"):
        _bet(gl_env, contract, mid, ALICE, "UP", 4 * GEN)


def test_take_position_invalid_side(gl_env, contract):
    mid = _create(gl_env, contract)
    with pytest.raises(Exception, match="invalid side"):
        _bet(gl_env, contract, mid, ALICE, "SIDEWAYS", 2 * GEN)


def test_take_position_rejected_after_cutoff(gl_env, contract):
    mid = _create(gl_env, contract)
    with pytest.raises(Exception, match="entries closed"):
        _bet(gl_env, contract, mid, ALICE, "UP", 2 * GEN, now=CUTOFF)


def test_pool_totals_track_stakes(gl_env, contract):
    mid = _create(gl_env, contract)
    _bet(gl_env, contract, mid, ALICE, "UP", 3 * GEN)
    _bet(gl_env, contract, mid, BOB, "DOWN", 4 * GEN)
    m = contract.get_market(gl_env.u256(mid))
    assert m["up_pool"] == 3 * GEN
    assert m["down_pool"] == 4 * GEN
    assert m["total_pool"] == 7 * GEN


def test_get_position_empty_shape(gl_env, contract):
    mid = _create(gl_env, contract)
    p = contract.get_position(gl_env.u256(mid), gl_env.Address(BOB))
    assert p["exists"] is False and p["stake"] == 0


# =============================================================================
# phases
# =============================================================================

def test_phase_open_before_cutoff(gl_env, contract):
    mid = _create(gl_env, contract)
    gl_env.set_time(DAY_START_UTC - HOUR)
    assert contract.get_market_state(gl_env.u256(mid)) == "OPEN"


def test_phase_candle_live_during_candle(gl_env, contract):
    mid = _create(gl_env, contract)
    gl_env.set_time(DAY_START_UTC + HOUR)
    assert contract.get_market_state(gl_env.u256(mid)) == "CANDLE_LIVE"


def test_phase_ready_to_settle_after_candle(gl_env, contract):
    mid = _create(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    assert contract.get_market_state(gl_env.u256(mid)) == "READY_TO_SETTLE"


def test_resolve_before_settleable_is_rejected(gl_env, contract):
    mid = _create(gl_env, contract)
    gl_env.set_time(SETTLES_AT - 1)
    gl_env.set_sender(CARL, 0)
    with pytest.raises(Exception, match="not yet settleable"):
        contract.resolve_market(gl_env.u256(mid))


# =============================================================================
# settlement (2-of-2)
# =============================================================================

def _open_market_with_stakes(gl_env, contract, up=5 * GEN, down=3 * GEN):
    mid = _create(gl_env, contract)
    if up:
        _bet(gl_env, contract, mid, ALICE, "UP", up)
    if down:
        _bet(gl_env, contract, mid, BOB, "DOWN", down)
    return mid


def test_settle_up_when_both_sources_up(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract, up=5 * GEN, down=3 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.00, 1.20),
        "gateio.ws": full_gate(DAY_START_UTC, 1.00, 1.30),
    }))
    result = contract.resolve_market(gl_env.u256(mid))
    assert result == "UP"
    m = contract.get_market(gl_env.u256(mid))
    assert m["state"] == "UP"
    assert m["result"] == "UP"
    assert m["refund_all"] is False


def test_settle_down_when_both_sources_down(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 2.00, 1.50),
        "gateio.ws": full_gate(DAY_START_UTC, 2.10, 1.55),
    }))
    result = contract.resolve_market(gl_env.u256(mid))
    assert result == "DOWN"


def test_settle_inconclusive_on_disagreement(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.00, 1.20),  # UP
        "gateio.ws": full_gate(DAY_START_UTC, 1.20, 1.00),           # DOWN
    }))
    result = contract.resolve_market(gl_env.u256(mid))
    assert result == "INCONCLUSIVE"
    m = contract.get_market(gl_env.u256(mid))
    assert m["state"] == "INCONCLUSIVE"
    assert m["refund_all"] is True


def test_flat_candle_is_down(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract, up=2 * GEN, down=2 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.00, 1.00),
        "gateio.ws": full_gate(DAY_START_UTC, 1.00, 1.00),
    }))
    assert contract.resolve_market(gl_env.u256(mid)) == "DOWN"


# --- unavailable / transient behavior ---------------------------------------

def test_incomplete_gate_window_stays_unresolved(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    # Truncated: only 20 candles (not 24) — misaligned last candle.
    partial = json.loads(full_gate(DAY_START_UTC, 1.0, 1.2))[:20]
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.1),
        "gateio.ws": json.dumps(partial),
    }))
    with pytest.raises(Exception, match="EXTERNAL"):
        contract.resolve_market(gl_env.u256(mid))
    m = contract.get_market(gl_env.u256(mid))
    assert m["state"] == "PENDING"


def test_incomplete_coinmarket_window_stays_unresolved(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    # Only samples very early in the window; last sample is more than 90m
    # before end.
    cm_partial = coinmarket_body(DAY_START_UTC, [
        (DAY_START_UTC, 1.0),
        (DAY_START_UTC + HOUR, 1.05),
    ])
    gl_env.set_nondet(make_nondet({
        "coingecko.com": cm_partial,
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.1),
    }))
    with pytest.raises(Exception, match="EXTERNAL"):
        contract.resolve_market(gl_env.u256(mid))


def test_transient_http_keeps_ready_to_settle(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)

    def handler(url):
        raise RuntimeError("boom")
    gl_env.set_nondet(handler)

    with pytest.raises(Exception, match="TRANSIENT"):
        contract.resolve_market(gl_env.u256(mid))
    assert contract.get_market_state(gl_env.u256(mid)) == "READY_TO_SETTLE"


def test_malformed_payload_is_external_and_retryable(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": "<html>error</html>",
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.1),
    }))
    with pytest.raises(Exception, match="EXTERNAL"):
        contract.resolve_market(gl_env.u256(mid))
    # Now serve valid data — resolves normally.
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    assert contract.resolve_market(gl_env.u256(mid)) == "UP"


def test_terminal_refund_only_at_deadline(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)

    def handler(url):
        raise RuntimeError("outage")

    # Just before deadline — must revert.
    gl_env.set_time(REFUND_AT - 1)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(handler)
    with pytest.raises(Exception, match="TRANSIENT"):
        contract.resolve_market(gl_env.u256(mid))

    # At deadline — terminal refund path finalizes without fake evidence.
    gl_env.set_time(REFUND_AT)
    contract.resolve_market(gl_env.u256(mid))
    m = contract.get_market(gl_env.u256(mid))
    assert m["state"] == "REFUNDED"
    assert m["refund_all"] is True
    ev = contract.get_settlement_evidence(gl_env.u256(mid))
    assert ev["terminal_refund"] is True
    assert ev["coinmarket_direction"] == ""
    assert ev["gate_direction"] == ""


def test_valid_evidence_after_deadline_still_settles_normally(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(REFUND_AT + 3600)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    assert contract.resolve_market(gl_env.u256(mid)) == "UP"


# --- window selection when extra rows exist ---------------------------------

def test_gate_window_picks_only_target_candles(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    # Include out-of-window candles that must be ignored.
    rows = json.loads(full_gate(DAY_START_UTC, 1.0, 1.2))
    extra_before = [str(DAY_START_UTC - HOUR), "1", "5.0", "5.0", "5.0", "5.0", "1"]
    extra_after = [str(DAY_START_UTC + DAY), "1", "9.0", "9.0", "9.0", "9.0", "1"]
    rows_extended = [extra_before] + rows + [extra_after]
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": json.dumps(rows_extended),
    }))
    assert contract.resolve_market(gl_env.u256(mid)) == "UP"


def test_gate_duplicate_candle_is_rejected(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    rows = json.loads(full_gate(DAY_START_UTC, 1.0, 1.2))
    rows.append(rows[5])  # duplicate a mid-window ts
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": json.dumps(rows),
    }))
    with pytest.raises(Exception, match="EXTERNAL"):
        contract.resolve_market(gl_env.u256(mid))


# =============================================================================
# payouts
# =============================================================================

def test_up_result_pays_up_pro_rata(gl_env, contract):
    # up_pool=5, down_pool=3, total=8. Alice UP=5 → payout 5*8/5 = 8.
    mid = _open_market_with_stakes(gl_env, contract, up=5 * GEN, down=3 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    contract.resolve_market(gl_env.u256(mid))
    gl_env.set_sender(ALICE, 0)
    out = int(contract.claim(gl_env.u256(mid)))
    assert out == 8 * GEN
    assert gl_env.ledger[ALICE.lower()] == 8 * GEN


def test_loser_gets_zero(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_sender(CARL, 0)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    contract.resolve_market(gl_env.u256(mid))
    gl_env.set_sender(BOB, 0)
    with pytest.raises(Exception, match="nothing to claim"):
        contract.claim(gl_env.u256(mid))


def test_down_result_pays_down_pro_rata(gl_env, contract):
    # Two down bettors split against one up bettor.
    mid = _create(gl_env, contract)
    _bet(gl_env, contract, mid, ALICE, "UP", 4 * GEN)
    _bet(gl_env, contract, mid, BOB, "DOWN", 2 * GEN)
    _bet(gl_env, contract, mid, CARL, "DOWN", 2 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 2.0, 1.5),
        "gateio.ws": full_gate(DAY_START_UTC, 2.0, 1.4),
    }))
    contract.resolve_market(gl_env.u256(mid))
    gl_env.set_sender(BOB, 0)
    out_b = int(contract.claim(gl_env.u256(mid)))
    gl_env.set_sender(CARL, 0)
    out_c = int(contract.claim(gl_env.u256(mid)))
    # total=8, down_pool=4. Each 2 GEN down stake gets 2*8/4 = 4 GEN.
    assert out_b == 4 * GEN
    assert out_c == 4 * GEN


def test_inconclusive_refunds_stake(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract, up=3 * GEN, down=5 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.2, 1.0),
    }))
    contract.resolve_market(gl_env.u256(mid))
    gl_env.set_sender(ALICE, 0)
    assert int(contract.claim(gl_env.u256(mid))) == 3 * GEN
    gl_env.set_sender(BOB, 0)
    assert int(contract.claim(gl_env.u256(mid))) == 5 * GEN


def test_zero_winning_stake_refunds(gl_env, contract):
    # Only DOWN stakes exist but result is UP → refund_all.
    mid = _create(gl_env, contract)
    _bet(gl_env, contract, mid, ALICE, "DOWN", 3 * GEN)
    _bet(gl_env, contract, mid, BOB, "DOWN", 2 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    contract.resolve_market(gl_env.u256(mid))
    m = contract.get_market(gl_env.u256(mid))
    assert m["refund_all"] is True
    gl_env.set_sender(ALICE, 0)
    assert int(contract.claim(gl_env.u256(mid))) == 3 * GEN


def test_claim_once_only(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract, up=5 * GEN, down=3 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    contract.resolve_market(gl_env.u256(mid))
    gl_env.set_sender(ALICE, 0)
    contract.claim(gl_env.u256(mid))
    with pytest.raises(Exception, match="already claimed"):
        contract.claim(gl_env.u256(mid))


def test_cannot_claim_before_resolve(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 10)
    gl_env.set_sender(ALICE, 0)
    with pytest.raises(Exception, match="not resolved"):
        contract.claim(gl_env.u256(mid))


def test_resolve_twice_rejected(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    contract.resolve_market(gl_env.u256(mid))
    with pytest.raises(Exception, match="already resolved"):
        contract.resolve_market(gl_env.u256(mid))


def test_payout_never_exceeds_pool(gl_env, contract):
    # After all claims paid_out <= total_pool.
    mid = _open_market_with_stakes(gl_env, contract, up=5 * GEN, down=3 * GEN)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    contract.resolve_market(gl_env.u256(mid))
    gl_env.set_sender(ALICE, 0)
    contract.claim(gl_env.u256(mid))
    m = contract.get_market(gl_env.u256(mid))
    assert m["paid_out"] <= m["total_pool"]


# =============================================================================
# pagination
# =============================================================================

def test_get_markets_pagination(gl_env, contract):
    # All dates must be strictly after `now`, in valid future GMT+1 days.
    gl_env.set_time(DAY_START_UTC - DAY)
    gl_env.set_sender(ALICE, 0)
    for i in range(4, 14):
        day = f"2026-09-{i:02d}"
        contract.create_market("JUP", day)
    page = contract.get_markets(gl_env.u256(0), gl_env.u256(5))
    assert len(page) == 5
    page2 = contract.get_markets(gl_env.u256(5), gl_env.u256(5))
    assert len(page2) == 5
    # Newest first.
    assert page[0]["id"] > page[-1]["id"]


def test_get_open_markets_filters(gl_env, contract):
    mid = _create(gl_env, contract)
    # Not open yet? It's open now (before cutoff).
    gl_env.set_time(DAY_START_UTC - HOUR)
    open_list = contract.get_open_markets(gl_env.u256(0), gl_env.u256(10))
    assert any(m["id"] == mid for m in open_list)
    # After cutoff → filtered out.
    gl_env.set_time(SETTLES_AT + 10)
    open_list2 = contract.get_open_markets(gl_env.u256(0), gl_env.u256(10))
    assert all(m["id"] != mid for m in open_list2)


def test_get_user_markets_tracks_participation(gl_env, contract):
    mid1 = _create(gl_env, contract, "JUP", "2026-09-04")
    mid2 = _create(gl_env, contract, "ATOM", "2026-09-05")
    _bet(gl_env, contract, mid1, ALICE, "UP", 2 * GEN)
    _bet(gl_env, contract, mid2, ALICE, "DOWN", 3 * GEN)
    got = contract.get_user_markets(
        gl_env.Address(ALICE), gl_env.u256(0), gl_env.u256(50)
    )
    assert {m["id"] for m in got} == {mid1, mid2}


def test_get_user_markets_empty(gl_env, contract):
    got = contract.get_user_markets(
        gl_env.Address(BOB), gl_env.u256(0), gl_env.u256(50)
    )
    assert got == []


# =============================================================================
# evidence view
# =============================================================================

def test_settlement_evidence_binds_normalized_fields(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    gl_env.set_time(SETTLES_AT + 60)
    gl_env.set_nondet(make_nondet({
        "coingecko.com": full_coinmarket(DAY_START_UTC, 1.0, 1.2),
        "gateio.ws": full_gate(DAY_START_UTC, 1.0, 1.3),
    }))
    contract.resolve_market(gl_env.u256(mid))
    ev = contract.get_settlement_evidence(gl_env.u256(mid))
    assert ev["exists"] is True
    assert ev["coinmarket_direction"] == "UP"
    assert ev["gate_direction"] == "UP"
    assert ev["final_result"] == "UP"
    assert ev["price_scale"] == 10**8


def test_settlement_evidence_missing_before_resolve(gl_env, contract):
    mid = _open_market_with_stakes(gl_env, contract)
    ev = contract.get_settlement_evidence(gl_env.u256(mid))
    assert ev == {"exists": False}
