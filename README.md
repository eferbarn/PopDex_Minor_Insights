# PopDex Minor Insights

Analytics for [PopDEX](https://app.popdex.xyz) (perp DEX on Morph Tachyon) with **no backend and no database**.

- `site/` — static Vite + ECharts site (Vercel). Live data comes straight from PopDex's public websocket in the browser; REST calls go through Vercel rewrites (PopDex's API has no CORS headers); history is read from the `data` branch of this repo.
- `collector/` — two GitHub Actions jobs ("git scraping") that append small JSONL/CSV files to the `data` branch:
  - `snapshot.yml` every 10 min: insurance-fund equity, protocol-vault NAV/TVL/positions, per-symbol OI/funding/volume, explorer tx counts, bridge deposits/withdrawals (Arbitrum + Morph), a 600-block on-chain sample (active accounts, UI vs bot, cancel ratio).
  - `listener.yml` every 5 h, runs ~5 h 50 min: public liquidations (with wallet id — PopDex keeps **no history** of these), whale fills, protocol-vault / insurance-fund fills, hourly per-symbol buy/sell aggregates. Consecutive runs overlap on purpose; the site de-duplicates.
- `popdex/` + `scripts/` — event decoder for the Tachyon precompiles and a block sampler used for exploration.

## Branches

| branch | contents |
|---|---|
| `main` | code: site, collectors, workflows |
| `data` | auto-generated data files only (orphan branch, created by the first workflow run) |

## Setup

1. Repo must be **public** (unlimited Actions minutes; `raw.githubusercontent.com` reads need it).
2. Push `main`. Actions run on schedule; trigger `snapshot` and `listener` once manually from the Actions tab to create the `data` branch. The first `snapshot` run backfills bridge history (~a few minutes).
3. Vercel: import the repo, set **Root Directory = `site`**, framework Vite. `site/vercel.json` holds the API rewrites.

## Local

```bash
python3 -m venv .venv && .venv/bin/pip install -r collector/requirements.txt
DATA_DIR=$PWD/data_local .venv/bin/python collector/snapshot.py      # one snapshot into ./data_local
DATA_DIR=$PWD/data_local .venv/bin/python collector/listener.py --seconds 60
.venv/bin/python scripts/sample_blocks.py --blocks 1000               # what the chain looks like right now

cd site && npm install && npm run dev                                 # http://localhost:5173
# to point the site at local data: ln -s ../../data_local site/public/data-local && echo VITE_DATA_BASE=/data-local/ > site/.env.local
```

## Data layout (`data` branch)

```
index.json                      {dir: [days]} written on every publish
snapshots/YYYY-MM-DD.jsonl      one row per 10 min
vault_positions/YYYY-MM-DD.jsonl
active_accounts/YYYY-MM-DD.jsonl
liquidations/YYYY-MM-DD.jsonl   raw websocket events (+recv time); may contain duplicates from overlapping listeners
whale_fills/YYYY-MM-DD.jsonl    publicTrade fills >= $25k
vault_fills/YYYY-MM-DD.jsonl    fills of 0xff..ffff / 0xff..fffa / insurance funds
trade_hourly/YYYY-MM-DD.jsonl   per symbol per hour: n, buy, sell, max, size buckets (partial rows possible at job end; take max n per (ts,s))
bridge/arbitrum.csv, bridge/morph.csv, bridge/state.json
explorer_daily.json             chain tx count per day
```

## Things learned about the data (not in the docs)

- Tachyon RPC: `eth_getLogs` max 3 blocks per call and ignores address/topic filters; needs a non-Python `User-Agent`; 1200 req/min/IP.
- Fills, liquidations and positions are **not** on-chain events. Only order create/cancel, trigger orders, account, vault, referral and bridge-withdraw events are.
- The public websocket serves `position` / `fill` / `order` channels for **any** wallet without auth. `publicTrade` with `symbol: "default"` only acks — subscribe per symbol.
- Protocol vault `0xff…ffff` trades through sub-account `0xff…fffa`, which is most of the order flow. Insurance funds: `0xff…fff7`, `…fffc`, `…fffd`.
- UI orders have `clientOid` starting with `PPD` and carry a 0.058% builder fee to `0xe408…8455`; API bots use numeric client ids.
- Explorer REST (no auth): `https://app.popdex.xyz/web/v1/explorer/{overview,blocks,transactions,block/N,tx/HASH,address/ADDR}`.
- Bridge (Arbitrum `0x0B15…C5f2`, Morph `0x71FB…F71d`) event layout was reverse-engineered from logs; see `collector/bridge.py`.
