"""Pull the last N blocks from Morph Tachyon, decode every event, and print
what the chain actually looks like — so we know which insights have data.

usage: .venv/bin/python scripts/sample_blocks.py [--blocks 1000]
"""
import argparse
import sys
import os
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from eth_utils import keccak
from popdex.rpc import Tachyon
from popdex.events import decode_log, CONTRACTS

FUNCTIONS = [
    "placeOrder(address,bytes32,uint16,bytes32,uint256,uint256,uint256,address,uint256)",
    "placeOrderWithTpsl(address,bytes32,uint16,bytes32,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,uint256)",
    "cancelOrder(address,uint128,bytes32)",
    "cancelAllOrders(address,uint16,(bool,uint8),(bool,uint8),(bool,bool))",
    "cancelPositionTpslOrders(address,uint16,(bool,uint8),(bool,bool))",
    "closeAllPositions(address,uint8,uint16,uint8)",
    "placeTriggerOrder(address,bytes32,uint16,bytes32,uint256,uint256,uint256,address,uint256)",
    "placeTriggerOrderWithTpsl(address,bytes32,uint16,bytes32,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,uint256)",
    "placeTpslOrder(address,bytes32,uint16,bytes32,uint256,uint256,uint256,uint256,uint256,address,uint256)",
    "cancelTriggerOrder(address,uint128,bytes32)",
    "placeReverseOrder(address,uint16,uint8)",
    "noop()",
    "createSubaccount()",
    "approveAgent(address,address,bytes32,uint64,uint64,bool)",
    "revokeAgent(address)",
    "updateLeverage(address,(uint8,uint16,address,uint8))",
    "updatePositionMode(address,uint8)",
    "withdraw(address,uint256,uint256,address)",
    "bind(bytes8)",
    "vaultDeposit(address,address,uint256)",
    "vaultWithdraw(address,address,uint256)",
    "authorizeBuilder(address,uint256,uint256)",
    "transfer(address,address,uint256)",
    "internalTransfer(address,address,address,uint256)",
]
SELECTORS = {"0x" + keccak(text=f).hex()[:8]: f.split("(")[0] for f in FUNCTIONS}


