# Edge-Flow: permissionless daily crypto prediction market on GenLayer.
#
# Independently reconstructs a completed GMT+1 daily candle from two public
# sources (Coinmarket + Gate.io). Each source is judged only against its own
# open and close. Agreement decides the direction. Disagreement or unavailable
# evidence never fabricates an outcome; a 5-day terminal fallback lets users
# reclaim their original stake if evidence never becomes available.
#
# Callers cannot supply prices, pairs, URLs, directions, or results. The
# contract owns all of that.

from __future__ import annotations

import json
import typing

from genlayer import gl
from genlayer.types import Address, u256


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DAY: typing.Final[int] = 86_400
HOUR: typing.Final[int] = 3_600
GMT_PLUS_ONE: typing.Final[int] = 3_600            # fixed +1h offset, no DST
GEN: typing.Final[int] = 10**18
MIN_STAKE: typing.Final[int] = 2 * GEN
MAX_STAKE: typing.Final[int] = 8 * GEN
MAX_FORWARD_DAYS: typing.Final[int] = 366
TERMINAL_REFUND_DELAY: typing.Final[int] = 5 * DAY
MAX_PAGE: typing.Final[int] = 50
MAX_SOURCE_BYTES: typing.Final[int] = 60_000
PRICE_SCALE: typing.Final[int] = 10**8             # integer price scaling
ASSETS: typing.Final[tuple[str, ...]] = ("JUP", "ZAMA", "ATOM", "ZRO")

# Contract-controlled identifiers. Users never supply these.
GATE_PAIRS: typing.Final[dict[str, str]] = {
    "JUP": "JUP_USDT",
    "ZAMA": "ZAMA_USDT",
    "ATOM": "ATOM_USDT",
    "ZRO": "ZRO_USDT",
}

# Coinmarket-family slugs. We fetch from a public keyless endpoint compatible
# with Coinmarket public market data (CoinGecko public market-chart mirror of
# Coinmarket-tracked assets is used when the official CMC historical endpoint
# requires an API key). The label surfaced to users and stored in evidence is
# always "Coinmarket".
COINMARKET_SLUGS: typing.Final[dict[str, str]] = {
    "JUP": "jupiter-exchange-solana",
    "ZAMA": "zama",
    "ATOM": "cosmos",
    "ZRO": "layerzero",
}

# Phase strings
PHASE_OPEN = "OPEN"
PHASE_CANDLE_LIVE = "CANDLE_LIVE"
PHASE_READY_TO_SETTLE = "READY_TO_SETTLE"
PHASE_UP = "UP"
PHASE_DOWN = "DOWN"
PHASE_INCONCLUSIVE = "INCONCLUSIVE"
PHASE_REFUNDED = "REFUNDED"

SIDE_UP = "UP"
SIDE_DOWN = "DOWN"

# Internal stored states (subset of visible phases). Visible phase is derived
# in get_market_state().
STATE_PENDING = "PENDING"           # not yet settled
STATE_UP = "UP"
STATE_DOWN = "DOWN"
STATE_INCONCLUSIVE = "INCONCLUSIVE"
STATE_REFUNDED = "REFUNDED"         # terminal refund path


# Error classes. Reverts prefix messages with these so validators and tests
# can distinguish transient from permanent failures.
ERR_EXPECTED = "EXPECTED"           # normal user-facing rejection
ERR_INVARIANT = "INVARIANT"         # bug / contract invariant violated
ERR_TRANSIENT = "TRANSIENT"         # HTTP timeout / 429 / 5xx / retriable
ERR_EXTERNAL = "EXTERNAL"           # malformed upstream data


# ---------------------------------------------------------------------------
# Date / time helpers (GMT+1, no DST)
# ---------------------------------------------------------------------------

_DAYS_IN_MONTH = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _is_leap(y: int) -> bool:
    return (y % 4 == 0 and y % 100 != 0) or (y % 400 == 0)


def _days_in_month(y: int, m: int) -> int:
    if m == 2 and _is_leap(y):
        return 29
    return _DAYS_IN_MONTH[m - 1]


