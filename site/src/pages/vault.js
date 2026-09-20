// Protocol vault: the LP pool that market-makes, absorbs liquidations and backs
// the insurance funds. Its positions / fills / depositors are public.
import { rest, paginate, connect, PROTOCOL_VAULT, PROTOCOL_MM, INSURANCE_FUNDS, fmtUsd, fmtNum, fmtPct, short, fmtTime } from "../api.js";
import { chart, setStatus } from "../main.js";

export default async function vault(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = `
    <div class="tiles" id="tiles"></div>
    <div class="grid">
      <div class="panel"><h3>Week PnL (from vault list)</h3><div class="chart" id="pnl"></div></div>
      <div class="panel"><h3>Depositor concentration</h3><div class="chart" id="dep"></div></div>
      <div class="panel wide"><h3>Open positions (inventory the LPs are holding right now)</h3><div id="pos"></div></div>
      <div class="panel wide"><h3>Live fills of the market-making sub-account <span class="addr">${short(PROTOCOL_MM)}</span> and insurance funds</h3>
        <div class="tiles"><div class="tile"><div class="k">Fills (session)</div><div class="v" id="f-n">0</div></div><div class="tile"><div class="k">Realized PnL (session)</div><div class="v" id="f-pnl">$0</div></div><div class="tile"><div class="k">Fees paid (session)</div><div class="v" id="f-fee">$0</div></div><div class="tile"><div class="k">Notional (session)</div><div class="v" id="f-vol">$0</div></div></div>
        <div class="feed" id="fills"><div class="empty">waiting…</div></div></div>
    </div>`;

  const v = (await rest("/vaults", { limit: 100 })).data.find((x) => x.vaultWalletId.toLowerCase() === PROTOCOL_VAULT);
  const ins = (await rest("/public/insurance-fund")).data;
  const insTot = ins.reduce((a, x) => a + +x.accountEquity, 0);
  $("tiles").innerHTML = [
    ["TVL", fmtUsd(v.totalEquity)], ["NAV", fmtNum(v.nav, 4)], ["APR", fmtPct(+v.apr, 2)], ["All-time PnL", fmtUsd(v.allTimePnl)],
    ["Leader shares", fmtNum(v.leaderShares, 0)], ["Lock-up", `${(+v.lockPeriodSeconds / 86400).toFixed(0)}d`], ["Insurance funds", fmtUsd(insTot)],
  ].map(([k, val]) => `<div class="tile"><div class="k">${k}</div><div class="v">${val}</div></div>`).join("");

  chart($("pnl"), {
    xAxis: { type: "category", data: (v.weekPnl || []).map((p) => new Date(+p[0]).toISOString().slice(5, 16)) },
    yAxis: { type: "value" },
    series: [{ type: "line", areaStyle: {}, data: (v.weekPnl || []).map((p) => +p[1]) }],
  });

  const deps = (await paginate(`/vault/${PROTOCOL_VAULT}/depositors`)).map((d) => ({ ...d, eq: +d.equity })).sort((a, b) => b.eq - a.eq);
  const tot = deps.reduce((a, d) => a + d.eq, 0);
  const buckets = [["top 1", 1], ["top 2-10", 10], ["top 11-50", 50], ["rest", Infinity]];
  let prev = 0;
  const data = buckets.map(([n, k]) => { const s = deps.slice(prev, k === Infinity ? undefined : k).reduce((a, d) => a + d.eq, 0); prev = k; return { name: n, value: s }; });
  chart($("dep"), {
    tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${fmtUsd(p.value)} (${p.percent}%)` },
    title: { text: `${deps.length} depositors`, left: "center", top: "middle", textStyle: { color: "#c9cddb", fontSize: 13 } },
    series: [{ type: "pie", radius: ["45%", "75%"], data, label: { color: "#c9cddb" } }],
  });

  const pos = await paginate(`/vault/${PROTOCOL_VAULT}/positions`);
  const rows = pos.map((p) => ({ ...p, usd: +p.holdQty * +p.markPrice })).sort((a, b) => b.usd - a.usd);
  const net = rows.reduce((a, p) => a + (p.positionSide === "Long" ? 1 : -1) * p.usd, 0);
  $("pos").innerHTML = `<div class="muted" style="margin-bottom:6px">${rows.length} positions · gross ${fmtUsd(rows.reduce((a, p) => a + p.usd, 0))} · net ${fmtUsd(net)} (${net >= 0 ? "long" : "short"}) · unrealized ${fmtUsd(rows.reduce((a, p) => a + +p.unPnl, 0))}</div>` +
    `<table><tr><th>Symbol</th><th>Side</th><th>Size</th><th>Notional</th><th>Entry</th><th>Mark</th><th>Unrealized</th><th>Realized</th><th>Funding</th></tr>` +
    rows.map((p) => `<tr><td>${p.symbol}</td><td class="${p.positionSide === "Long" ? "up" : "down"}">${p.positionSide}</td><td>${fmtNum(p.holdQty, 4)}</td><td>${fmtUsd(p.usd)}</td><td>${fmtNum(p.avgOpenPrice, 4)}</td><td>${fmtNum(p.markPrice, 4)}</td><td class="${+p.unPnl >= 0 ? "up" : "down"}">${fmtUsd(p.unPnl, 2)}</td><td class="${+p.realizedPnl >= 0 ? "up" : "down"}">${fmtUsd(p.realizedPnl, 2)}</td><td>${fmtUsd(p.fundingFee, 2)}</td></tr>`).join("") + `</table>`;

  const st = { n: 0, pnl: 0, fee: 0, vol: 0 };
  const feed = $("fills");
  const stop = connect([PROTOCOL_MM, PROTOCOL_VAULT, ...INSURANCE_FUNDS].map((w) => ({ walletId: w, topic: "fill" })), (m) => {
    if (m.arg?.topic !== "fill") return;
    if (feed.firstElementChild?.classList.contains("empty")) feed.innerHTML = "";
    for (const d of m.data || []) {
      const fee = (d.feeDetail || []).reduce((a, f) => a + +f.fee, 0);
      st.n++; st.pnl += +d.execPnl || 0; st.fee += fee; st.vol += +d.execValue || 0;
      const div = document.createElement("div"); div.className = "new";
      div.innerHTML = `<span class="muted">${fmtTime(d.updatedAt || Date.now())}</span> <span class="addr">${short(m.arg.walletId)}</span> <b class="${d.side === "Buy" ? "up" : "down"}">${d.side.toUpperCase()}</b> ${d.symbol} ${fmtNum(d.execQty, 4)} @ ${d.execPrice} = ${fmtUsd(d.execValue)} · pnl <span class="${+d.execPnl >= 0 ? "up" : "down"}">${fmtUsd(d.execPnl, 2)}</span>${d.liquidation ? " · <b>LIQ</b>" : ""} <span class="muted">${d.orderType} ${d.tradeScope || ""}</span>`;
      feed.prepend(div); while (feed.children.length > 200) feed.lastChild.remove();
    }
    $("f-n").textContent = st.n; $("f-pnl").textContent = fmtUsd(st.pnl, 2);
    $("f-fee").textContent = fmtUsd(st.fee, 2); $("f-vol").textContent = fmtUsd(st.vol);
  }, setStatus);
  return () => { stop(); setStatus(""); };
}
