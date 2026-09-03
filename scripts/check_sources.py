"""Operational live check for Edge-Flow settlement sources.

Hits Coinmarket + Gate.io endpoints for JUP / ZAMA / ATOM / ZRO and
prints whether a full GMT+1 daily candle can be reconstructed for the
previous completed GMT+1 day.

This script is a sanity probe for operators. It is not consensus code.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

# Load the in-process GenLayer shim so the contract module imports.
# The shim only stubs runtime primitives; date/URL/parser code inside
# EdgeFlow.py is pure Python.
import conftest  # noqa: F401,E402  (registers `genlayer` in sys.modules)

from contracts.EdgeFlow import (  # noqa: E402
    ASSETS,
    COINMARKET_SLUGS,
    GATE_PAIRS,
    _coinmarket_url,
    _gate_url,
    _gmt1_day_start_utc,
    _parse_coinmarket,
    _parse_gate,
)


def previous_gmt1_day() -> str:
    now = datetime.now(timezone.utc) + timedelta(hours=1)  # to GMT+1
    d = (now - timedelta(days=1)).date()
    return d.isoformat()


def fetch(url: str, timeout: float = 15.0) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "edge-flow-source-check/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def check(asset: str, day: str) -> dict:
    day_start = _gmt1_day_start_utc(day)
    cm_url = _coinmarket_url(asset, day_start)
    gt_url = _gate_url(asset, day_start)
    row = {"asset": asset, "day": day}

    try:
        raw = fetch(cm_url)
        o, c = _parse_coinmarket(raw, day_start)
        row["coinmarket"] = {
            "ok": True,
            "open": o,
            "close": c,
            "direction": "UP" if c > o else "DOWN",
            "url": cm_url,
        }
    except Exception as e:
        row["coinmarket"] = {"ok": False, "error": str(e), "url": cm_url}

    try:
        raw = fetch(gt_url)
        o, c = _parse_gate(raw, day_start)
        row["gate"] = {
            "ok": True,
            "open": o,
            "close": c,
            "direction": "UP" if c > o else "DOWN",
            "url": gt_url,
        }
    except Exception as e:
        row["gate"] = {"ok": False, "error": str(e), "url": gt_url}

    if row["coinmarket"].get("ok") and row["gate"].get("ok"):
        if row["coinmarket"]["direction"] == row["gate"]["direction"]:
            row["final"] = row["coinmarket"]["direction"]
        else:
            row["final"] = "INCONCLUSIVE"
    else:
        row["final"] = "UNAVAILABLE"
    return row


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--day", default=None, help="Target GMT+1 day YYYY-MM-DD")
    p.add_argument("--json", action="store_true", help="Machine-readable output")
    args = p.parse_args()

    day = args.day or previous_gmt1_day()
    results = [check(a, day) for a in ASSETS]

    if args.json:
        print(json.dumps({"day": day, "results": results}, indent=2))
        return 0

    print(f"Edge-Flow source check — GMT+1 day {day}")
    print("=" * 68)
    for r in results:
        cm = r["coinmarket"]
        gt = r["gate"]
        cm_s = f"OK dir={cm['direction']}" if cm["ok"] else f"FAIL {cm['error']}"
        gt_s = f"OK dir={gt['direction']}" if gt["ok"] else f"FAIL {gt['error']}"
        print(f"{r['asset']:<5} | Coinmarket: {cm_s}")
        print(f"      | Gate.io   : {gt_s}")
        print(f"      | Final     : {r['final']}")
        print("-" * 68)
    ok = all(r["final"] in ("UP", "DOWN", "INCONCLUSIVE") for r in results)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