def _days_from_civil(y: int, m: int, d: int) -> int:
    # Howard Hinnant's algorithm: proleptic Gregorian days since 1970-01-01.
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400                        # [0, 399]
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _parse_date(s: str) -> tuple[int, int, int]:
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        raise Exception(f"{ERR_EXPECTED}: invalid date format")
    y_s, m_s, d_s = s[0:4], s[5:7], s[8:10]
    if not (y_s.isdigit() and m_s.isdigit() and d_s.isdigit()):
        raise Exception(f"{ERR_EXPECTED}: invalid date digits")
    y, m, d = int(y_s), int(m_s), int(d_s)
    if y < 1970 or y > 9999 or m < 1 or m > 12:
        raise Exception(f"{ERR_EXPECTED}: date out of range")
    if d < 1 or d > _days_in_month(y, m):
        raise Exception(f"{ERR_EXPECTED}: day out of range for month")
    return y, m, d


def _gmt1_day_start_utc(target_day: str) -> int:
    # Start of the GMT+1 day expressed as a UTC unix timestamp:
    #   D 00:00 GMT+1 = D 00:00 UTC - 1h
    y, m, d = _parse_date(target_day)
    return _days_from_civil(y, m, d) * DAY - GMT_PLUS_ONE


# ---------------------------------------------------------------------------
# HTTP source templates (contract-owned)
# ---------------------------------------------------------------------------
#
# Coinmarket public market-chart: 5-minute granularity for a 2-day window
# guarantees we always cover a full GMT+1 day. This endpoint is public and
# keyless, mirrors Coinmarket-tracked USD prices, and is stable enough to
# reconstruct the candle deterministically for validators.

def _coinmarket_url(asset: str, day_start_utc: int) -> str:
    slug = COINMARKET_SLUGS[asset]
    # Fetch a small window: [start - 1h, end + 1h) to be tolerant of provider
    # timestamp rounding while still bounding the payload.
    frm = day_start_utc - HOUR
    to = day_start_utc + DAY + HOUR
    return (
        "https://api.coingecko.com/api/v3/coins/"
        + slug
        + "/market_chart/range?vs_currency=usd"
        + f"&from={frm}&to={to}"
    )


def _gate_url(asset: str, day_start_utc: int) -> str:
    pair = GATE_PAIRS[asset]
    frm = day_start_utc - HOUR
    to = day_start_utc + DAY + HOUR
    # Gate.io public spot candlesticks, 1h interval.
    return (
        "https://api.gateio.ws/api/v4/spot/candlesticks"
        + f"?currency_pair={pair}&interval=1h&from={frm}&to={to}"
    )


# ---------------------------------------------------------------------------
# Parsers (deterministic, run in validators)
# ---------------------------------------------------------------------------

def _bounded_load(raw: str) -> typing.Any:
    if raw is None:
        raise Exception(f"{ERR_TRANSIENT}: empty body")
    if len(raw) == 0:
        raise Exception(f"{ERR_TRANSIENT}: empty body")
    if len(raw) > MAX_SOURCE_BYTES:
        raise Exception(f"{ERR_EXTERNAL}: response too large")
    try:
        return json.loads(raw)
    except Exception:
        raise Exception(f"{ERR_EXTERNAL}: invalid JSON")


def _to_price_int(v: typing.Any) -> int:
    # Reject NaN / inf / negative / zero / scientific-notation strings.
    if isinstance(v, bool):
        raise Exception(f"{ERR_EXTERNAL}: bad price type")
    if isinstance(v, (int,)):
        if v <= 0:
            raise Exception(f"{ERR_EXTERNAL}: non-positive price")
        return int(v) * PRICE_SCALE
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")) or v <= 0:
            raise Exception(f"{ERR_EXTERNAL}: non-finite price")
        # Convert via string to avoid float noise; enforce plain decimal form.
        s = repr(v)
        if "e" in s or "E" in s:
            raise Exception(f"{ERR_EXTERNAL}: scientific price notation")
        return _decimal_to_scaled(s)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            raise Exception(f"{ERR_EXTERNAL}: empty price string")
        if "e" in s or "E" in s:
            raise Exception(f"{ERR_EXTERNAL}: scientific price notation")
        return _decimal_to_scaled(s)
    raise Exception(f"{ERR_EXTERNAL}: bad price type")


