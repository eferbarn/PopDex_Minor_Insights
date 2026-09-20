// Live: renders the global store (see live.js) — nothing here opens a socket,
// so switching pages never loses the session.
import { fmtUsd, fmtNum, short, fmtTime } from "../api.js";
import { live, onLive, resetLive, WHALE_USD } from "../live.js";
import { tile, card, pageHead } from "../main.js";
import { skelFeed } from "../loading.js";

const sideTag = (isLong) => `<span class="side ${isLong ? "up" : "down"}">${isLong ? "long" : "short"}</span>`;

export default async function livePage(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = pageHead("00 / LIVE", "What the exchange is doing <em class='tint'>right now</em>",
    "Straight from PopDex's public websocket into this tab. The session keeps accumulating while you browse the other pages and survives a reload; it resets when you close the tab or press reset.",
    `<button class="pd-btn pd-btn--ghost pd-btn--sm" id="reset">Reset session</button>`) +
    `<div class="tiles" id="tiles"></div>
     <div class="grid">
       ${card("Liquidation feed", `<div class="feed" id="liq"></div>`, { hint: "public · with wallet" })}
       ${card("Whale tape", `<div class="feed" id="whales"></div>`, { hint: `fills ≥ ${fmtUsd(WHALE_USD)}` })}
       ${card("Buy / sell imbalance by symbol", `<div class="tbl" id="imb"></div>`, { wide: true, hint: "this session" })}
     </div>`;

  const render = () => {
    const s = live.state;
    const mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    $("tiles").innerHTML =
      tile("Session", `${mins} <span class="unit">min</span>`, `since ${new Date(s.startedAt).toISOString().slice(11, 16)} UTC`) +
      tile("Liquidations", s.stats.liq, `${fmtUsd(s.stats.liqUsd)} notional`) +
      tile("Trades", s.stats.trades.toLocaleString("en-US"), `${fmtUsd(s.stats.vol)} volume`) +
      tile("Whale fills", s.stats.whale, `≥ ${fmtUsd(WHALE_USD)}`) +
      tile("Repeat liquidated", Object.values(s.repeat).filter((n) => n > 1).length, "wallets hit more than once");

    $("liq").innerHTML = s.liquidations.length ? s.liquidations.slice(0, 150).map((d, i) =>
      `<div class="${i === 0 ? "new" : ""}"><span class="t">${fmtTime(d.ts)}</span>${sideTag(d.side === "Buy")}<span class="sym">${d.symbol}</span><span>${fmtNum(d.amount, 4)} @ ${d.price}</span><b>${fmtUsd(d.usd)}</b><span class="dim">${+d.remainAmount > 0 ? "partial" : "full"}</span><span class="addr">${short(d.walletId)}${d.n > 1 ? ` ×${d.n}` : ""}</span></div>`).join("")
      : `<div class="empty"><span class="ld-chip"><span class="live-dot" aria-hidden="true"></span>Waiting for the next liquidation</span><br><span class="dim" style="display:block;margin-top:10px">They are rare in quiet hours — leave the tab open.</span></div>`;

    $("whales").innerHTML = s.whales.length ? s.whales.slice(0, 150).map((d, i) =>
      `<div class="${i === 0 ? "new" : ""}"><span class="t">${fmtTime(d.createdAt)}</span><span class="side ${d.side === "Buy" ? "up" : "down"}">${d.side}</span><span class="sym">${d.s}</span><span>${fmtNum(d.size, 4)} @ ${d.price}</span><b>${fmtUsd(d.usd)}</b><span class="dim">blk ${d.block}</span></div>`).join("")
      : `<div class="empty"><span class="ld-chip"><span class="live-dot" aria-hidden="true"></span>Watching ${Object.keys(live.state.prices).length || "all"} markets</span><br><span class="dim" style="display:block;margin-top:10px">No fill ≥ ${fmtUsd(WHALE_USD)} yet.</span></div>`;

    const rows = Object.entries(s.bySym).sort((a, b) => b[1].buy + b[1].sell - (a[1].buy + a[1].sell)).slice(0, 25);
    $("imb").innerHTML = rows.length ? `<table><tr><th>Symbol</th><th>Trades</th><th>Buy</th><th>Sell</th><th>Imbalance</th></tr>` +
      rows.map(([sym, r]) => { const imb = (r.buy - r.sell) / (r.buy + r.sell || 1); return `<tr><td class="sym">${sym}</td><td>${r.n}</td><td>${fmtUsd(r.buy)}</td><td>${fmtUsd(r.sell)}</td><td class="${imb >= 0 ? "up" : "down"}">${(imb * 100).toFixed(0)}%</td></tr>`; }).join("") + `</table>`
      : skelFeed(6);
  };

  $("reset").onclick = () => { resetLive(); render(); };
  render();
  const off = onLive(render);
  const tick = setInterval(render, 30000); // keep the "session minutes" tile honest
  return () => { off(); clearInterval(tick); };
}
