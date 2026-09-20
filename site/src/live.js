// One websocket for the whole app, opened at boot and never torn down when the
// user switches pages. Everything it has seen is kept in memory and mirrored to
// sessionStorage, so the session survives page navigation and a reload of the
// same tab; it ends when the tab is closed or the user presses "Reset".
import { connect, symbols, PROTOCOL_VAULT, PROTOCOL_MM, INSURANCE_FUNDS } from "./api.js";

const KEY = "popdex-insights-live-v1";
const CAP = 500;        // rows kept per feed
export const WHALE_USD = 25000;

function blank() {
  return {
    startedAt: Date.now(),
    stats: { liq: 0, liqUsd: 0, trades: 0, vol: 0, whale: 0, events: 0 },
    liquidations: [],   // newest first
    whales: [],
    bySym: {},          // symbol -> {n, buy, sell}
    repeat: {},         // walletId -> liquidation count
    vaultFills: [],
    vaultStats: { n: 0, pnl: 0, fee: 0, vol: 0 },
    prices: {},
  };
}

function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY));
    if (s && s.stats && s.liquidations) return s;
  } catch {}
  return blank();
}

export const live = {
  state: load(),
  status: "connecting",
  listeners: new Set(),
  stop: null,
  restored: false,
};

const bus = new EventTarget();
export const onLive = (fn) => { bus.addEventListener("update", fn); return () => bus.removeEventListener("update", fn); };
export const onStatus = (fn) => { bus.addEventListener("status", fn); return () => bus.removeEventListener("status", fn); };

let dirty = false, saveTimer = null;
function touch() {
  dirty = true;
  if (!saveTimer) saveTimer = setTimeout(flush, 1500);
}
function flush() {
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  bus.dispatchEvent(new Event("update"));
  try { sessionStorage.setItem(KEY, JSON.stringify(live.state)); } catch {}
}

export function resetLive() {
  live.state = blank();
  try { sessionStorage.removeItem(KEY); } catch {}
  bus.dispatchEvent(new Event("update"));
}

const push = (arr, row) => { arr.unshift(row); if (arr.length > CAP) arr.length = CAP; };

function handle(m) {
  const s = live.state;
  const topic = m.arg?.topic;
  if (topic === "liquidation") {
    for (const d of m.data || []) {
      const usd = +d.amount * +d.price;
      s.stats.liq++; s.stats.liqUsd += usd; s.stats.events++;
      s.repeat[d.walletId] = (s.repeat[d.walletId] || 0) + 1;
      push(s.liquidations, { ...d, usd, n: s.repeat[d.walletId] });
    }
  } else if (topic === "publicTrade") {
    const sym = m.arg.symbol;
    for (const d of m.data || []) {
      const usd = +d.price * +d.size;
      s.prices[sym] = +d.price;
      s.stats.trades++; s.stats.vol += usd; s.stats.events++;
      const r = (s.bySym[sym] ||= { n: 0, buy: 0, sell: 0 });
      r.n++; r[d.side === "Buy" ? "buy" : "sell"] += usd;
      if (usd >= WHALE_USD) { s.stats.whale++; push(s.whales, { s: sym, usd, block: m.blockNumber, ...d }); }
    }
  } else if (topic === "fill") {
    const w = m.arg.walletId.toLowerCase();
    for (const d of m.data || []) {
      const fee = (d.feeDetail || []).reduce((a, f) => a + +f.fee, 0);
      s.vaultStats.n++; s.vaultStats.pnl += +d.execPnl || 0; s.vaultStats.fee += fee; s.vaultStats.vol += +d.execValue || 0; s.stats.events++;
      push(s.vaultFills, { w, fee, symbol: d.symbol, side: d.side, execQty: d.execQty, execPrice: d.execPrice, execValue: d.execValue, execPnl: d.execPnl, liquidation: d.liquidation, orderType: d.orderType, tradeScope: d.tradeScope, ts: d.updatedAt || Date.now() });
    }
  } else return;
  touch();
}

export async function startLive() {
  if (live.stop) return;
  const syms = (await symbols()).filter((x) => x.status === "Trading").map((x) => x.symbol);
  const args = [
    { category: "Futures", topic: "liquidation" },
    ...[PROTOCOL_MM, PROTOCOL_VAULT, ...INSURANCE_FUNDS].map((w) => ({ walletId: w, topic: "fill" })),
    ...syms.map((symbol) => ({ category: "Futures", topic: "publicTrade", symbol })),
  ];
  live.stop = connect(args, handle, (st) => { live.status = st; bus.dispatchEvent(new Event("status")); });
  window.addEventListener("pagehide", flush);
}