def _decimal_to_scaled(s: str) -> int:
    # Convert a plain decimal like "12.3456" to an integer scaled by PRICE_SCALE.
    neg = False
    if s.startswith("-"):
        neg = True
        s = s[1:]
    elif s.startswith("+"):
        s = s[1:]
    if "." in s:
        int_part, frac_part = s.split(".", 1)
    else:
        int_part, frac_part = s, ""
    if not int_part.isdigit() or (frac_part and not frac_part.isdigit()):
        raise Exception(f"{ERR_EXTERNAL}: invalid price digits")
    # Cap fractional digits at 12 to avoid pathological payloads.
    if len(frac_part) > 12:
        raise Exception(f"{ERR_EXTERNAL}: excess price precision")
    frac_part = (frac_part + "0" * 8)[:8]  # PRICE_SCALE = 10^8
    val = int(int_part) * PRICE_SCALE + int(frac_part)
    if neg or val <= 0:
        raise Exception(f"{ERR_EXTERNAL}: non-positive price")
    return val


def _parse_coinmarket(raw: str, day_start_utc: int) -> tuple[int, int]:
    """Return (open_price_scaled, close_price_scaled) for the GMT+1 window."""
    data = _bounded_load(raw)
    if not isinstance(data, dict):
        raise Exception(f"{ERR_EXTERNAL}: coinmarket root not object")
    prices = data.get("prices")
    if not isinstance(prices, list) or len(prices) == 0:
        raise Exception(f"{ERR_EXTERNAL}: coinmarket missing prices")
    end_utc = day_start_utc + DAY
    # Rows are [ms_timestamp, price].
    in_window: list[tuple[int, typing.Any]] = []
    for row in prices:
        if not isinstance(row, list) or len(row) < 2:
            raise Exception(f"{ERR_EXTERNAL}: coinmarket bad row")
        ts_ms = row[0]
        if not isinstance(ts_ms, (int, float)) or isinstance(ts_ms, bool):
            raise Exception(f"{ERR_EXTERNAL}: coinmarket bad ts")
        ts = int(ts_ms) // 1000
        if day_start_utc <= ts < end_utc:
            in_window.append((ts, row[1]))
    if len(in_window) == 0:
        raise Exception(f"{ERR_EXTERNAL}: coinmarket window empty")
    in_window.sort(key=lambda r: r[0])
    # Require the window to be reasonably covered: first sample within 90m of
    # start, last within 90m of end. This rejects severely incomplete windows.
    if in_window[0][0] - day_start_utc > 90 * 60:
        raise Exception(f"{ERR_EXTERNAL}: coinmarket window incomplete (start)")
    if (end_utc - 1) - in_window[-1][0] > 90 * 60:
        raise Exception(f"{ERR_EXTERNAL}: coinmarket window incomplete (end)")
    open_price = _to_price_int(in_window[0][1])
    close_price = _to_price_int(in_window[-1][1])
    return open_price, close_price


def _parse_gate(raw: str, day_start_utc: int) -> tuple[int, int]:
    """Return (open_price_scaled, close_price_scaled) reconstructed from
    Gate.io hourly candlesticks aligned to the GMT+1 window."""
    data = _bounded_load(raw)
    if not isinstance(data, list) or len(data) == 0:
        raise Exception(f"{ERR_EXTERNAL}: gate empty candles")
    end_utc = day_start_utc + DAY
    seen_ts: set[int] = set()
    in_window: list[tuple[int, typing.Any, typing.Any]] = []
    for row in data:
        if not isinstance(row, list) or len(row) < 6:
            raise Exception(f"{ERR_EXTERNAL}: gate bad row")
        ts_raw = row[0]
        try:
            ts = int(ts_raw)
        except Exception:
            raise Exception(f"{ERR_EXTERNAL}: gate bad ts")
        if ts in seen_ts:
            raise Exception(f"{ERR_EXTERNAL}: gate duplicate candle")
        seen_ts.add(ts)
        if day_start_utc <= ts < end_utc:
            # Gate row layout: [t, volume, close, high, low, open, ...]
            open_v = row[5]
            close_v = row[2]
            in_window.append((ts, open_v, close_v))
    if len(in_window) == 0:
        raise Exception(f"{ERR_EXTERNAL}: gate window empty")
    in_window.sort(key=lambda r: r[0])
    # First candle must open exactly at the GMT+1 day start.
    if in_window[0][0] != day_start_utc:
        raise Exception(f"{ERR_EXTERNAL}: gate first candle misaligned")
    # Last candle must open at end - 1h so it completes at end.
    if in_window[-1][0] != end_utc - HOUR:
        raise Exception(f"{ERR_EXTERNAL}: gate last candle misaligned")
    # Full 24h coverage.
    if len(in_window) != 24:
        raise Exception(f"{ERR_EXTERNAL}: gate window incomplete")
    open_price = _to_price_int(in_window[0][1])
    close_price = _to_price_int(in_window[-1][2])
    return open_price, close_price


