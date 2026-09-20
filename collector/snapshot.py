"""Every-10-minutes snapshot. Appends small rows; never rewrites history.

  snapshots/YYYY-MM-DD.jsonl      insurance funds, protocol vault, per-symbol OI/funding/volume
  vault_positions/YYYY-MM-DD.jsonl protocol vault open positions (LP inventory)
  explorer_daily.json             merged 14-day tx-count windows -> full series
  active_accounts/YYYY-MM-DD.jsonl 600-block on-chain sample: accounts, UI vs bot, cancel ratio
  bridge/*.csv                    new deposits / withdrawals since last run
"""
import os
import sys
import traceback
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (EXPLORER, INSURANCE_FUNDS, PROTOCOL_VAULT, append_jsonl, get, now_ms, paginate,
                    publish, read_json, utc_day, write_json)
import bridge


def step(name, fn):
    try:
        fn()
        print(f"[snapshot] {name} ok")
    except Exception:
        print(f"[snapshot] {name} FAILED")
        traceback.print_exc()


def snapshot_markets():
    ts = now_ms()
    ins = [{"wallet": a["walletId"], "equity": a["accountEquity"], "collateral": a["totalCollateral"]}
           for a in get("/public/insurance-fund")["data"]]
    vaults = get("/vaults", limit=100)["data"]
    vault = next((v for v in vaults if v["vaultWalletId"].lower() == PROTOCOL_VAULT), vaults[0] if vaults else {})
    tickers = paginate("/public/market/tickers", category="Futures")
    row = {
        "ts": ts,
        "insurance": ins,
        "vault": {k: vault.get(k) for k in ["vaultWalletId", "nav", "totalEquity", "totalShares", "apr", "allTimePnl", "leaderShares"]},
        "tickers": [{"s": t["symbol"], "oi": t["openInterest"], "fr": t["fundingRate"], "v24": t["turnover24h"],
                     "last": t["lastPrice"], "mark": t["markPrice"], "idx": t["indexPrice"]} for t in tickers],
    }
    try:
        ov = get("/overview", base=EXPLORER)["data"]
        row["explorer"] = {"block": ov["latestBlockHeight"], "txs": ov["totalTransactions"], "tps": ov["avgTps"]}
        daily = read_json("explorer_daily.json", {})
        for d in ov.get("dailyStats", []):
            daily[d["date"]] = int(d["transactionCount"])
        write_json("explorer_daily.json", dict(sorted(daily.items())))
    except Exception as e:
        print("[snapshot] explorer overview failed:", e)
    append_jsonl(f"snapshots/{utc_day(ts)}.jsonl", row)


def snapshot_vault_positions():
    ts = now_ms()
    pos = paginate(f"/vault/{PROTOCOL_VAULT}/positions")
    keep = ["symbol", "positionSide", "holdQty", "avgOpenPrice", "markPrice", "unPnl", "realizedPnl", "fundingFee", "symbolLeverage"]
    append_jsonl(f"vault_positions/{utc_day(ts)}.jsonl", {"ts": ts, "positions": [{k: p.get(k) for k in keep} for p in pos]})


def snapshot_active_accounts(n_blocks=600):
    from popdex.rpc import Tachyon
    from popdex.events import decode_log
    rpc = Tachyon(per_minute=1000)
    to_block = rpc.latest_block_number() - 2
    from_block = to_block - n_blocks + 1
    numbers = list(range(from_block, to_block + 1))
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(8) as ex:
        blocks = list(ex.map(lambda n: rpc.block(n, True), numbers))
        chunks = [(n, min(n + 2, to_block)) for n in range(from_block, to_block + 1, 3)]
        logs = [l for ch in ex.map(lambda c: rpc.logs(*c), chunks) for l in ch]
    txs = [tx for b in blocks for tx in b["transactions"]]
    ev = Counter()
    accounts, ui_accounts, bot_accounts = set(), set(), set()
    orders_ui = orders_bot = 0
    symbols = Counter()
    per_account = Counter()
    for lg in logs:
        d = decode_log(lg)
        if not d:
            continue
        ev[d["event"]] += 1
        if d["event"] == "OrderCreate" and d["args"]["succeeded"]:
            a = d["args"]["account"]
            accounts.add(a)
            per_account[a] += 1
            symbols[d["args"]["symbol"]] += 1
            if str(d["args"]["clientOid"]).startswith("PPD"):
                ui_accounts.add(a); orders_ui += 1
            else:
                bot_accounts.add(a); orders_bot += 1
    top3 = sum(n for _, n in per_account.most_common(3))
    ts0, ts1 = int(blocks[0]["timestamp"], 16), int(blocks[-1]["timestamp"], 16)
    append_jsonl(f"active_accounts/{utc_day()}.jsonl", {
        "ts": now_ms(), "from": from_block, "to": to_block, "span_ms": ts1 - ts0,
        "txs": len(txs), "senders": len({t["from"] for t in txs}),
        "orders": ev["OrderCreate"], "cancels": ev["OrderCancel"], "trigger_orders": ev["TriggerOrderCreate"],
        "accounts": len(accounts), "ui_accounts": len(ui_accounts), "bot_accounts": len(bot_accounts),
        "orders_ui": orders_ui, "orders_bot": orders_bot,
        "top3_share": round(top3 / max(1, orders_ui + orders_bot), 4),
        "symbols": dict(symbols.most_common(15)),
        "events": dict(ev),
    })


def snapshot_bridge():
    for chain in bridge.CHAINS:
        bridge.scan(chain, budget_s=240)


if __name__ == "__main__":
    step("markets", snapshot_markets)
    step("vault_positions", snapshot_vault_positions)
    step("active_accounts", snapshot_active_accounts)
    step("bridge", snapshot_bridge)
    publish(f"snapshot {utc_day()} {now_ms()}", index=True)
