// All data access. REST + explorer go through the Vercel/Vite proxy (/px/*),
// history comes straight from the `data` branch on GitHub, and live data is a
// direct browser websocket to PopDex.

export const DATA_BASE = import.meta.env.VITE_DATA_BASE || "https://raw.githubusercontent.com/eferbarn/PopDex_Minor_Insights/data/";
export const WS_URL = "wss://ws.popdex.xyz/v1/ws/public";
export const PROTOCOL_VAULT = "0xffffffffffffffffffffffffffffffffffffffff";
export const PROTOCOL_MM = "0xfffffffffffffffffffffffffffffffffffffffa";
export const INSURANCE_FUNDS = ["0xfffffffffffffffffffffffffffffffffffffff7", "0xfffffffffffffffffffffffffffffffffffffffc", "0xfffffffffffffffffffffffffffffffffffffffd"];

const cache = new Map();

export async function rest(path, params = {}) {
  const url = "/px/api" + path + "?" + new URLSearchParams(params);
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url);
  const j = await r.json();
  if (String(j.code) !== "200") throw new Error(`${path}: ${j.code} ${j.msg}`);
  cache.set(url, j);
  return j;
}

export async function explorer(path) {
  const r = await fetch("/px/explorer" + path);
  const j = await r.json();
  if (String(j.code) !== "200") throw new Error(`explorer ${path}: ${j.msg}`);
  return j.data;
}

export async function paginate(path, params = {}, maxPages = 20) {
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const j = await rest(path, { ...params, limit: 100, ...(cursor ? { cursor } : {}) });
    out.push(...(j.data || []));
    cursor = j.cursor;
    if (!j.data || j.data.length < 100 || !cursor) break;
  }
  return out;
}

export async function symbols() {
  const j = await rest("/config/symbols", { category: "Futures", limit: 100 });
  return j.data;
}

export async function candles(symbol, interval = "1D", limit = 1000) {
  const j = await rest("/public/market/candles", { category: "Futures", symbol, interval, type: "Market", limit });
  // rows: [ts, open, high, low, close, volume(base), turnover(quote)]
  return (j.data || []).map((r) => ({ ts: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], q: +r[6] }));
}

// ---- data branch --------------------------------------------------------

export async function dataText(rel) {
  const r = await fetch(DATA_BASE + rel, { cache: "no-cache" });
  if (!r.ok) return null;
  return r.text();
}

export async function dataJsonl(rel) {
  const t = await dataText(rel);
  if (!t) return [];
  return t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export async function dataJson(rel, fallback = null) {
  const t = await dataText(rel);
  return t ? JSON.parse(t) : fallback;
}

export async function dataCsv(rel) {
  const t = await dataText(rel);
  if (!t) return [];
  const [head, ...rows] = t.trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v])));
}

export function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

let indexPromise;
export function dataIndex() {
  return (indexPromise ||= dataJson("index.json", { days: {} }));
}

/** Load a per-day jsonl series for the last N days, concatenated, oldest first.
 *  Uses index.json (written by the collectors) to only fetch days that exist. */
export async function dataDays(dir, n = 30) {
  const idx = await dataIndex();
  const want = new Set(lastDays(n));
  const days = (idx.days?.[dir] || []).filter((d) => want.has(d));
  const parts = await Promise.all(days.map((d) => dataJsonl(`${dir}/${d}.jsonl`)));
  return parts.flat();
}

// ---- websocket ------------------------------------------------------------

export function connect(args, onMessage, onStatus = () => {}) {
  let ws, ping, closed = false;
  const open = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      onStatus("live");
      for (let i = 0; i < args.length; i += 25) ws.send(JSON.stringify({ op: "subscribe", args: args.slice(i, i + 25) }));
      ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 30000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const m = JSON.parse(e.data);
      if (m.event) return;
      onMessage(m);
    };
    ws.onclose = () => { clearInterval(ping); if (!closed) { onStatus("reconnecting"); setTimeout(open, 3000); } };
    ws.onerror = () => ws.close();
  };
  open();
  return () => { closed = true; clearInterval(ping); ws && ws.close(); };
}

// ---- formatting -----------------------------------------------------------

export const fmtUsd = (n, d = 0) => (n == null || isNaN(n) ? "–" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
/** $1.5M / $100K / $980 — the short form the design system uses in chips, tiles and axes. */
export function fmtShort(n, prefix = "$") {
  if (n == null || isNaN(n)) return "–";
  const a = Math.abs(+n), sign = +n < 0 ? "-" : "";
  const [div, suf] = a >= 999.5e6 ? [1e9, "B"] : a >= 999.5e3 ? [1e6, "M"] : a >= 999.5 ? [1e3, "K"] : [1, ""];
  const v = a / div;
  const str = (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
  return sign + prefix + str + suf;
}
export const fmtK = (n) => fmtShort(n, "");
export const fmtNum = (n, d = 2) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }));
export const fmtPct = (n, d = 2) => (n == null || isNaN(n) ? "–" : (n * 100).toFixed(d) + "%");
export const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
export const fmtTime = (ts) => new Date(+ts).toISOString().slice(11, 19);
