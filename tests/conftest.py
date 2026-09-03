"""Shared in-process GenLayer shim for Edge-Flow tests.

Emulates enough of the real GenVM SDK to run the same contract source
that gets deployed to Bradbury. Loaded exactly once via tests/conftest.py
regardless of which subdirectory (direct/ or consensus/) collects.
"""

from __future__ import annotations


import json
import sys
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# In-process GenLayer shim
# ---------------------------------------------------------------------------

class _TreeMap(dict):
    def __class_getitem__(cls, item):
        return cls

    def contains(self, k):
        return self._nkey(k) in self

    def __contains__(self, k):
        return dict.__contains__(self, self._nkey(k))

    def __getitem__(self, k):
        return dict.__getitem__(self, self._nkey(k))

    def __setitem__(self, k, v):
        dict.__setitem__(self, self._nkey(k), v)

    def get(self, k, default=None):
        return dict.get(self, self._nkey(k), default)

    @staticmethod
    def _nkey(k):
        if isinstance(k, int) and not isinstance(k, bool):
            return int(k)
        return k


class _Address(str):
    def __new__(cls, v):
        return super().__new__(cls, v)

    def send(self, amount):
        ledger.setdefault(str(self).lower(), 0)
        ledger[str(self).lower()] += int(amount)


def _iso_utc(ts: int) -> str:
    """Render unix seconds the way GenVM fills message_raw['datetime']."""
    import time
    y, mo, d, hh, mi, sec = time.gmtime(int(ts))[:6]
    return f"{y:04d}-{mo:02d}-{d:02d}T{hh:02d}:{mi:02d}:{sec:02d}Z"


class _Message:
    def __init__(self):
        self.sender_address = _Address(
            "0x0000000000000000000000000000000000000000"
        )
        self.contract_address = _Address(
            "0x0000000000000000000000000000000000000001"
        )
        self.origin_address = self.sender_address
        self.value = 0
        # Tests warp time by setting .timestamp; the contract reads the
        # consensus time through gl.message_raw["datetime"], exactly as
        # it does on-chain.
        self.timestamp = 0


class _Web:
    def __init__(self, outer):
        self.outer = outer

    def get(self, url):
        if self.outer._handler is None:
            raise RuntimeError("no nondet handler registered")
        return self.outer._handler(url)


class _Nondet:
    def __init__(self):
        self._handler = None

    def set_handler(self, fn):
        self._handler = fn

    @property
    def web(self):
        return _Web(self)


class _PayableAccessor:
    def __call__(self, fn):
        return fn

    def payable(self, fn):
        return fn


class _WriteAccessor:
    def __call__(self, fn):
        return fn

    payable = property(lambda self: _PayableAccessor())


class _ViewAccessor:
    def __call__(self, fn):
        return fn


class _PublicAccessor:
    write = _WriteAccessor()
    view = _ViewAccessor()


class _EqPrinciple:
    @staticmethod
    def strict_eq(fn):
        return fn()


class _ContractProxy:
    """Returned by gl.get_contract_at(addr) — supports .emit_transfer."""

    def __init__(self, addr):
        self._addr = addr

    def emit_transfer(self, *, value):
        ledger.setdefault(str(self._addr).lower(), 0)
        ledger[str(self._addr).lower()] += int(value)


class _Contract:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        anno = getattr(cls, "__annotations__", {})
        cls.__tm_fields__ = [
            n for n, t in anno.items() if "TreeMap" in str(t)
        ]

    def __new__(cls, *args, **kwargs):
        obj = object.__new__(cls)
        for n in getattr(cls, "__tm_fields__", []):
            object.__setattr__(obj, n, _TreeMap())
        return obj


class _GL:
    def __init__(self):
        self.message = _Message()
        self.nondet = _Nondet()
        self.public = _PublicAccessor()
        self.Contract = _Contract
        self.TreeMap = _TreeMap
        self.eq_principle = _EqPrinciple()
        self.vm = types.SimpleNamespace(
            run_nondet_unsafe=lambda fn, *a, **kw: fn(*a, **kw),
            UserError=Exception,
        )

    @property
    def message_raw(self):
        m = self.message
        return {
            "contract_address": m.contract_address,
            "sender_address": m.sender_address,
            "origin_address": m.sender_address,
            "stack": [],
            "value": m.value,
            "datetime": _iso_utc(m.timestamp),
        }

    def get_contract_at(self, addr):
        return _ContractProxy(addr)


