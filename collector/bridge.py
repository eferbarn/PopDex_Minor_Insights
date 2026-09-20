"""Bridge deposits / withdrawals on the custody chains (Arbitrum One, Morph).

Event layout was reverse-engineered from live logs (the proxy implementation is
not verified on any explorer):
  Deposit          0x0b6c…b63c  topics[sender, toChainId, token]   data[amount, receiver]
  WithdrawSubmit   0x94d2…70e2  topics[id, hash, token]            data[amount, receiver]
  WithdrawFinal    0xe53f…2bc3  topics[id, hash]                   data[timestamp]
State (last scanned block per chain) lives in bridge/state.json so each run
only scans new blocks; the first run backfills from launch (~2026-07-01).
"""
import csv
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import data_path, read_json, session, write_json

TOPIC_DEPOSIT = "0x0b6c6cb502d2da9ef6887b17afbeb0034852ce0a2394ac48028d6b0f7810b63c"
TOPIC_WITHDRAW_SUBMIT = "0x94d2edf90185713ba10b8f65d551b183edcd082a884ba5111f0067a7da0870e2"
TOPIC_WITHDRAW_FINAL = "0xe53fbdfd13a3762b04cb43ccb9c785929eaeaae573d375c00e8d6f02ae742bc3"
LAUNCH_TS = 1782000000  # 2026-06-21, safely before the first deposit

CHAINS = {
    "arbitrum": {"rpc": "https://arb1.arbitrum.io/rpc", "bridge": "0x0B15D6cF5e843C88034f64664D7fE66E5F79C5f2", "range": 50000},
    "morph": {"rpc": "https://rpc.morphl2.io", "bridge": "0x71FB3a05d02B48d358E4DEB55D0D461Dcb7cF71d", "range": 5000},
}
FIELDS = ["chain", "kind", "block", "ts", "tx", "sender", "receiver", "token", "amount", "to_chain_id", "wid"]


def rpc(url, method, params):
    for attempt in range(5):
        r = session.post(url, json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1}, timeout=60)
        body = r.json()
        if "result" in body:
            return body["result"]
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url} {method}: {body.get('error')}")


def block_ts(url, n):
    return int(rpc(url, "eth_getBlockByNumber", [hex(n), False])["timestamp"], 16)


def find_block_at(url, ts, hi):
    lo = 1
    while lo < hi:
        mid = (lo + hi) // 2
        if block_ts(url, mid) < ts:
            lo = mid + 1
        else:
            hi = mid
    return lo


def parse(chain, log, ts_cache, url):
    t = log["topics"]
    data = log["data"][2:]
    words = [data[i:i + 64] for i in range(0, len(data), 64)]
    n = int(log["blockNumber"], 16)
    if n not in ts_cache:
        ts_cache[n] = block_ts(url, n)
    row = {"chain": chain, "block": n, "ts": ts_cache[n] * 1000, "tx": log["transactionHash"], "sender": "", "receiver": "", "token": "", "amount": "", "to_chain_id": "", "wid": ""}
    if t[0] == TOPIC_DEPOSIT:
        row.update(kind="deposit", sender="0x" + t[1][-40:], to_chain_id=int(t[2], 16), token="0x" + t[3][-40:], amount=int(words[0], 16), receiver="0x" + words[1][-40:])
    elif t[0] == TOPIC_WITHDRAW_SUBMIT:
        row.update(kind="withdraw_submit", wid=int(t[1], 16), token="0x" + t[3][-40:], amount=int(words[0], 16), receiver="0x" + words[1][-40:])
    elif t[0] == TOPIC_WITHDRAW_FINAL:
        row.update(kind="withdraw_final", wid=int(t[1], 16), ts=int(words[0], 16) * 1000)
    else:
        row.update(kind="unknown:" + t[0][:10])
    return row


def scan(chain, budget_s=240):
    cfg = CHAINS[chain]
    url = cfg["rpc"]
    state = read_json("bridge/state.json", {})
    latest = int(rpc(url, "eth_blockNumber", []), 16)
    start = state.get(chain)
    if start is None:
        start = find_block_at(url, LAUNCH_TS, latest)
        print(f"[bridge:{chain}] first run, backfilling from block {start}")
    out_path = data_path("bridge", f"{chain}.csv")
    new_file = not os.path.exists(out_path)
    t0 = time.time()
    rows, ts_cache = [], {}
    with open(out_path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new_file:
            w.writeheader()
        cur = start
        while cur <= latest and time.time() - t0 < budget_s:
            end = min(cur + cfg["range"] - 1, latest)
            logs = rpc(url, "eth_getLogs", [{"fromBlock": hex(cur), "toBlock": hex(end), "address": cfg["bridge"]}])
            for lg in logs:
                row = parse(chain, lg, ts_cache, url)
                w.writerow(row)
                rows.append(row)
            cur = end + 1
            state[chain] = cur
            write_json("bridge/state.json", state)  # checkpoint so a timeout can resume
    print(f"[bridge:{chain}] scanned to {state[chain]} / {latest}, +{len(rows)} events")
    return rows


if __name__ == "__main__":
    for c in CHAINS:
        scan(c)
