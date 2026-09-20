import * as echarts from "echarts";
import live from "./pages/live.js";
import markets from "./pages/markets.js";
import weekend from "./pages/weekend.js";
import vault from "./pages/vault.js";
import history from "./pages/history.js";
import { startLive, onStatus, onLive, live as liveStore } from "./live.js";

const pages = { live, markets, weekend, vault, history };
const app = document.getElementById("app");
let teardown = null;

// ECharts theme derived from popdex-ui.tokens.json: one purple accent, greys
// for secondary series, green/pink only for semantic (long/short, in/out).
export const C = { brand: "#8077ff", tint: "#bdb9ff", deep: "#4d42fc", grey: "#6c6f75", grey2: "#34363c", ok: "#17a781", bad: "#f03277", warn: "#f5c46b", line: "#26272c", dim: "#6c6f75", text: "#f4f4f6" };
echarts.registerTheme("popdex", {
  backgroundColor: "transparent",
  textStyle: { color: "#a0a3a7", fontFamily: "Manrope, system-ui, sans-serif" },
  color: [C.brand, C.grey, C.tint, C.ok, C.bad, C.warn, C.deep, C.grey2],
  categoryAxis: { axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.dim, fontSize: 11 }, splitLine: { show: false } },
  valueAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.dim, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }, splitLine: { lineStyle: { color: C.line, type: "dashed" } } },
  legend: { textStyle: { color: "#a0a3a7", fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: "circle" },
  line: { smooth: 0.35, symbol: "none", lineStyle: { width: 2.2 } },
  bar: { itemStyle: { borderRadius: [3, 3, 0, 0] } },
});

export function chart(el, option) {
  const c = echarts.init(el, "popdex");
  c.setOption({
    grid: { left: 56, right: 20, top: 34, bottom: 30 },
    tooltip: { trigger: "axis", backgroundColor: "rgba(20,21,24,0.95)", borderColor: "rgba(128,119,255,0.35)", borderRadius: 14, padding: [8, 12], textStyle: { color: "#f4f4f6", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }, extraCssText: "backdrop-filter: blur(14px);" },
    ...option,
  });
  new ResizeObserver(() => c.resize()).observe(el);
  return c;
}

export const tile = (label, value, sub = "") => `<div class="pd-card tile"><span class="pd-caption">${label}</span><div class="pd-stat">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
export const card = (title, body, { wide = false, hint = "" } = {}) => `<section class="pd-card card${wide ? " wide" : ""}"><div class="card-head"><span class="pd-caption">${title}</span>${hint ? `<span class="hint">${hint}</span>` : ""}</div>${body}</section>`;
export const pageHead = (no, title, lead = "", right = "") => `<div class="page-head"><div><span class="step-no">${no}</span><h1 class="pd-title">${title}</h1>${lead ? `<p class="pd-body lead">${lead}</p>` : ""}</div>${right}</div>`;

function renderStatus() {
  const pill = document.getElementById("ws-pill");
  document.getElementById("ws-status").textContent = liveStore.status;
  pill.classList.toggle("is-off", liveStore.status !== "live");
  document.getElementById("ws-count").textContent = liveStore.state.stats.events.toLocaleString("en-US");
}
onStatus(renderStatus);
onLive(renderStatus);

async function route() {
  const name = (location.hash || "#live").slice(1);
  const page = pages[name] || pages.live;
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === name));
  if (teardown) teardown();
  // each page gets its own container, so a page still loading after the user
  // navigated away writes into a detached element instead of the new page
  const root = document.createElement("div");
  root.className = "pd-rise";
  root.innerHTML = '<div class="empty">loading…</div>';
  app.replaceChildren(root);
  try {
    const t = await page(root);
    if (root.isConnected) teardown = t || null; else t && t();
  } catch (e) {
    if (root.isConnected) root.innerHTML = `<div class="empty">failed: ${e.message}</div>`;
    console.error(e);
  }
}

window.addEventListener("hashchange", route);
startLive().then(renderStatus);
route();
