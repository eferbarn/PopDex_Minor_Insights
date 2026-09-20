// Markets: daily volume crypto vs RWA (1D candles for every symbol), current OI / funding table.
import { symbols, paginate, candles, fmtUsd, fmtPct, fmtNum } from "../api.js";
import { chart, tile, card, pageHead, C } from "../main.js";

export default async function markets(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = pageHead("01 / MARKETS", "Volume, open interest and <em class='tint'>funding</em>", "Every futures market on PopDex since launch, from the public candle and ticker endpoints.") +
    `<div class="tiles" id="tiles"></div>
     <div class="grid">
       ${card("Daily volume — crypto vs RWA", `<div class="chart" id="vol"></div>`, { wide: true, hint: "USDT turnover" })}
       ${card("Share of volume by symbol", `<div class="chart" id="share"></div>`, { hint: "last 7 days" })}
       ${card("RWA share of daily volume", `<div class="chart" id="rwa"></div>`, { hint: "%" })}
       ${card("Open interest & funding", `<div class="tbl" id="oi"></div>`, { wide: true, hint: "now" })}
     </div>`;

  const syms = (await symbols()).filter((s) => s.status === "Trading");
  const tickers = await paginate("/public/market/tickers", { category: "Futures" });
  const cls = Object.fromEntries(syms.map((s) => [s.symbol, s.assetClass]));

  const tot24 = tickers.reduce((a, t) => a + +t.turnover24h, 0);
  const rwa24 = tickers.filter((t) => cls[t.symbol] === "Rwa").reduce((a, t) => a + +t.turnover24h, 0);
  const oiUsd = tickers.reduce((a, t) => a + +t.openInterest * +t.markPrice, 0);
  $("tiles").innerHTML = tile("Markets", syms.length, `${syms.filter((s) => s.assetClass === "Rwa").length} RWA · ${syms.length - syms.filter((s) => s.assetClass === "Rwa").length} crypto`) +
    tile("24h volume", fmtUsd(tot24)) + tile("RWA share", fmtPct(rwa24 / tot24, 1), "of 24h volume") + tile("Open interest", fmtUsd(oiUsd), "mark value");

  const daily = {};
  for (let i = 0; i < syms.length; i += 12) {
    await Promise.all(syms.slice(i, i + 12).map(async (s) => (daily[s.symbol] = await candles(s.symbol, "1D", 200))));
  }
  const days = [...new Set(Object.values(daily).flat().map((c) => c.ts))].sort((a, b) => a - b);
  const sum = (cl) => days.map((d) => Object.entries(daily).filter(([s]) => cls[s] === cl).reduce((a, [, cs]) => a + (cs.find((c) => c.ts === d)?.q || 0), 0));
  const crypto = sum("Crypto"), rwa = sum("Rwa");
  const labels = days.map((d) => new Date(d).toISOString().slice(0, 10));
  chart($("vol"), {
    xAxis: { type: "category", data: labels }, yAxis: { type: "value", axisLabel: { formatter: (v) => "$" + (v / 1e6).toFixed(0) + "M" } }, legend: { top: 0 },
    series: [{ name: "Crypto", type: "bar", stack: "v", data: crypto, itemStyle: { color: C.grey2 } }, { name: "RWA", type: "bar", stack: "v", data: rwa, itemStyle: { color: C.brand } }],
  });
  chart($("rwa"), {
    xAxis: { type: "category", data: labels }, yAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
    series: [{ type: "line", data: days.map((_, i) => +((100 * rwa[i]) / ((rwa[i] + crypto[i]) || 1)).toFixed(1)), areaStyle: { color: "rgba(128,119,255,0.15)" }, lineStyle: { color: C.brand } }],
  });
  const last7 = days.slice(-7);
  const share = Object.entries(daily).map(([s, cs]) => [s, cs.filter((c) => last7.includes(c.ts)).reduce((a, c) => a + c.q, 0)]).sort((a, b) => b[1] - a[1]);
  const top = share.slice(0, 10), rest = share.slice(10).reduce((a, [, v]) => a + v, 0);
  chart($("share"), {
    tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${fmtUsd(p.value)} (${p.percent}%)` },
    color: [C.brand, "#6f66e6", "#5e57c4", "#4f4aa3", "#434083", C.tint, "#8c8fa3", "#6c6f75", "#54575f", "#3f4249", C.grey2],
    series: [{ type: "pie", radius: ["45%", "78%"], itemStyle: { borderColor: "#0b0b0d", borderWidth: 2 }, data: [...top.map(([n, v]) => ({ name: n, value: v })), { name: "other", value: rest }], label: { color: "#a0a3a7", fontSize: 11 } }],
  });

  const rows = tickers.map((t) => ({ ...t, oiUsd: +t.openInterest * +t.markPrice, cls: cls[t.symbol] })).sort((a, b) => b.oiUsd - a.oiUsd);
  $("oi").innerHTML = `<table><tr><th>Symbol</th><th>Class</th><th>Last</th><th>OI (USD)</th><th>Funding (1h)</th><th>Annualized</th><th>24h vol</th></tr>` +
    rows.map((t) => `<tr><td class="sym">${t.symbol}</td><td class="dim">${t.cls}</td><td>${fmtNum(t.lastPrice, 4)}</td><td>${fmtUsd(t.oiUsd)}</td><td class="${+t.fundingRate >= 0 ? "up" : "down"}">${fmtPct(+t.fundingRate, 4)}</td><td>${fmtPct(+t.fundingRate * 24 * 365, 1)}</td><td>${fmtUsd(t.turnover24h)}</td></tr>`).join("") + `</table>`;
}
