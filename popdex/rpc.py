"""Thin JSON-RPC client for Morph Tachyon (PopDEX chain).

Quirks found by testing:
- needs a non-python User-Agent or Cloudflare returns 403
- eth_getLogs accepts at most 3 blocks per call and ignores address/topics filters
- 1200 requests / minute / IP, all methods weight 1
"""
import gzip
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

RPC_URL = "https://api.popdex.xyz/api/v1/web3/rpc"
MAX_LOGS_RANGE = 3
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw")


class RateLimiter:
    def __init__(self, per_minute=1100):
        self.interval = 60.0 / per_minute
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            if now < self.next_at:
                time.sleep(self.next_at - now)
                now = time.monotonic()
            self.next_at = now + self.interval


class Tachyon:
    def __init__(self, url=RPC_URL, per_minute=1100, workers=8):
        self.url = url
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json", "User-Agent": "popdex-insights/0.1"})
        self.limiter = RateLimiter(per_minute)
        self.workers = workers

    def call(self, method, params, retries=5):
        for attempt in range(retries):
            self.limiter.wait()
            r = self.session.post(self.url, data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": "1"}), timeout=30)
            if r.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                raise RuntimeError(f"{method}{params}: {body['error']}")
            return body["result"]
        raise RuntimeError(f"{method}: rate limited after {retries} retries")

    def latest_block_number(self):
        return int(self.call("eth_blockNumber", []), 16)

    def block(self, number, full_txs=True):
        return self.call("eth_getBlockByNumber", [hex(number), full_txs])

    def logs(self, from_block, to_block):
        assert to_block - from_block + 1 <= MAX_LOGS_RANGE
        return self.call("eth_getLogs", [{"fromBlock": hex(from_block), "toBlock": hex(to_block)}])

    def fetch_range(self, from_block, to_block, progress=None):
        """Blocks (with txs) + logs for [from_block, to_block]. Cached to data/raw as gzip json."""
        os.makedirs(CACHE_DIR, exist_ok=True)
        path = os.path.join(CACHE_DIR, f"blocks_{from_block}_{to_block}.json.gz")
        if os.path.exists(path):
            with gzip.open(path, "rt") as f:
                return json.load(f)
        numbers = list(range(from_block, to_block + 1))
        chunks = [(n, min(n + MAX_LOGS_RANGE - 1, to_block)) for n in range(from_block, to_block + 1, MAX_LOGS_RANGE)]
        done = [0]

        def tick():
            done[0] += 1
            if progress and done[0] % 100 == 0:
                progress(done[0], len(numbers) + len(chunks))

        with ThreadPoolExecutor(self.workers) as ex:
            def get_block(n):
                b = self.block(n); tick(); return b
            def get_logs(c):
                l = self.logs(*c); tick(); return l
            blocks = list(ex.map(get_block, numbers))
            logs = [l for chunk in ex.map(get_logs, chunks) for l in chunk]
        out = {"from": from_block, "to": to_block, "blocks": blocks, "logs": logs}
        with gzip.open(path, "wt") as f:
            json.dump(out, f)
        return out
