// History: everything the API does not keep — read from the `data` branch that
// the GitHub Actions collectors append to.
import { dataDays, dataCsv, dataJson, fmtUsd, fmtNum, fmtPct } from "../api.js";
import { chart } from "../main.js";

const day = (ts) => new Date(+ts).toISOString().slice(0, 10);
const uniq = (rows, key) => { const seen = new Set(); return rows.filter((r) => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true; }); };

export default async function history(root) {
  const $ = (id) => root.querySelector("#" + id);
  root.innerHTML = `
    <p class="muted" id="note"></p>
    <div class="grid">
      <div class="panel"><h3>Insurance funds equity ("degen donation" index)</h3><div class="chart" id="ins"></div></div>
      <div class="panel"><h3>Protocol vault NAV & TVL</h3><div class="chart" id="nav"></div></div>
      <div class="panel"><h3>Liquidations per day</h3><div class="chart" id="liq"></div></div>
      <div class="panel"><h3>Bridge: deposits vs withdrawals per day (USDT)</h3><div class="chart" id="bridge"></div></div>
      <div class="panel"><h3>New depositors per day (first bridge deposit) & cumulative</h3><div class="chart" id="newdep"></div></div>
      <div class="panel"><h3>Active accounts per sample — UI vs API bots</h3><div class="chart" id="acct"></div></div>
      <div class="panel"><h3>Cancel / create ratio (order-book churn)</h3><div class="chart" id="churn"></div></div>
      <div class="panel"><h3>Chain transactions per day (explorer)</h3><div class="chart" id="txs"></div></div>
    </div>`;

  const N = 45;
  const [snaps, liqs, arb, morph, acct, txDaily] = await Promise.all([
    dataDays("snapshots", N), dataDays("liquidations", N), dataCsv("bridge/arbitrum.csv"), dataCsv("bridge/morph.csv"),
    dataDays("active_accounts", N), dataJson("explorer_daily.json", {}),
  ]);
  const have = [snaps.length && "snapshots", liqs.length && "liquidations", (arb.length + morph.length) && "bridge", acct.length && "chain samples"].filter(Boolean);
  $("note").textContent = have.length ? `Loaded: ${have.join(", ")} · ${snaps.length} snapshots · ${liqs.length} liquidation events · ${arb.length + morph.length} bridge events` : "No collected data yet — the GitHub Actions workflows have not pushed to the data branch.";

  const t = (ts) => new Date(+ts).toISOString().slice(5, 16).replace("T", " ");
  if (snaps.length) {
    const wallets = [...new Set(snaps.flatMap((s) => s.insurance.map((i) => i.wallet)))].filter((w) => !w.endsWith("fe"));
    chart($("ins"), {
      xAxis: { type: "category", data: snaps.map((s) => t(s.ts)) }, yAxis: { type: "value", scale: true }, legend: { top: 0 },
      series: wallets.map((w) => ({ name: "…" + w.slice(-4), type: "line", showSymbol: false, data: snaps.map((s) => +(s.insurance.find((i) => i.wallet === w)?.equity ?? NaN)) })),
    });
    chart($("nav"), {
      xAxis: { type: "category", data: snaps.map((s) => t(s.ts)) },
      yAxis: [{ type: "value", scale: true, name: "NAV" }, { type: "value", scale: true, name: "TVL", axisLabel: { formatter: (v) => "$" + (v / 1e6).toFixed(1) + "M" } }],
      legend: { top: 0 },
      series: [{ name: "NAV", type: "line", showSymbol: false, data: snaps.map((s) => +s.vault.nav) }, { name: "TVL", type: "line", yAxisIndex: 1, showSymbol: false, data: snaps.map((s) => +s.vault.totalEquity) }],
    });
  }

  const L = uniq(liqs, (l) => `${l.ts}|${l.walletId}|${l.symbol}|${l.amount}`); // overlapping listeners
  const byDay = {};
  for (const l of L) { const d = (byDay[day(l.ts)] ||= { n: 0, usd: 0, long: 0, short: 0 }); d.n++; d.usd += +l.amount * +l.price; d[l.side === "Buy" ? "long" : "short"] += +l.amount * +l.price; }
  const ldays = Object.keys(byDay).sort();
  chart($("liq"), {
    xAxis: { type: "category", data: ldays }, yAxis: [{ type: "value", name: "USD" }, { type: "value", name: "count" }], legend: { top: 0 },
    series: [{ name: "longs liquidated", type: "bar", stack: "u", data: ldays.map((d) => byDay[d].long) }, { name: "shorts liquidated", type: "bar", stack: "u", data: ldays.map((d) => byDay[d].short) }, { name: "count", type: "line", yAxisIndex: 1, data: ldays.map((d) => byDay[d].n) }],
  });

  const br = [...arb, ...morph].filter((r) => r.kind === "deposit" || r.kind === "withdraw_submit").map((r) => ({ ...r, usd: +r.amount / 1e6, d: day(r.ts) }));
  const bdays = [...new Set(br.map((r) => r.d))].sort();
  const sumK = (k, d) => br.filter((r) => r.kind === k && r.d === d).reduce((a, r) => a + r.usd, 0);
  chart($("bridge"), {
    xAxis: { type: "category", data: bdays }, yAxis: { type: "value" }, legend: { top: 0 },
    series: [{ name: "deposits", type: "bar", data: bdays.map((d) => sumK("deposit", d)) }, { name: "withdrawals", type: "bar", data: bdays.map((d) => -sumK("withdraw_submit", d)) }, { name: "net", type: "line", data: bdays.map((d) => sumK("deposit", d) - sumK("withdraw_submit", d)) }],
  });
  const first = {};
  for (const r of br.filter((r) => r.kind === "deposit").sort((a, b) => +a.ts - +b.ts)) first[r.receiver] ??= r.d;
  const newBy = {}; for (const d of Object.values(first)) newBy[d] = (newBy[d] || 0) + 1;
  let cum = 0;
  chart($("newdep"), {
    xAxis: { type: "category", data: bdays }, yAxis: [{ type: "value", name: "new" }, { type: "value", name: "cumulative" }], legend: { top: 0 },
    series: [{ name: "new depositors", type: "bar", data: bdays.map((d) => newBy[d] || 0) }, { name: "cumulative", type: "line", yAxisIndex: 1, data: bdays.map((d) => (cum += newBy[d] || 0)) }],
  });

  if (acct.length) {
    chart($("acct"), {
      xAxis: { type: "category", data: acct.map((a) => t(a.ts)) }, yAxis: { type: "value" }, legend: { top: 0 },
      series: [{ name: "UI accounts", type: "bar", stack: "a", data: acct.map((a) => a.ui_accounts) }, { name: "API/bot accounts", type: "bar", stack: "a", data: acct.map((a) => a.bot_accounts) }, { name: "top-3 share", type: "line", data: acct.map((a) => a.top3_share * 100), yAxisIndex: 0, tooltip: { valueFormatter: (v) => v.toFixed(0) + "%" } }],
    });
    chart($("churn"), {
      xAxis: { type: "category", data: acct.map((a) => t(a.ts)) }, yAxis: { type: "value", min: 0 },
      series: [{ name: "cancel/create", type: "line", showSymbol: false, data: acct.map((a) => +(a.cancels / Math.max(1, a.orders)).toFixed(3)) }],
    });
  }
  const tdays = Object.keys(txDaily).sort();
  chart($("txs"), {
    xAxis: { type: "category", data: tdays }, yAxis: { type: "value", axisLabel: { formatter: (v) => (v / 1e6).toFixed(0) + "M" } },
    series: [{ type: "bar", data: tdays.map((d) => txDaily[d]) }],
  });
}
