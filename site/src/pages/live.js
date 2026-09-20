// Live page: everything here is a direct browser websocket — nothing stored.
import { connect, symbols, fmtUsd, fmtNum, short, fmtTime } from "../api.js";
import { setStatus } from "../main.js";

const WHALE_USD = 25000;

export default async function live(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="k">Liquidations (session)</div><div class="v" id="t-liq">0</div></div>
      <div class="tile"><div class="k">Liquidated notional</div><div class="v" id="t-liq-usd">$0</div></div>
      <div class="tile"><div class="k">Trades (session)</div><div class="v" id="t-trades">0</div></div>
      <div class="tile"><div class="k">Volume (session)</div><div class="v" id="t-vol">$0</div></div>
      <div class="tile"><div class="k">Whale fills ≥ $25k</div><div class="v" id="t-whale">0</div></div>
    </div>
    <div class="grid">
      <div class="panel"><h3>Liquidation feed <span class="muted">(public, with wallet)</span></h3><div class="feed" id="liq"><div class="empty">waiting for the next liquidation…</div></div></div>
      <div class="panel"><h3>Whale tape</h3><div class="feed" id="whales"><div class="empty">no fills ≥ $${WHALE_USD.toLocaleString()} yet</div></div></div>
      <div class="panel wide"><h3>Buy / sell imbalance by symbol (session)</h3><div id="imb"><div class="empty">collecting…</div></div></div>
    </div>`;

  const syms = (await symbols()).filter((s) => s.status === "Trading");
  const prices = Object.fromEntries(syms.map((s) => [s.symbol, 0]));
  const stats = { liq: 0, liqUsd: 0, trades: 0, vol: 0, whale: 0 };
  const bySym = {};
  const repeat = {};

  const args = [{ category: "Futures", topic: "liquidation" }, ...syms.map((s) => ({ category: "Futures", topic: "publicTrade", symbol: s.symbol }))];

  const push = (id, html, max = 200) => {
    const el = $(id);
    if (el.firstElementChild?.classList.contains("empty")) el.innerHTML = "";
    const div = document.createElement("div");
    div.className = "new";
    div.innerHTML = html;
    el.prepend(div);
    while (el.children.length > max) el.lastChild.remove();
  };
  const set = (id, v) => ($(id).textContent = v);

  let dirty = false;
  const renderImb = () => {
    const rows = Object.entries(bySym).sort((a, b) => b[1].buy + b[1].sell - (a[1].buy + a[1].sell)).slice(0, 20);
    $("imb").innerHTML = `<table><tr><th>Symbol</th><th>Trades</th><th>Buy</th><th>Sell</th><th>Imbalance</th></tr>` +
      rows.map(([s, r]) => {
        const imb = (r.buy - r.sell) / (r.buy + r.sell || 1);
        return `<tr><td>${s}</td><td>${r.n}</td><td>${fmtUsd(r.buy)}</td><td>${fmtUsd(r.sell)}</td><td class="${imb >= 0 ? "up" : "down"}">${(imb * 100).toFixed(0)}%</td></tr>`;
      }).join("") + `</table>`;
  };
  const timer = setInterval(() => { if (dirty) { renderImb(); dirty = false; } }, 2000);

  const stop = connect(args, (m) => {
    const topic = m.arg?.topic;
    if (topic === "liquidation") {
      for (const d of m.data || []) {
        const usd = +d.amount * +d.price;
        stats.liq++; stats.liqUsd += usd;
        repeat[d.walletId] = (repeat[d.walletId] || 0) + 1;
        const kind = +d.remainAmount > 0 ? "partial" : "full";
        push("liq", `<span class="muted">${fmtTime(d.ts)}</span> <b class="${d.side === "Buy" ? "up" : "down"}">${d.side === "Buy" ? "LONG" : "SHORT"}</b> ${d.symbol} ${fmtNum(d.amount, 4)} @ ${d.price} = <b>${fmtUsd(usd)}</b> <span class="muted">${kind}</span> <span class="addr">${short(d.walletId)}${repeat[d.walletId] > 1 ? ` ×${repeat[d.walletId]}` : ""}</span>`);
      }
      set("t-liq", stats.liq); set("t-liq-usd", fmtUsd(stats.liqUsd));
    } else if (topic === "publicTrade") {
      const s = m.arg.symbol;
      for (const d of m.data || []) {
        const usd = +d.price * +d.size;
        prices[s] = +d.price;
        stats.trades++; stats.vol += usd;
        const r = (bySym[s] ||= { n: 0, buy: 0, sell: 0 });
        r.n++; r[d.side === "Buy" ? "buy" : "sell"] += usd;
        dirty = true;
        if (usd >= WHALE_USD) {
          stats.whale++;
          push("whales", `<span class="muted">${fmtTime(d.createdAt)}</span> <b class="${d.side === "Buy" ? "up" : "down"}">${d.side.toUpperCase()}</b> ${s} ${fmtNum(d.size, 4)} @ ${d.price} = <b>${fmtUsd(usd)}</b> <span class="muted">blk ${m.blockNumber}</span>`);
          set("t-whale", stats.whale);
        }
      }
      set("t-trades", stats.trades.toLocaleString()); set("t-vol", fmtUsd(stats.vol));
    }
  }, setStatus);

  return () => { stop(); clearInterval(timer); setStatus(""); };
}