gl = _GL()


class _U256(int):
    def __new__(cls, v):
        return super().__new__(cls, int(v))


def _allow_storage(cls):
    # In real GenVM this registers the class as storage-eligible. Here we
    # just tag it and return it unchanged so @dataclass keeps working.
    setattr(cls, "__gl_allow_storage__", True)
    return cls


# Public `genlayer` module namespace — `from genlayer import *` needs
# these names.
types_mod = types.ModuleType("genlayer.types")
types_mod.Address = _Address
types_mod.u256 = _U256
types_mod.TreeMap = _TreeMap

genlayer_pkg = types.ModuleType("genlayer")
genlayer_pkg.gl = gl
genlayer_pkg.types = types_mod
genlayer_pkg.Address = _Address
genlayer_pkg.u256 = _U256
genlayer_pkg.TreeMap = _TreeMap
genlayer_pkg.allow_storage = _allow_storage
# Also expose the integer-width aliases some contracts import.
for _n in ("u8", "u16", "u32", "u64", "u128", "i8", "i16", "i32", "i64",
          "i128", "bigint"):
    setattr(genlayer_pkg, _n, _U256)
genlayer_pkg.__all__ = [
    "gl", "Address", "u256", "TreeMap", "allow_storage",
]

sys.modules["genlayer"] = genlayer_pkg
sys.modules["genlayer.types"] = types_mod


# NOTE: the contract reads time exclusively from gl.message.timestamp (the
# consensus timestamp), so tests warp time by setting that field. There is
# deliberately no datetime monkeypatch here — if one were needed, it would
# mean the contract had reintroduced a nondeterministic wall-clock read.


# ---------------------------------------------------------------------------
# Test fixtures + helpers
# ---------------------------------------------------------------------------

ledger: dict[str, int] = {}


@pytest.fixture
def gl_env():
    ledger.clear()
    gl.message = _Message()
    gl.nondet.set_handler(None)

    def set_time(ts):
        gl.message.timestamp = int(ts)

    def set_sender(addr, value=0):
        gl.message.sender_address = _Address(addr)
        gl.message.value = int(value)

    def set_nondet(handler):
        gl.nondet.set_handler(handler)

    return types.SimpleNamespace(
        gl=gl,
        set_time=set_time,
        set_sender=set_sender,
        set_nondet=set_nondet,
        ledger=ledger,
        Address=_Address,
        u256=_U256,
    )


@pytest.fixture
def contract(gl_env):
    from contracts.EdgeFlow import EdgeFlow
    return EdgeFlow()


# ---------------------------------------------------------------------------
# Mock market-data helpers
# ---------------------------------------------------------------------------

HOUR = 3600
DAY = 86400


def coinmarket_body(day_start_utc, prices):
    return json.dumps({
        "prices": [[ts * 1000, p] for ts, p in prices],
        "market_caps": [],
        "total_volumes": [],
    })


def full_coinmarket(day_start_utc, open_p, close_p):
    samples = []
    step = DAY // 12
    for i in range(12):
        ts = day_start_utc + i * step
        if i == 0:
            samples.append((ts, open_p))
        elif i == 11:
            samples.append((day_start_utc + DAY - 60, close_p))
        else:
            p = open_p + (close_p - open_p) * (i / 11)
            samples.append((ts, round(p, 6)))
    return coinmarket_body(day_start_utc, samples)


def gate_body(day_start_utc, rows):
    return json.dumps(rows)


def full_gate(day_start_utc, open_p, close_p):
    rows = []
    for i in range(24):
        ts = day_start_utc + i * HOUR
        o = open_p + (close_p - open_p) * (i / 24)
        c = open_p + (close_p - open_p) * ((i + 1) / 24)
        if i == 0:
            o = open_p
        if i == 23:
            c = close_p
        rows.append([str(ts), "1000", f"{c:.6f}", f"{max(o, c):.6f}",
                     f"{min(o, c):.6f}", f"{o:.6f}", "1000"])
    return gate_body(day_start_utc, rows)


def make_nondet(mapping):
    def handler(url):
        for key, body in mapping.items():
            if key in url:
                return body
        raise RuntimeError(f"no mock for {url}")
    return handler