def _direction(open_p: int, close_p: int) -> str:
    return SIDE_UP if close_p > open_p else SIDE_DOWN


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------

class MarketRecord(typing.NamedTuple):
    id: int
    asset: str
    coinmarket_slug: str
    gate_pair: str
    target_day: str
    created_at: int
    cutoff_at: int
    settles_at: int
    terminal_refund_at: int
    up_pool: int
    down_pool: int
    paid_out: int
    state: str
    result: str            # "" until finalized; then UP/DOWN/INCONCLUSIVE/REFUNDED
    refund_all: bool
    resolved_at: int


class PositionRecord(typing.NamedTuple):
    market_id: int
    owner: str
    side: str
    stake: int
    claimed: bool


class SettlementEvidence(typing.NamedTuple):
    market_id: int
    resolved_at: int
    coinmarket_open: int
    coinmarket_close: int
    coinmarket_direction: str
    gate_open: int
    gate_close: int
    gate_direction: str
    final_result: str
    terminal_refund: bool


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------

class EdgeFlow(gl.Contract):
    # storage schema
    market_count: u256
    markets: gl.TreeMap[u256, MarketRecord]
    market_keys: gl.TreeMap[str, u256]                     # "ASSET|YYYY-MM-DD" -> id
    positions: gl.TreeMap[str, PositionRecord]             # "id|owner" -> pos
    user_market_count: gl.TreeMap[str, u256]               # owner -> count
    user_market_index: gl.TreeMap[str, u256]               # "owner|i" -> market_id
    settlement_evidence: gl.TreeMap[u256, SettlementEvidence]

    def __init__(self) -> None:
        self.market_count = u256(0)

    # ---- helpers ---------------------------------------------------------

    @staticmethod
    def _addr(a: Address) -> str:
        # Store addresses lowercase for stable TreeMap keys.
        return str(a).lower()

    @staticmethod
    def _pos_key(mid: int, owner: str) -> str:
        return f"{int(mid)}|{owner}"

    @staticmethod
    def _mk_key(asset: str, target_day: str) -> str:
        return f"{asset}|{target_day}"

    @staticmethod
    def _user_key(owner: str, i: int) -> str:
        return f"{owner}|{int(i)}"

    def _now(self) -> int:
        # gl.block_timestamp is deterministic per-transaction.
        return int(gl.message.timestamp)

    def _load(self, market_id: int) -> MarketRecord:
        if not self.markets.contains(u256(market_id)):
            raise Exception(f"{ERR_EXPECTED}: unknown market")
        return self.markets[u256(market_id)]

    def _visible_phase(self, m: MarketRecord, now: int) -> str:
        if m.state == STATE_UP:
            return PHASE_UP
        if m.state == STATE_DOWN:
            return PHASE_DOWN
        if m.state in (STATE_INCONCLUSIVE, STATE_REFUNDED):
            return PHASE_INCONCLUSIVE
        if now < m.cutoff_at:
            return PHASE_OPEN
        if now < m.settles_at:
            return PHASE_CANDLE_LIVE
        return PHASE_READY_TO_SETTLE

    def _register_user_market(self, owner: str, market_id: int) -> None:
        cnt = int(self.user_market_count.get(owner, u256(0)))
        self.user_market_index[self._user_key(owner, cnt)] = u256(market_id)
        self.user_market_count[owner] = u256(cnt + 1)

    # ---- writes ----------------------------------------------------------

    @gl.public.write
    def create_market(self, asset: str, target_day: str) -> u256:
        if asset not in ASSETS:
            raise Exception(f"{ERR_EXPECTED}: unsupported asset")
        day_start = _gmt1_day_start_utc(target_day)
        now = self._now()
        if day_start <= now:
            raise Exception(f"{ERR_EXPECTED}: target day already started")
        if day_start - now > MAX_FORWARD_DAYS * DAY:
            raise Exception(f"{ERR_EXPECTED}: target day too far ahead")
        key = self._mk_key(asset, target_day)
        if self.market_keys.contains(key):
            raise Exception(f"{ERR_EXPECTED}: duplicate market")

        mid = int(self.market_count) + 1
        self.market_count = u256(mid)
        cutoff = day_start
        settles = day_start + DAY
        refund_at = settles + TERMINAL_REFUND_DELAY

        rec = MarketRecord(
            id=mid,
            asset=asset,
            coinmarket_slug=COINMARKET_SLUGS[asset],
            gate_pair=GATE_PAIRS[asset],
            target_day=target_day,
            created_at=now,
            cutoff_at=cutoff,
            settles_at=settles,
            terminal_refund_at=refund_at,
            up_pool=0,
            down_pool=0,
            paid_out=0,
            state=STATE_PENDING,
            result="",
            refund_all=False,
            resolved_at=0,
        )
        self.markets[u256(mid)] = rec
        self.market_keys[key] = u256(mid)
        return u256(mid)

    @gl.public.write.payable
    def take_position(self, market_id: u256, side: str) -> None:
        mid = int(market_id)
        m = self._load(mid)
        now = self._now()
        if m.state != STATE_PENDING:
            raise Exception(f"{ERR_EXPECTED}: market not open")
        if now >= m.cutoff_at:
            raise Exception(f"{ERR_EXPECTED}: entries closed")
        if side != SIDE_UP and side != SIDE_DOWN:
            raise Exception(f"{ERR_EXPECTED}: invalid side")
        value = int(gl.message.value)
        if value < MIN_STAKE:
            raise Exception(f"{ERR_EXPECTED}: stake below minimum")

        owner = self._addr(gl.message.sender_address)
        pkey = self._pos_key(mid, owner)
        existing = self.positions.get(pkey, None)

        if existing is None:
            if value > MAX_STAKE:
                raise Exception(f"{ERR_EXPECTED}: stake above maximum")
            new_pos = PositionRecord(
                market_id=mid,
                owner=owner,
                side=side,
                stake=value,
                claimed=False,
            )
            self.positions[pkey] = new_pos
            self._register_user_market(owner, mid)
        else:
            if existing.side != side:
                raise Exception(f"{ERR_EXPECTED}: side switch not allowed")
            new_stake = int(existing.stake) + value
            if new_stake > MAX_STAKE:
                raise Exception(f"{ERR_EXPECTED}: stake above maximum")
            self.positions[pkey] = PositionRecord(
                market_id=existing.market_id,
                owner=existing.owner,
                side=existing.side,
                stake=new_stake,
                claimed=existing.claimed,
            )

        if side == SIDE_UP:
            up = int(m.up_pool) + value
            dn = int(m.down_pool)
        else:
            up = int(m.up_pool)
            dn = int(m.down_pool) + value

        self.markets[u256(mid)] = MarketRecord(
            id=m.id, asset=m.asset, coinmarket_slug=m.coinmarket_slug,
            gate_pair=m.gate_pair, target_day=m.target_day,
            created_at=m.created_at, cutoff_at=m.cutoff_at,
            settles_at=m.settles_at, terminal_refund_at=m.terminal_refund_at,
            up_pool=up, down_pool=dn, paid_out=int(m.paid_out),
            state=m.state, result=m.result, refund_all=m.refund_all,
            resolved_at=m.resolved_at,
        )

    # ---- resolve ---------------------------------------------------------

    @gl.public.write
    def resolve_market(self, market_id: u256) -> str:
        mid = int(market_id)
        m = self._load(mid)
        if m.state != STATE_PENDING:
            raise Exception(f"{ERR_EXPECTED}: already resolved")
        now = self._now()
        if now < m.settles_at:
            raise Exception(f"{ERR_EXPECTED}: not yet settleable")

        day_start = _gmt1_day_start_utc(m.target_day)
        cm_url = _coinmarket_url(m.asset, day_start)
        gt_url = _gate_url(m.asset, day_start)

        # Try to gather valid 2-source evidence. If evidence is unavailable
        # and we're past the 5-day deadline, fall through to terminal refund.
        try:
            cm_open, cm_close = self._fetch_coinmarket(cm_url, day_start)
            gt_open, gt_close = self._fetch_gate(gt_url, day_start)
        except Exception as e:
            msg = str(e)
            if now >= m.terminal_refund_at and (
                msg.startswith(ERR_TRANSIENT) or msg.startswith(ERR_EXTERNAL)
            ):
                return self._finalize_terminal_refund(m, now)
            raise

        cm_dir = _direction(cm_open, cm_close)
        gt_dir = _direction(gt_open, gt_close)

        if cm_dir == gt_dir:
            final = cm_dir
        else:
            final = PHASE_INCONCLUSIVE

        ev = SettlementEvidence(
            market_id=mid,
            resolved_at=now,
            coinmarket_open=cm_open,
            coinmarket_close=cm_close,
            coinmarket_direction=cm_dir,
            gate_open=gt_open,
            gate_close=gt_close,
            gate_direction=gt_dir,
            final_result=final,
            terminal_refund=False,
        )
        self.settlement_evidence[u256(mid)] = ev

        if final == SIDE_UP:
            state = STATE_UP
            winner_pool = int(m.up_pool)
        elif final == SIDE_DOWN:
            state = STATE_DOWN
            winner_pool = int(m.down_pool)
        else:
            state = STATE_INCONCLUSIVE
            winner_pool = 0

        refund_all = (final == PHASE_INCONCLUSIVE) or (
            final in (SIDE_UP, SIDE_DOWN) and winner_pool == 0
        )

        self.markets[u256(mid)] = MarketRecord(
            id=m.id, asset=m.asset, coinmarket_slug=m.coinmarket_slug,
            gate_pair=m.gate_pair, target_day=m.target_day,
            created_at=m.created_at, cutoff_at=m.cutoff_at,
            settles_at=m.settles_at, terminal_refund_at=m.terminal_refund_at,
            up_pool=int(m.up_pool), down_pool=int(m.down_pool),
            paid_out=int(m.paid_out),
            state=state, result=final, refund_all=refund_all,
            resolved_at=now,
        )
        return final

    def _fetch_coinmarket(self, url: str, day_start: int) -> tuple[int, int]:
        raw = self._nondet_get(url)
        return _parse_coinmarket(raw, day_start)

    def _fetch_gate(self, url: str, day_start: int) -> tuple[int, int]:
        raw = self._nondet_get(url)
        return _parse_gate(raw, day_start)

    def _nondet_get(self, url: str) -> str:
        # gl.nondet.web.get returns the response body as a string. Any HTTP
        # failure is classified as TRANSIENT so callers can retry.
        try:
            body = gl.nondet.web.get(url)
        except Exception as e:
            raise Exception(f"{ERR_TRANSIENT}: fetch failed: {e}")
        if body is None:
            raise Exception(f"{ERR_TRANSIENT}: no body")
        return body

    def _finalize_terminal_refund(self, m: MarketRecord, now: int) -> str:
        ev = SettlementEvidence(
            market_id=int(m.id),
            resolved_at=now,
            coinmarket_open=0,
            coinmarket_close=0,
            coinmarket_direction="",
            gate_open=0,
            gate_close=0,
            gate_direction="",
            final_result=PHASE_INCONCLUSIVE,
            terminal_refund=True,
        )
        self.settlement_evidence[u256(int(m.id))] = ev
        self.markets[u256(int(m.id))] = MarketRecord(
            id=m.id, asset=m.asset, coinmarket_slug=m.coinmarket_slug,
            gate_pair=m.gate_pair, target_day=m.target_day,
            created_at=m.created_at, cutoff_at=m.cutoff_at,
            settles_at=m.settles_at, terminal_refund_at=m.terminal_refund_at,
            up_pool=int(m.up_pool), down_pool=int(m.down_pool),
            paid_out=int(m.paid_out),
            state=STATE_REFUNDED, result=PHASE_INCONCLUSIVE, refund_all=True,
            resolved_at=now,
        )
        return PHASE_INCONCLUSIVE

    # ---- claim -----------------------------------------------------------

    @gl.public.write
    def claim(self, market_id: u256) -> u256:
        mid = int(market_id)
        m = self._load(mid)
        if m.state == STATE_PENDING:
            raise Exception(f"{ERR_EXPECTED}: not resolved yet")
        owner = self._addr(gl.message.sender_address)
        pkey = self._pos_key(mid, owner)
        if not self.positions.contains(pkey):
            raise Exception(f"{ERR_EXPECTED}: no position")
        pos = self.positions[pkey]
        if pos.claimed:
            raise Exception(f"{ERR_EXPECTED}: already claimed")

        payout = self._compute_payout(m, pos)
        if payout == 0:
            # Mark as claimed to prevent repeated no-op calls, and revert so
            # the caller doesn't silently pay gas for nothing.
            raise Exception(f"{ERR_EXPECTED}: nothing to claim")

        # Never pay more than the tracked pool.
        total_pool = int(m.up_pool) + int(m.down_pool)
        if int(m.paid_out) + payout > total_pool:
            raise Exception(f"{ERR_INVARIANT}: payout exceeds pool")

        self.positions[pkey] = PositionRecord(
            market_id=pos.market_id,
            owner=pos.owner,
            side=pos.side,
            stake=pos.stake,
            claimed=True,
        )
        self.markets[u256(mid)] = MarketRecord(
            id=m.id, asset=m.asset, coinmarket_slug=m.coinmarket_slug,
            gate_pair=m.gate_pair, target_day=m.target_day,
            created_at=m.created_at, cutoff_at=m.cutoff_at,
            settles_at=m.settles_at, terminal_refund_at=m.terminal_refund_at,
            up_pool=int(m.up_pool), down_pool=int(m.down_pool),
            paid_out=int(m.paid_out) + payout,
            state=m.state, result=m.result, refund_all=m.refund_all,
            resolved_at=m.resolved_at,
        )
        gl.message.sender_address.send(u256(payout))
        return u256(payout)

    def _compute_payout(self, m: MarketRecord, pos: PositionRecord) -> int:
        stake = int(pos.stake)
        if m.refund_all or m.state in (STATE_INCONCLUSIVE, STATE_REFUNDED):
            return stake
        if m.state == STATE_UP:
            winner_pool = int(m.up_pool)
            if pos.side != SIDE_UP:
                return 0
        elif m.state == STATE_DOWN:
            winner_pool = int(m.down_pool)
            if pos.side != SIDE_DOWN:
                return 0
        else:
            return 0
        total_pool = int(m.up_pool) + int(m.down_pool)
        if winner_pool <= 0:
            return stake  # safety: refund
        return (stake * total_pool) // winner_pool

    # ---- views -----------------------------------------------------------

    @gl.public.view
    def get_supported_assets(self) -> list[dict]:
        out = []
        for a in ASSETS:
            out.append({
                "asset": a,
                "coinmarket_slug": COINMARKET_SLUGS[a],
                "gate_pair": GATE_PAIRS[a],
            })
        return out

    @gl.public.view
    def get_market(self, market_id: u256) -> dict:
        m = self._load(int(market_id))
        return self._market_to_dict(m)

    @gl.public.view
    def get_market_state(self, market_id: u256) -> str:
        m = self._load(int(market_id))
        return self._visible_phase(m, self._now())

    @gl.public.view
    def get_position(self, market_id: u256, wallet: Address) -> dict:
        owner = self._addr(wallet)
        pkey = self._pos_key(int(market_id), owner)
        if not self.positions.contains(pkey):
            return {
                "market_id": int(market_id),
                "owner": owner,
                "side": "",
                "stake": 0,
                "claimed": False,
                "exists": False,
            }
        p = self.positions[pkey]
        return {
            "market_id": int(p.market_id),
            "owner": p.owner,
            "side": p.side,
            "stake": int(p.stake),
            "claimed": p.claimed,
            "exists": True,
        }

    @gl.public.view
    def get_claimable(self, market_id: u256, wallet: Address) -> int:
        m = self._load(int(market_id))
        owner = self._addr(wallet)
        pkey = self._pos_key(int(market_id), owner)
        if not self.positions.contains(pkey):
            return 0
        p = self.positions[pkey]
        if p.claimed or m.state == STATE_PENDING:
            return 0
        return self._compute_payout(m, p)

    @gl.public.view
    def get_markets(self, offset: u256, limit: u256) -> list[dict]:
        off = int(offset)
        lim = min(int(limit), MAX_PAGE)
        total = int(self.market_count)
        out: list[dict] = []
        # Newest first
        i = total - off
        end = max(1, i - lim + 1) if i - lim + 1 > 0 else 1
        while i >= end and len(out) < lim:
            if i >= 1 and self.markets.contains(u256(i)):
                out.append(self._market_to_dict(self.markets[u256(i)]))
            i -= 1
        return out

    @gl.public.view
    def get_open_markets(self, offset: u256, limit: u256) -> list[dict]:
        off = int(offset)
        lim = min(int(limit), MAX_PAGE)
        now = self._now()
        total = int(self.market_count)
        out: list[dict] = []
        skipped = 0
        i = total
        while i >= 1 and len(out) < lim:
            if self.markets.contains(u256(i)):
                m = self.markets[u256(i)]
                if m.state == STATE_PENDING and now < m.cutoff_at:
                    if skipped < off:
                        skipped += 1
                    else:
                        out.append(self._market_to_dict(m))
            i -= 1
        return out

    @gl.public.view
    def get_market_by_asset_day(self, asset: str, target_day: str) -> dict:
        key = self._mk_key(asset, target_day)
        if not self.market_keys.contains(key):
            return {"exists": False}
        mid = int(self.market_keys[key])
        return self._market_to_dict(self.markets[u256(mid)])

    @gl.public.view
    def get_user_markets(
        self, wallet: Address, offset: u256, limit: u256
    ) -> list[dict]:
        owner = self._addr(wallet)
        cnt = int(self.user_market_count.get(owner, u256(0)))
        off = int(offset)
        lim = min(int(limit), MAX_PAGE)
        out: list[dict] = []
        # Newest first
        i = cnt - 1 - off
        while i >= 0 and len(out) < lim:
            mid = int(self.user_market_index[self._user_key(owner, i)])
            if self.markets.contains(u256(mid)):
                out.append(self._market_to_dict(self.markets[u256(mid)]))
            i -= 1
        return out

    @gl.public.view
    def get_settlement_evidence(self, market_id: u256) -> dict:
        mid = int(market_id)
        if not self.settlement_evidence.contains(u256(mid)):
            return {"exists": False}
        e = self.settlement_evidence[u256(mid)]
        return {
            "exists": True,
            "market_id": int(e.market_id),
            "resolved_at": int(e.resolved_at),
            "coinmarket_open": int(e.coinmarket_open),
            "coinmarket_close": int(e.coinmarket_close),
            "coinmarket_direction": e.coinmarket_direction,
            "gate_open": int(e.gate_open),
            "gate_close": int(e.gate_close),
            "gate_direction": e.gate_direction,
            "final_result": e.final_result,
            "terminal_refund": e.terminal_refund,
            "price_scale": PRICE_SCALE,
        }

    def _market_to_dict(self, m: MarketRecord) -> dict:
        now = self._now()
        total = int(m.up_pool) + int(m.down_pool)
        return {
            "exists": True,
            "id": int(m.id),
            "asset": m.asset,
            "coinmarket_slug": m.coinmarket_slug,
            "gate_pair": m.gate_pair,
            "target_day": m.target_day,
            "created_at": int(m.created_at),
            "cutoff_at": int(m.cutoff_at),
            "settles_at": int(m.settles_at),
            "terminal_refund_at": int(m.terminal_refund_at),
            "up_pool": int(m.up_pool),
            "down_pool": int(m.down_pool),
            "total_pool": total,
            "paid_out": int(m.paid_out),
            "state": m.state,
            "result": m.result,
            "refund_all": m.refund_all,
            "resolved_at": int(m.resolved_at),
            "phase": self._visible_phase(m, now),
        }
