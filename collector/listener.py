"""Long-running websocket listener (a GitHub Actions job runs it for ~5h50m,
then the next scheduled run takes over; overlaps are de-duplicated on read).

Subscribes once and writes:
  liquidations/YYYY-MM-DD.jsonl   every public liquidation (has walletId)  <- no history endpoint exists
  whale_fills/YYYY-MM-DD.jsonl    publicTrade fills >= WHALE_USD across all symbols
  vault_fills/YYYY-MM-DD.jsonl    fills of the protocol vault / its MM sub-account / insurance funds
  trade_hourly/YYYY-MM-DD.jsonl   per-symbol hourly buy/sell notional + trade count + size buckets
Commits every COMMIT_EVERY seconds and on exit.

usage: python collector/listener.py [--seconds 21000]   (0 = run forever, for a VM)
"""
import argparse
import asyncio
import json
import os
import sys
import time
from collections import defaultdict

import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (INSURANCE_FUNDS, PROTOCOL_MM, PROTOCOL_VAULT, WS_PUBLIC, append_jsonl, append_jsonl_many,
                    get, now_ms, publish, session, utc_day)

WHALE_USD = float(os.environ.get("WHALE_USD", "25000"))
COMMIT_EVERY = int(os.environ.get("COMMIT_EVERY", "600"))
SYSTEM_WALLETS = {PROTOCOL_VAULT, PROTOCOL_MM, *INSURANCE_FUNDS}
SIZE_BUCKETS = [100, 1000, 10000, 100000]  # USD notional edges


def symbols():
    body = get("/config/symbols", category="Futures", limit=100)
    return [s["symbol"] for s in body["data"] if s.get("status") == "Trading"]


def subscribe_msgs():
    """`symbol: "default"` only acks and never pushes, so subscribe per symbol.
    Payloads are capped at 4096 bytes -> chunks of 25 args."""
    args = [{"category": "Futures", "topic": "liquidation"}]
    args += [{"walletId": w, "topic": "fill"} for w in SYSTEM_WALLETS]
    args += [{"category": "Futures", "topic": "publicTrade", "symbol": s} for s in symbols()]
    return [json.dumps({"op": "subscribe", "args": args[i:i + 25]}) for i in range(0, len(args), 25)]


class Hourly:
    """In-memory per-(hour, symbol) aggregates, flushed when the hour rolls over."""

    def __init__(self):
        self.cur = defaultdict(lambda: {"n": 0, "buy": 0.0, "sell": 0.0, "max": 0.0, "b": [0] * (len(SIZE_BUCKETS) + 1)})
        self.hour = None

    def add(self, symbol, ts, side, notional):
        h = ts // 3600000
        if self.hour is not None and h != self.hour:
            self.flush()
        self.hour = h
        a = self.cur[symbol]
        a["n"] += 1
        a["buy" if side == "Buy" else "sell"] += notional
        a["max"] = max(a["max"], notional)
        a["b"][sum(1 for e in SIZE_BUCKETS if notional >= e)] += 1

    def flush(self):
        if self.hour is None or not self.cur:
            return
        ts = self.hour * 3600000
        rows = [{"ts": ts, "s": s, **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in a.items()}} for s, a in self.cur.items()]
        append_jsonl_many(f"trade_hourly/{utc_day(ts)}.jsonl", rows)
        self.cur.clear()


async def run(seconds):
    deadline = time.time() + seconds if seconds > 0 else float("inf")
    last_commit = time.time()
    hourly = Hourly()
    counts = defaultdict(int)
    while time.time() < deadline:
        try:
            async with websockets.connect(WS_PUBLIC, additional_headers=dict(session.headers), open_timeout=20, ping_interval=None) as ws:
                for m in subscribe_msgs():
                    await ws.send(m)
                last_ping = time.time()
                while time.time() < deadline:
                    if time.time() - last_ping > 30:
                        await ws.send("ping"); last_ping = time.time()
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=10)
                    except asyncio.TimeoutError:
                        continue
                    if raw == "pong":
                        continue
                    msg = json.loads(raw)
                    if msg.get("event"):
                        if msg["event"] == "error":
                            print("[ws] error:", raw[:300])
                        continue
                    topic = (msg.get("arg") or {}).get("topic")
                    recv_ts = now_ms()
                    if topic == "liquidation":
                        rows = [{"recv": recv_ts, **d} for d in msg.get("data", [])]
                        append_jsonl_many(f"liquidations/{utc_day(recv_ts)}.jsonl", rows)
                        counts["liq"] += len(rows)
                    elif topic == "publicTrade":
                        sym = msg["arg"].get("symbol")
                        for d in msg.get("data", []):
                            notional = float(d["price"]) * float(d["size"])
                            ts = int(d["createdAt"])
                            hourly.add(sym, ts, d["side"], notional)
                            counts["trades"] += 1
                            if notional >= WHALE_USD:
                                append_jsonl(f"whale_fills/{utc_day(ts)}.jsonl", {"s": sym, "usd": round(notional, 2), "block": msg.get("blockNumber"), **d})
                                counts["whale"] += 1
                    elif topic == "fill":
                        w = msg["arg"]["walletId"].lower()
                        keep = ["symbol", "side", "positionSide", "execPrice", "execQty", "execValue", "execPnl", "orderType", "liquidation", "feeDetail", "updatedAt", "execId", "cmdSource", "tradeScope"]
                        rows = [{"w": w, **{k: d.get(k) for k in keep}} for d in msg.get("data", [])]
                        append_jsonl_many(f"vault_fills/{utc_day(recv_ts)}.jsonl", rows)
                        counts["vault_fill"] += len(rows)
                    if time.time() - last_commit > COMMIT_EVERY:
                        publish(f"listener {utc_day()} {dict(counts)}")
                        last_commit = time.time()
                        print("[listener]", dict(counts), flush=True)
        except Exception as e:
            print("[ws] reconnecting after:", repr(e)[:200], flush=True)
            await asyncio.sleep(5)
    hourly.flush()
    publish(f"listener end {utc_day()} {dict(counts)}")
    print("[listener] done", dict(counts))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=int(os.environ.get("LISTEN_SECONDS", "21000")))
    a = ap.parse_args()
    asyncio.run(run(a.seconds))
