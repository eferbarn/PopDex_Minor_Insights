// Weekend Oracle: RWA perps keep trading while the underlying market is closed,
// priced only by PopDex's own book. How well does the weekend price predict
// the real reopen?  All from 1H candles — no external data needed.
import { symbols, candles, fmtPct, fmtUsd, fmtShort } from "../api.js";
import { chart, tile, card, pageHead, C } from "../main.js";
import { skelTiles, skelTable, chartLoading } from "../loading.js";

const H = 3600e3;
// reopen (UTC hour of the first candle after the underlying market reopens)
function reopenOf(sym) {
  if (/^(XAU|XAG|BZ)/.test(sym)) return { day: 0, hour: 23 };   // London metals / Brent: Sun 23:00 UTC
  if (/^(CL|US500|TECH100)/.test(sym)) return { day: 0, hour: 22 }; // CME Globex: Sun 22:00 UTC
  return { day: 1, hour: 14 };                                       // US stocks / ETFs: Mon after 13:30 UTC open
}

function weekends(cs, sym) {
  const by = new Map(cs.map((c) => [c.ts, c]));
  const re = reopenOf(sym);
  const out = [];
  for (const c of cs) {
    const d = new Date(c.ts);
    if (d.getUTCDay() !== 5 || d.getUTCHours() !== 20) continue; // Friday 20:00 UTC = last "real" print
    const fri = c.c;
    const satStart = c.ts + 4 * H;
    const wkEnd = c.ts + (48 + 1) * H; // Sunday 21:00 UTC
    const wkLast = by.get(c.ts + 48 * H); // Sunday 20:00 UTC candle
    const reopenTs = c.ts + ((re.day === 0 ? 2 : 3) * 24 + (re.hour - 20)) * H;
    const open = by.get(reopenTs);
    if (!wkLast || !open) continue;
    let vol = 0, n = 0;
    for (let t = satStart; t < wkEnd; t += H) { const x = by.get(t); if (x) { vol += x.q; n += x.v > 0 ? 1 : 0; } }
    out.push({ sym, week: new Date(c.ts).toISOString().slice(0, 10), fri, wk: wkLast.c, open: open.c,
      move: wkLast.c / fri - 1, realized: open.c / fri - 1, error: open.c / wkLast.c - 1, vol, activeHours: n });
  }
  return out;
}

export default async function weekend(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = pageHead("02 / WEEKEND ORACLE", "When the real market sleeps, <em class='tint'>who sets the price?</em>",
    "RWA futures keep trading while the underlying market is closed, priced only by the PopDex order book. Each point is one symbol-weekend: x = where the weekend book moved the price, y = where the underlying actually reopened. Points on the diagonal mean the weekend market was right.") +
    `<div class="tiles" id="tiles">${skelTiles(4)}</div>
     <div class="grid">
       ${card("Weekend move vs realized reopen move", `<div class="chart" id="sc" style="height:400px"></div>`, { wide: true, hint: "one dot per symbol-weekend · size = weekend volume" })}
       ${card("Per symbol-weekend", `<div class="tbl" id="tbl">${skelTable(8, 10)}</div>`, { wide: true })}
     </div>`;
  const ld = chartLoading($("sc"), "Loading hourly candles");
  const rwa = (await symbols()).filter((s) => s.assetClass === "Rwa" && s.status === "Trading");
  const rows = [];
  let done = 0;
  for (let i = 0; i < rwa.length; i += 10) {
    await Promise.all(rwa.slice(i, i + 10).map(async (s) => { rows.push(...weekends(await candles(s.symbol, "1H", 1000), s.symbol)); ld.progress(++done, rwa.length); }));
  }
  ld.done();
  rows.sort((a, b) => b.week.localeCompare(a.week) || b.vol - a.vol);
  if (!rows.length) { $("tiles").innerHTML = ""; $("tbl").innerHTML = '<div class="empty">No complete weekends in the candle window yet.</div>'; return; }

  const agree = rows.filter((r) => Math.sign(r.move) === Math.sign(r.realized) && Math.abs(r.move) > 0.0005).length;
  const moved = rows.filter((r) => Math.abs(r.move) > 0.0005).length;
  const medErr = rows.map((r) => Math.abs(r.error)).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const totVol = rows.reduce((a, r) => a + r.vol, 0);
  $("tiles").innerHTML = tile("Symbol-weekends", rows.length) + tile("Direction agreement", fmtPct(agree / (moved || 1), 0), `of ${moved} weekends with a move`) +
    tile("Median reopen error", fmtPct(medErr, 2), "|reopen ÷ weekend price − 1|") + tile("Weekend RWA volume", fmtShort(totVol), `Sat 00:00 → Sun 21:00 UTC · ${fmtUsd(totVol)}`);

  const lim = Math.ceil(Math.max(...rows.map((r) => Math.max(Math.abs(r.move), Math.abs(r.realized)))) * 100 * 1.1);
  chart($("sc"), {
    tooltip: { trigger: "item", formatter: (p) => `${p.data[2]} ${p.data[3]}<br>weekend ${p.data[0].toFixed(2)}% → reopen ${p.data[1].toFixed(2)}%<br>volume ${fmtShort(p.data[4])}` },
    xAxis: { type: "value", name: "weekend move %", min: -lim, max: lim, splitLine: { lineStyle: { color: C.line, type: "dashed" } }, axisLabel: { color: C.dim } },
    yAxis: { type: "value", name: "realized %", min: -lim, max: lim },
    series: [
      { type: "scatter", symbolSize: (d) => 6 + Math.min(14, Math.sqrt(d[4] / 5000)), itemStyle: { color: "rgba(128,119,255,0.75)", borderColor: C.tint, borderWidth: 1 }, data: rows.map((r) => [r.move * 100, r.realized * 100, r.sym, r.week, r.vol]) },
      { type: "line", data: [[-lim, -lim], [lim, lim]], showSymbol: false, lineStyle: { color: C.dim, type: "dashed", width: 1 }, tooltip: { show: false } },
    ],
  });
  $("tbl").innerHTML = `<table><tr><th>Weekend</th><th>Symbol</th><th>Fri close</th><th>Sun 20:00</th><th>Reopen</th><th>Weekend move</th><th>Realized</th><th>Reopen error</th><th>Weekend vol</th><th>Active hrs</th></tr>` +
    rows.map((r) => `<tr><td>${r.week}</td><td class="sym">${r.sym}</td><td>${r.fri}</td><td>${r.wk}</td><td>${r.open}</td><td class="${r.move >= 0 ? "up" : "down"}">${fmtPct(r.move)}</td><td class="${r.realized >= 0 ? "up" : "down"}">${fmtPct(r.realized)}</td><td>${fmtPct(r.error)}</td><td>${fmtShort(r.vol)}</td><td>${r.activeHours}/45</td></tr>`).join("") + `</table>`;
}
