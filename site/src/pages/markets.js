// Markets: daily volume crypto vs RWA (1D candles for every symbol), current OI / funding table.
import { symbols, paginate, candles, fmtUsd, fmtPct, fmtNum } from "../api.js";
import { chart } from "../main.js";

export default async function markets(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = `
    <div class="tiles" id="tiles"></div>
    <div class="grid">
      <div class="panel wide"><h3>Daily volume — crypto vs RWA (USDT)</h3><div class="chart" id="vol"></div></div>
      <div class="panel wide"><h3>Share of volume by symbol (last 7 days)</h3><div class="chart" id="share"></div></div>
      <div class="panel wide"><h3>Open interest & funding (now)</h3><div id="oi"></div></div>
    </div>`;

  const syms = (await symbols()).filter((s) => s.status === "Trading");
  const tickers = await paginate("/public/market/tickers", { category: "Futures" });
  const cls = Object.fromEntries(syms.map((s) => [s.symbol, s.assetClass]));

  const tot24 = tickers.reduce((a, t) => a + +t.turnover24h, 0);
  const rwa24 = tickers.filter((t) => cls[t.symbol] === "Rwa").reduce((a, t) => a + +t.turnover24h, 0);
  const oiUsd = tickers.reduce((a, t) => a + +t.openInterest * +t.markPrice, 0);
  $("tiles").innerHTML = [
    ["Symbols", `${syms.length} <span class="muted">(${syms.filter((s) => s.assetClass === "Rwa").length} RWA)</span>`],
    ["24h volume", fmtUsd(tot24)],
    ["RWA share (24h)", fmtPct(rwa24 / tot24, 1)],
    ["Open interest", fmtUsd(oiUsd)],
  ].map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  // daily candles for all symbols, in parallel batches to stay under the rate limit (weight 2 each)
  const daily = {};
  for (let i = 0; i < syms.length; i += 12) {
    await Promise.all(syms.slice(i, i + 12).map(async (s) => (daily[s.symbol] = await candles(s.symbol, "1D", 200))));
  }
  const days = [...new Set(Object.values(daily).flat().map((c) => c.ts))].sort((a, b) => a - b);
  const sum = (cl) => days.map((d) => Object.entries(daily).filter(([s]) => cls[s] === cl).reduce((a, [, cs]) => a + (cs.find((c) => c.ts === d)?.q || 0), 0));
  chart($("vol"), {
    xAxis: { type: "category", data: days.map((d) => new Date(d).toISOString().slice(0, 10)) },
    yAxis: { type: "value", axisLabel: { formatter: (v) => "$" + (v / 1e6).toFixed(0) + "M" } },
    legend: { top: 0 },
    series: [
      { name: "Crypto", type: "bar", stack: "v", data: sum("Crypto") },
      { name: "RWA", type: "bar", stack: "v", data: sum("Rwa") },
    ],
  });

  const last7 = days.slice(-7);
  const share = Object.entries(daily).map(([s, cs]) => [s, cs.filter((c) => last7.includes(c.ts)).reduce((a, c) => a + c.q, 0)]).sort((a, b) => b[1] - a[1]);
  const top = share.slice(0, 12), rest = share.slice(12).reduce((a, [, v]) => a + v, 0);
  chart($("share"), {
    tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${fmtUsd(p.value)} (${p.percent}%)` },
    series: [{ type: "pie", radius: ["40%", "75%"], data: [...top.map(([n, v]) => ({ name: n, value: v })), { name: "other", value: rest }], label: { color: "#c9cddb" } }],
  });

  const rows = tickers.map((t) => ({ ...t, oiUsd: +t.openInterest * +t.markPrice, cls: cls[t.symbol] })).sort((a, b) => b.oiUsd - a.oiUsd);
  $("oi").innerHTML = `<table><tr><th>Symbol</th><th>Class</th><th>Last</th><th>OI (USD)</th><th>Funding (1h)</th><th>Annualized</th><th>24h vol</th></tr>` +
    rows.map((t) => `<tr><td>${t.symbol}</td><td class="muted">${t.cls}</td><td>${fmtNum(t.lastPrice, 4)}</td><td>${fmtUsd(t.oiUsd)}</td><td class="${+t.fundingRate >= 0 ? "up" : "down"}">${fmtPct(+t.fundingRate, 4)}</td><td>${fmtPct(+t.fundingRate * 24 * 365, 1)}</td><td>${fmtUsd(t.turnover24h)}</td></tr>`).join("") + `</table>`;
}
