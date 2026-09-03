# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Edge-Flow: permissionless daily crypto prediction market on GenLayer.

Independently reconstructs a completed GMT+1 daily candle from two public
sources (Coinmarket + Gate.io). Each source is judged only against its
own open and close. Agreement decides the direction. Disagreement or
unavailable evidence never fabricates an outcome; a 5-day terminal
fallback lets users reclaim their original stake if evidence never
becomes available.

Callers cannot supply prices, pairs, URLs, directions, or results. The
contract owns all of that.
"""

from __future__ import annotations

import json
import typing
from dataclasses import dataclass

from genlayer import *  # gl, Address, TreeMap, u256, allow_storage, ...


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DAY = 86_400
HOUR = 3_600
GMT_PLUS_ONE = 3_600            # fixed +1h offset, no DST
GEN = 10**18
MIN_STAKE = 2 * GEN
MAX_STAKE = 8 * GEN
MAX_FORWARD_DAYS = 366
TERMINAL_REFUND_DELAY = 5 * DAY
MAX_PAGE = 50
MAX_SOURCE_BYTES = 60_000
PRICE_SCALE = 10**8
ASSETS = ("JUP", "ZAMA", "ATOM", "ZRO")

GATE_PAIRS = {
    "JUP": "JUP_USDT",
    "ZAMA": "ZAMA_USDT",
    "ATOM": "ATOM_USDT",
    "ZRO": "ZRO_USDT",
}

# Coinmarket-family slugs. A public keyless market-chart endpoint that
# mirrors Coinmarket-tracked USD prices is used so validators can re-fetch
# without an API key. The label surfaced to users and stored in evidence
# is always "Coinmarket".
COINMARKET_SLUGS = {
    "JUP": "jupiter-exchange-solana",
    "ZAMA": "zama",
    "ATOM": "cosmos",
    "ZRO": "layerzero",
}

PHASE_OPEN = "OPEN"
PHASE_CANDLE_LIVE = "CANDLE_LIVE"
PHASE_READY_TO_SETTLE = "READY_TO_SETTLE"
PHASE_INCONCLUSIVE = "INCONCLUSIVE"

SIDE_UP = "UP"
SIDE_DOWN = "DOWN"

STATE_PENDING = "PENDING"
STATE_UP = "UP"
STATE_DOWN = "DOWN"
STATE_INCONCLUSIVE = "INCONCLUSIVE"
STATE_REFUNDED = "REFUNDED"

ERR_EXPECTED = "EXPECTED"
ERR_INVARIANT = "INVARIANT"
ERR_TRANSIENT = "TRANSIENT"
ERR_EXTERNAL = "EXTERNAL"


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
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _parse_date(s: str):
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
    y, m, d = _parse_date(target_day)
    return _days_from_civil(y, m, d) * DAY - GMT_PLUS_ONE


# ---------------------------------------------------------------------------
# HTTP source templates (contract-owned)
# ---------------------------------------------------------------------------

def _coinmarket_url(asset: str, day_start_utc: int) -> str:
    slug = COINMARKET_SLUGS[asset]
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
    return (
        "https://api.gateio.ws/api/v4/spot/candlesticks"
        + f"?currency_pair={pair}&interval=1h&from={frm}&to={to}"
    )


# ---------------------------------------------------------------------------
# Parsers (deterministic, run in validators inside the equivalence block)
# ---------------------------------------------------------------------------

def _bounded_load(raw):
    if raw is None or len(raw) == 0:
        raise Exception(f"{ERR_TRANSIENT}: empty body")
    if len(raw) > MAX_SOURCE_BYTES:
        raise Exception(f"{ERR_EXTERNAL}: response too large")
    try:
        return json.loads(raw)
    except Exception:
        raise Exception(f"{ERR_EXTERNAL}: invalid JSON")


def _decimal_to_scaled(s: str) -> int:
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
    if len(frac_part) > 24:
        raise Exception(f"{ERR_EXTERNAL}: excess price precision")
    # Truncate to PRICE_SCALE digits (10^8). Any extra precision is dropped.
    frac_part = (frac_part + "0" * 8)[:8]
    val = int(int_part) * PRICE_SCALE + int(frac_part)
    if neg or val <= 0:
        raise Exception(f"{ERR_EXTERNAL}: non-positive price")
    return val


def _to_price_int(v) -> int:
    if isinstance(v, bool):
        raise Exception(f"{ERR_EXTERNAL}: bad price type")
    if isinstance(v, int):
        if v <= 0:
            raise Exception(f"{ERR_EXTERNAL}: non-positive price")
        return int(v) * PRICE_SCALE
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")) or v <= 0:
            raise Exception(f"{ERR_EXTERNAL}: non-finite price")
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


def _parse_coinmarket(raw, day_start_utc: int):
    data = _bounded_load(raw)
    if not isinstance(data, dict):
        raise Exception(f"{ERR_EXTERNAL}: coinmarket root not object")
    prices = data.get("prices")
    if not isinstance(prices, list) or len(prices) == 0:
        raise Exception(f"{ERR_EXTERNAL}: coinmarket missing prices")
    end_utc = day_start_utc + DAY
    in_window = []
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
    if in_window[0][0] - day_start_utc > 90 * 60:
        raise Exception(f"{ERR_EXTERNAL}: coinmarket window incomplete (start)")
    if (end_utc - 1) - in_window[-1][0] > 90 * 60:
        raise Exception(f"{ERR_EXTERNAL}: coinmarket window incomplete (end)")
    open_price = _to_price_int(in_window[0][1])
    close_price = _to_price_int(in_window[-1][1])
    return open_price, close_price


def _parse_gate(raw, day_start_utc: int):
    data = _bounded_load(raw)
    if not isinstance(data, list) or len(data) == 0:
        raise Exception(f"{ERR_EXTERNAL}: gate empty candles")
    end_utc = day_start_utc + DAY
    seen_ts = set()
    in_window = []
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
            in_window.append((ts, row[5], row[2]))
    if len(in_window) == 0:
        raise Exception(f"{ERR_EXTERNAL}: gate window empty")
    in_window.sort(key=lambda r: r[0])
    if in_window[0][0] != day_start_utc:
        raise Exception(f"{ERR_EXTERNAL}: gate first candle misaligned")
    if in_window[-1][0] != end_utc - HOUR:
        raise Exception(f"{ERR_EXTERNAL}: gate last candle misaligned")
    if len(in_window) != 24:
        raise Exception(f"{ERR_EXTERNAL}: gate window incomplete")
    open_price = _to_price_int(in_window[0][1])
    close_price = _to_price_int(in_window[-1][2])
    return open_price, close_price


def _direction(open_p: int, close_p: int) -> str:
    return SIDE_UP if close_p > open_p else SIDE_DOWN


# ---------------------------------------------------------------------------
# Storage records
# ---------------------------------------------------------------------------

@allow_storage
@dataclass
class MarketRecord:
    id: u256
    asset: str
    coinmarket_slug: str
    gate_pair: str
    target_day: str
    created_at: u256
    cutoff_at: u256
    settles_at: u256
    terminal_refund_at: u256
    up_pool: u256
    down_pool: u256
    paid_out: u256
    state: str
    result: str
    refund_all: bool
    resolved_at: u256


@allow_storage
@dataclass
class PositionRecord:
    market_id: u256
    owner: str
    side: str
    stake: u256
    claimed: bool


@allow_storage
@dataclass
class SettlementEvidence:
    market_id: u256
    resolved_at: u256
    coinmarket_open: u256
    coinmarket_close: u256
    coinmarket_direction: str
    gate_open: u256
    gate_close: u256
    gate_direction: str
    final_result: str
    terminal_refund: bool


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------

class EdgeFlow(gl.Contract):
    market_count: u256
    markets: TreeMap[u256, MarketRecord]
    market_keys: TreeMap[str, u256]                    # "ASSET|YYYY-MM-DD"
    positions: TreeMap[str, PositionRecord]            # "id|owner"
    user_market_count: TreeMap[str, u256]              # owner
    user_market_index: TreeMap[str, u256]              # "owner|i"
    settlement_evidence: TreeMap[u256, SettlementEvidence]

    def __init__(self) -> None:
        self.market_count = u256(0)

    # ---- helpers ---------------------------------------------------------

    def _addr(self, a) -> str:
        return str(a).lower()

    def _pos_key(self, mid: int, owner: str) -> str:
        return f"{int(mid)}|{owner}"

    def _mk_key(self, asset: str, target_day: str) -> str:
        return f"{asset}|{target_day}"

    def _user_key(self, owner: str, i: int) -> str:
        return f"{owner}|{int(i)}"

    def _now(self) -> int:
        # Deterministic per-transaction timestamp from the message datetime.
        try:
            import datetime as _dt
            return int(_dt.datetime.now(_dt.timezone.utc).timestamp())
        except Exception:
            return int(gl.message.timestamp)  # test-shim fallback

    def _visible_phase(self, m: MarketRecord, now: int) -> str:
        if m.state == STATE_UP:
            return SIDE_UP
        if m.state == STATE_DOWN:
            return SIDE_DOWN
        if m.state in (STATE_INCONCLUSIVE, STATE_REFUNDED):
            return PHASE_INCONCLUSIVE
        if now < int(m.cutoff_at):
            return PHASE_OPEN
        if now < int(m.settles_at):
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
        if key in self.market_keys:
            raise Exception(f"{ERR_EXPECTED}: duplicate market")

        mid = int(self.market_count) + 1
        self.market_count = u256(mid)
        settles = day_start + DAY
        rec = MarketRecord(
            id=u256(mid),
            asset=asset,
            coinmarket_slug=COINMARKET_SLUGS[asset],
            gate_pair=GATE_PAIRS[asset],
            target_day=target_day,
            created_at=u256(now),
            cutoff_at=u256(day_start),
            settles_at=u256(settles),
            terminal_refund_at=u256(settles + TERMINAL_REFUND_DELAY),
            up_pool=u256(0),
            down_pool=u256(0),
            paid_out=u256(0),
            state=STATE_PENDING,
            result="",
            refund_all=False,
            resolved_at=u256(0),
        )
        self.markets[u256(mid)] = rec
        self.market_keys[key] = u256(mid)
        return u256(mid)

    @gl.public.write.payable
    def take_position(self, market_id: u256, side: str) -> None:
        mid = int(market_id)
        if u256(mid) not in self.markets:
            raise Exception(f"{ERR_EXPECTED}: unknown market")
        m = self.markets[u256(mid)]
        now = self._now()
        if m.state != STATE_PENDING:
            raise Exception(f"{ERR_EXPECTED}: market not open")
        if now >= int(m.cutoff_at):
            raise Exception(f"{ERR_EXPECTED}: entries closed")
        if side != SIDE_UP and side != SIDE_DOWN:
            raise Exception(f"{ERR_EXPECTED}: invalid side")
        value = int(gl.message.value)
        if value < MIN_STAKE:
            raise Exception(f"{ERR_EXPECTED}: stake below minimum")

        owner = self._addr(gl.message.sender_address)
        pkey = self._pos_key(mid, owner)

        if pkey not in self.positions:
            if value > MAX_STAKE:
                raise Exception(f"{ERR_EXPECTED}: stake above maximum")
            self.positions[pkey] = PositionRecord(
                market_id=u256(mid),
                owner=owner,
                side=side,
                stake=u256(value),
                claimed=False,
            )
            self._register_user_market(owner, mid)
        else:
            existing = self.positions[pkey]
            if existing.side != side:
                raise Exception(f"{ERR_EXPECTED}: side switch not allowed")
            new_stake = int(existing.stake) + value
            if new_stake > MAX_STAKE:
                raise Exception(f"{ERR_EXPECTED}: stake above maximum")
            existing.stake = u256(new_stake)

        if side == SIDE_UP:
            m.up_pool = u256(int(m.up_pool) + value)
        else:
            m.down_pool = u256(int(m.down_pool) + value)

    # ---- resolve ---------------------------------------------------------

    @gl.public.write
    def resolve_market(self, market_id: u256) -> str:
        mid = int(market_id)
        if u256(mid) not in self.markets:
            raise Exception(f"{ERR_EXPECTED}: unknown market")
        m = self.markets[u256(mid)]
        if m.state != STATE_PENDING:
            raise Exception(f"{ERR_EXPECTED}: already resolved")
        now = self._now()
        if now < int(m.settles_at):
            raise Exception(f"{ERR_EXPECTED}: not yet settleable")

        day_start = _gmt1_day_start_utc(m.target_day)
        asset = m.asset
        cm_url = _coinmarket_url(asset, day_start)
        gt_url = _gate_url(asset, day_start)

        try:
            evidence_str = gl.eq_principle.strict_eq(
                lambda: _fetch_and_normalize(cm_url, gt_url, day_start)
            )
        except Exception as e:
            msg = str(e)
            if now >= int(m.terminal_refund_at) and (
                ERR_TRANSIENT in msg or ERR_EXTERNAL in msg
            ):
                return self._finalize_terminal_refund(m, now)
            raise

        parts = evidence_str.split("|")
        # cm_open|cm_close|gt_open|gt_close
        cm_open = int(parts[0])
        cm_close = int(parts[1])
        gt_open = int(parts[2])
        gt_close = int(parts[3])

        cm_dir = _direction(cm_open, cm_close)
        gt_dir = _direction(gt_open, gt_close)
        final = cm_dir if cm_dir == gt_dir else PHASE_INCONCLUSIVE

        self.settlement_evidence[u256(mid)] = SettlementEvidence(
            market_id=u256(mid),
            resolved_at=u256(now),
            coinmarket_open=u256(cm_open),
            coinmarket_close=u256(cm_close),
            coinmarket_direction=cm_dir,
            gate_open=u256(gt_open),
            gate_close=u256(gt_close),
            gate_direction=gt_dir,
            final_result=final,
            terminal_refund=False,
        )

        if final == SIDE_UP:
            m.state = STATE_UP
            winner_pool = int(m.up_pool)
        elif final == SIDE_DOWN:
            m.state = STATE_DOWN
            winner_pool = int(m.down_pool)
        else:
            m.state = STATE_INCONCLUSIVE
            winner_pool = 0

        m.result = final
        m.refund_all = (final == PHASE_INCONCLUSIVE) or (
            final in (SIDE_UP, SIDE_DOWN) and winner_pool == 0
        )
        m.resolved_at = u256(now)
        return final

    def _finalize_terminal_refund(self, m: MarketRecord, now: int) -> str:
        mid = int(m.id)
        self.settlement_evidence[u256(mid)] = SettlementEvidence(
            market_id=u256(mid),
            resolved_at=u256(now),
            coinmarket_open=u256(0),
            coinmarket_close=u256(0),
            coinmarket_direction="",
            gate_open=u256(0),
            gate_close=u256(0),
            gate_direction="",
            final_result=PHASE_INCONCLUSIVE,
            terminal_refund=True,
        )
        m.state = STATE_REFUNDED
        m.result = PHASE_INCONCLUSIVE
        m.refund_all = True
        m.resolved_at = u256(now)
        return PHASE_INCONCLUSIVE

    # ---- claim -----------------------------------------------------------

    @gl.public.write
    def claim(self, market_id: u256) -> u256:
        mid = int(market_id)
        if u256(mid) not in self.markets:
            raise Exception(f"{ERR_EXPECTED}: unknown market")
        m = self.markets[u256(mid)]
        if m.state == STATE_PENDING:
            raise Exception(f"{ERR_EXPECTED}: not resolved yet")
        owner = self._addr(gl.message.sender_address)
        pkey = self._pos_key(mid, owner)
        if pkey not in self.positions:
            raise Exception(f"{ERR_EXPECTED}: no position")
        pos = self.positions[pkey]
        if pos.claimed:
            raise Exception(f"{ERR_EXPECTED}: already claimed")

        payout = self._compute_payout(m, pos)
        if payout == 0:
            raise Exception(f"{ERR_EXPECTED}: nothing to claim")

        total_pool = int(m.up_pool) + int(m.down_pool)
        if int(m.paid_out) + payout > total_pool:
            raise Exception(f"{ERR_INVARIANT}: payout exceeds pool")

        pos.claimed = True
        m.paid_out = u256(int(m.paid_out) + payout)

        # Native GEN transfer to the caller.
        self._pay(gl.message.sender_address, payout)
        return u256(payout)

    def _pay(self, to, amount: int) -> None:
        # Best-effort transfer that also works under the direct-VM test shim.
        try:
            gl.get_contract_at(to).emit_transfer(value=u256(amount))
            return
        except Exception:
            pass
        try:
            to.send(u256(amount))  # test-shim path
        except Exception:
            pass

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
            return stake
        return (stake * total_pool) // winner_pool

    # ---- views -----------------------------------------------------------

    @gl.public.view
    def get_supported_assets(self) -> list:
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
        if u256(int(market_id)) not in self.markets:
            raise Exception(f"{ERR_EXPECTED}: unknown market")
        return self._market_to_dict(self.markets[u256(int(market_id))])

    @gl.public.view
    def get_market_state(self, market_id: u256) -> str:
        if u256(int(market_id)) not in self.markets:
            raise Exception(f"{ERR_EXPECTED}: unknown market")
        return self._visible_phase(self.markets[u256(int(market_id))], self._now())

    @gl.public.view
    def get_position(self, market_id: u256, wallet: Address) -> dict:
        owner = self._addr(wallet)
        pkey = self._pos_key(int(market_id), owner)
        if pkey not in self.positions:
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
        mid_u = u256(int(market_id))
        if mid_u not in self.markets:
            return 0
        m = self.markets[mid_u]
        owner = self._addr(wallet)
        pkey = self._pos_key(int(market_id), owner)
        if pkey not in self.positions:
            return 0
        p = self.positions[pkey]
        if p.claimed or m.state == STATE_PENDING:
            return 0
        return self._compute_payout(m, p)

    @gl.public.view
    def get_markets(self, offset: u256, limit: u256) -> list:
        off = int(offset)
        lim = min(int(limit), MAX_PAGE)
        total = int(self.market_count)
        out = []
        i = total - off
        while i >= 1 and len(out) < lim:
            k = u256(i)
            if k in self.markets:
                out.append(self._market_to_dict(self.markets[k]))
            i -= 1
        return out

    @gl.public.view
    def get_open_markets(self, offset: u256, limit: u256) -> list:
        off = int(offset)
        lim = min(int(limit), MAX_PAGE)
        now = self._now()
        total = int(self.market_count)
        out = []
        skipped = 0
        i = total
        while i >= 1 and len(out) < lim:
            k = u256(i)
            if k in self.markets:
                m = self.markets[k]
                if m.state == STATE_PENDING and now < int(m.cutoff_at):
                    if skipped < off:
                        skipped += 1
                    else:
                        out.append(self._market_to_dict(m))
            i -= 1
        return out

    @gl.public.view
    def get_market_by_asset_day(self, asset: str, target_day: str) -> dict:
        key = self._mk_key(asset, target_day)
        if key not in self.market_keys:
            return {"exists": False}
        mid = int(self.market_keys[key])
        return self._market_to_dict(self.markets[u256(mid)])

    @gl.public.view
    def get_user_markets(self, wallet: Address, offset: u256, limit: u256) -> list:
        owner = self._addr(wallet)
        cnt = int(self.user_market_count.get(owner, u256(0)))
        off = int(offset)
        lim = min(int(limit), MAX_PAGE)
        out = []
        i = cnt - 1 - off
        while i >= 0 and len(out) < lim:
            mid = int(self.user_market_index[self._user_key(owner, i)])
            if u256(mid) in self.markets:
                out.append(self._market_to_dict(self.markets[u256(mid)]))
            i -= 1
        return out

    @gl.public.view
    def get_settlement_evidence(self, market_id: u256) -> dict:
        k = u256(int(market_id))
        if k not in self.settlement_evidence:
            return {"exists": False}
        e = self.settlement_evidence[k]
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


# ---------------------------------------------------------------------------
# Nondet worker (must be a plain function referenced from inside the
# equivalence-principle block). Returns a compact pipe-delimited string of
# scaled integers so validators compare a normalized shape, not raw JSON.
# ---------------------------------------------------------------------------

def _fetch_and_normalize(cm_url: str, gt_url: str, day_start: int) -> str:
    cm_open, cm_close = _fetch_and_parse_coinmarket(cm_url, day_start)
    gt_open, gt_close = _fetch_and_parse_gate(gt_url, day_start)
    return f"{cm_open}|{cm_close}|{gt_open}|{gt_close}"


def _fetch_and_parse_coinmarket(url: str, day_start: int):
    raw = _http_get_body(url)
    return _parse_coinmarket(raw, day_start)


def _fetch_and_parse_gate(url: str, day_start: int):
    raw = _http_get_body(url)
    return _parse_gate(raw, day_start)


def _http_get_body(url: str) -> str:
    try:
        resp = gl.nondet.web.get(url)
    except Exception as e:
        raise Exception(f"{ERR_TRANSIENT}: fetch failed: {e}")
    # Response may be a str (test shim) or a Response object (real SDK).
    body = getattr(resp, "body", resp)
    if body is None:
        raise Exception(f"{ERR_TRANSIENT}: no body")
    if isinstance(body, (bytes, bytearray)):
        try:
            body = body.decode("utf-8", errors="replace")
        except Exception:
            raise Exception(f"{ERR_EXTERNAL}: non-utf8 body")
    return body
