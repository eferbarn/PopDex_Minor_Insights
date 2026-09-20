// Protocol vault: the LP pool that market-makes, absorbs liquidations and backs
// the insurance funds. Its positions / fills / depositors are public.
import { rest, paginate, PROTOCOL_VAULT, PROTOCOL_MM, fmtUsd, fmtNum, fmtPct, short, fmtTime } from "../api.js";
import { live, onLive } from "../live.js";
import { chart, tile, card, pageHead, C } from "../main.js";
import { skelTiles, skelTable, chartLoading } from "../loading.js";

export default async function vault(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = pageHead("03 / PROTOCOL VAULT", "The pool on the <em class='tint'>other side</em> of your trades",
    "The protocol vault market-makes, absorbs liquidations and backs the insurance funds. Its positions, fills and depositors are public.") +
    `<div class="tiles" id="tiles">${skelTiles(6)}</div>
     <div class="grid">
       ${card("Week PnL", `<div class="chart" id="pnl"></div>`, { hint: "from the vault list" })}
       ${card("Depositor concentration", `<div class="chart" id="dep"></div>`)}
       ${card("Open positions", `<div class="tbl" id="pos">${skelTable(8, 9)}</div>`, { wide: true, hint: "inventory the LPs hold right now" })}
       ${card("Live fills — market-making sub-account & insurance funds", `<div class="tiles" id="ftiles"></div><div class="feed" id="fills"></div>`, { wide: true, hint: short(PROTOCOL_MM) })}
     </div>`;

  const ld = { pnl: chartLoading($("pnl"), "Loading"), dep: chartLoading($("dep"), "Loading depositors") };
  const v = (await rest("/vaults", { limit: 100 })).data.find((x) => x.vaultWalletId.toLowerCase() === PROTOCOL_VAULT);
  const ins = (await rest("/public/insurance-fund")).data;
  const insTot = ins.reduce((a, x) => a + +x.accountEquity, 0);
  $("tiles").innerHTML = tile("TVL", fmtUsd(v.totalEquity)) + tile("NAV", fmtNum(v.nav, 4), "USDT per share") + tile("APR", fmtPct(+v.apr, 2)) +
    tile("All-time PnL", fmtUsd(v.allTimePnl)) + tile("Lock-up", `${(+v.lockPeriodSeconds / 86400).toFixed(0)} <span class="unit">days</span>`, `leader shares ${fmtNum(v.leaderShares, 0)}`) + tile("Insurance funds", fmtUsd(insTot), `${ins.length} accounts`);

  ld.pnl.done();
  chart($("pnl"), {
    xAxis: { type: "category", data: (v.weekPnl || []).map((p) => new Date(+p[0]).toISOString().slice(5, 16)) },
    yAxis: { type: "value" },
    series: [{ type: "line", areaStyle: { color: "rgba(128,119,255,0.15)" }, lineStyle: { color: C.brand }, data: (v.weekPnl || []).map((p) => +p[1]) }],
  });

  const deps = (await paginate(`/vault/${PROTOCOL_VAULT}/depositors`)).map((d) => ({ ...d, eq: +d.equity })).sort((a, b) => b.eq - a.eq);
  const tot = deps.reduce((a, d) => a + d.eq, 0);
  const buckets = [["top 1", 1], ["top 2-10", 10], ["top 11-50", 50], ["rest", Infinity]];
  let prev = 0;
  const data = buckets.map(([n, k]) => { const s = deps.slice(prev, k === Infinity ? undefined : k).reduce((a, d) => a + d.eq, 0); prev = k; return { name: n, value: s }; });
  ld.dep.done();
  chart($("dep"), {
    tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${fmtUsd(p.value)} (${p.percent}%)` },
    title: { text: `${deps.length} depositors`, left: "center", top: "middle", textStyle: { color: "#a0a3a7", fontSize: 12, fontWeight: 500 } },
    color: [C.brand, "#5e57c4", C.grey, C.grey2],
    series: [{ type: "pie", radius: ["50%", "78%"], itemStyle: { borderColor: "#0b0b0d", borderWidth: 2 }, data, label: { color: "#a0a3a7", fontSize: 11 } }],
  });

  const pos = await paginate(`/vault/${PROTOCOL_VAULT}/positions`);
  const rows = pos.map((p) => ({ ...p, usd: +p.holdQty * +p.markPrice })).sort((a, b) => b.usd - a.usd);
  const net = rows.reduce((a, p) => a + (p.positionSide === "Long" ? 1 : -1) * p.usd, 0);
  $("pos").innerHTML = `<div class="dim" style="margin-bottom:8px;font-size:12px">${rows.length} positions · gross ${fmtUsd(rows.reduce((a, p) => a + p.usd, 0))} · net ${fmtUsd(net)} (${net >= 0 ? "long" : "short"}) · unrealized ${fmtUsd(rows.reduce((a, p) => a + +p.unPnl, 0))}</div>` +
    `<table><tr><th>Symbol</th><th>Side</th><th>Size</th><th>Notional</th><th>Entry</th><th>Mark</th><th>Unrealized</th><th>Realized</th><th>Funding</th></tr>` +
    rows.map((p) => `<tr><td class="sym">${p.symbol}</td><td class="${p.positionSide === "Long" ? "up" : "down"}">${p.positionSide}</td><td>${fmtNum(p.holdQty, 4)}</td><td>${fmtUsd(p.usd)}</td><td>${fmtNum(p.avgOpenPrice, 4)}</td><td>${fmtNum(p.markPrice, 4)}</td><td class="${+p.unPnl >= 0 ? "up" : "down"}">${fmtUsd(p.unPnl, 2)}</td><td class="${+p.realizedPnl >= 0 ? "up" : "down"}">${fmtUsd(p.realizedPnl, 2)}</td><td>${fmtUsd(p.fundingFee, 2)}</td></tr>`).join("") + `</table>`;

  const renderFills = () => {
    const st = live.state.vaultStats, rows = live.state.vaultFills;
    $("ftiles").innerHTML = tile("Fills", st.n, "this session") + tile("Realized PnL", fmtUsd(st.pnl, 2)) + tile("Fees paid", fmtUsd(st.fee, 2)) + tile("Notional", fmtUsd(st.vol));
    $("fills").innerHTML = rows.length ? rows.slice(0, 150).map((d, i) =>
      `<div class="${i === 0 ? "new" : ""}"><span class="t">${fmtTime(d.ts)}</span><span class="addr">${short(d.w)}</span><span class="side ${d.side === "Buy" ? "up" : "down"}">${d.side}</span><span class="sym">${d.symbol}</span><span>${fmtNum(d.execQty, 4)} @ ${d.execPrice}</span><span>${fmtUsd(d.execValue)}</span><span class="${+d.execPnl >= 0 ? "up" : "down"}">pnl ${fmtUsd(d.execPnl, 2)}</span>${d.liquidation ? '<span class="pd-pill pd-pill--error">liq</span>' : ""}<span class="dim">${d.orderType} ${d.tradeScope || ""}</span></div>`).join("")
      : `<div class="empty">Waiting for fills.</div>`;
  };
  renderFills();
  return onLive(renderFills);
}