def pct(a, b):
    return f"{100 * a / b:.1f}%" if b else "n/a"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks", type=int, default=1000)
    ap.add_argument("--to", type=int, default=None, help="last block (default: latest)")
    args = ap.parse_args()

    rpc = Tachyon()
    to_block = args.to or rpc.latest_block_number()
    from_block = to_block - args.blocks + 1
    print(f"fetching blocks {from_block}..{to_block} ({args.blocks} blocks)")
    data = rpc.fetch_range(from_block, to_block, progress=lambda d, t: print(f"  {d}/{t} requests", flush=True))
    blocks, logs = data["blocks"], data["logs"]

    # ---- timing
    t0, t1 = int(blocks[0]["timestamp"], 16), int(blocks[-1]["timestamp"], 16)
    span_s = (t1 - t0) / 1000
    print(f"\n== span: {span_s:.0f}s  ({span_s / len(blocks) * 1000:.0f} ms/block)")

    # ---- transactions
    txs = [tx for b in blocks for tx in b["transactions"]]
    tx_by_hash = {tx["hash"]: tx for tx in txs}
    print(f"== txs: {len(txs)}  ({len(txs) / span_s:.1f} tx/s), senders: {len({t['from'] for t in txs})}")
    sel = Counter(SELECTORS.get(t["input"][:10], t["input"][:10]) for t in txs)
    print("   by function:", ", ".join(f"{k}={v}" for k, v in sel.most_common(12)))
    to = Counter(CONTRACTS.get(t["to"], t["to"]) for t in txs)
    print("   by contract:", ", ".join(f"{k}={v}" for k, v in to.most_common()))
    senders = Counter(t["from"] for t in txs)
    top = senders.most_common(5)
    print(f"   top senders: " + ", ".join(f"{a[:8]}…={n} ({pct(n, len(txs))})" for a, n in top))
    print(f"   top-5 senders share of all txs: {pct(sum(n for _, n in top), len(txs))}")
    txs_per_block = Counter(int(t["blockNumber"], 16) for t in txs)
    print(f"   busiest block: {max(txs_per_block.values())} txs, empty blocks: {len(blocks) - len(txs_per_block)}")

    # ---- events
    decoded, unknown = [], Counter()
    for lg in logs:
        d = decode_log(lg)
        if d is None:
            unknown[(CONTRACTS.get(lg["address"], lg["address"]), lg["topics"][0][:12])] += 1
        else:
            d["tx"] = lg["transactionHash"]
            d["block"] = int(lg["blockNumber"], 16)
            decoded.append(d)
    print(f"\n== logs: {len(logs)}  decoded: {len(decoded)}  unknown: {sum(unknown.values())}")
    ev = Counter(d["event"] for d in decoded)
    for k, v in ev.most_common():
        print(f"   {k:28s} {v}")
    if unknown:
        print("   unknown topics:", ", ".join(f"{c}:{t}={n}" for (c, t), n in unknown.most_common()))

    # ---- order behaviour
    creates = [d for d in decoded if d["event"] == "OrderCreate"]
    cancels = [d for d in decoded if d["event"] == "OrderCancel"]
    if creates:
        ok = [c for c in creates if c["args"]["succeeded"]]
        print(f"\n== OrderCreate: {len(creates)}, succeeded {pct(len(ok), len(creates))}")
        print("   status:", dict(Counter(c["args"]["status"] for c in creates)))
        print("   error codes:", dict(Counter(c["args"]["code"] for c in creates if not c["args"]["succeeded"]).most_common(5)))
        market = sum(1 for c in ok if c["args"]["price"] == 0)
        print(f"   market (price=0): {pct(market, len(ok))}, limit: {pct(len(ok) - market, len(ok))}")
        print("   by symbolId:", dict(Counter(c["args"]["symbol"] for c in ok).most_common(10)))
        accts = Counter(c["args"]["account"] for c in ok)
        print(f"   distinct accounts placing orders: {len(accts)}; top-3 share: {pct(sum(n for _, n in accts.most_common(3)), len(ok))}")
        print(f"   cancel/create ratio: {len(cancels) / len(creates):.2f}")
        # agent detection: tx sender != order account
        agent_txs = sum(1 for c in ok if tx_by_hash.get(c["tx"], {}).get("from", "").lower() != c["args"]["account"].lower())
        print(f"   orders signed by an agent key (tx.from != account): {pct(agent_txs, len(ok))}")

    trig = [d for d in decoded if d["event"] == "TriggerOrderCreate"]
    if trig:
        print(f"\n== TriggerOrderCreate: {len(trig)}  types: {dict(Counter(t['args']['orderType'] for t in trig))}")

    # ---- other interesting things
    for name in ["Withdraw", "Transfer", "InternalTransfer", "VaultDeposit", "VaultWithdraw", "CodeBound",
                 "SubaccountCreated", "AgentApproved", "LeverageUpdated", "BuilderAuthorized", "CloseAllPositions"]:
        rows = [d for d in decoded if d["event"] == name]
        if rows:
            print(f"\n== {name}: {len(rows)}")
            for r in rows[:3]:
                print("   ", {k: v for k, v in r["args"].items()})

    # ---- oracle cadence
    oracle_logs = [lg for lg in logs if lg["address"] == "0x0000000000000000000000000000000000001002"]
    if oracle_logs:
        per_block = Counter(int(lg["blockNumber"], 16) for lg in oracle_logs)
        print(f"\n== Oracle logs: {len(oracle_logs)} in {len(per_block)} blocks ({pct(len(per_block), len(blocks))} of blocks)")
        print("   sample topics:", oracle_logs[0]["topics"][:3], "data len", len(oracle_logs[0]["data"]))


if __name__ == "__main__":
    main()
