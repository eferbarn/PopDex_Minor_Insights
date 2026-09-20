import * as echarts from "echarts";
import live from "./pages/live.js";
import markets from "./pages/markets.js";
import weekend from "./pages/weekend.js";
import vault from "./pages/vault.js";
import history from "./pages/history.js";

const pages = { live, markets, weekend, vault, history };
const app = document.getElementById("app");
let teardown = null;

echarts.registerTheme("popdex", {
  backgroundColor: "transparent",
  textStyle: { color: "#c9cddb" },
  color: ["#f5a623", "#4fa3ff", "#2ecc71", "#ff5c5c", "#b388ff", "#26c6da", "#ffd54f", "#8d6e63"],
});

export function chart(el, option) {
  const c = echarts.init(el, "popdex");
  c.setOption({
    grid: { left: 56, right: 20, top: 30, bottom: 30 },
    tooltip: { trigger: "axis", backgroundColor: "#171922", borderColor: "#262a37", textStyle: { color: "#e6e8ef" } },
    ...option,
  });
  new ResizeObserver(() => c.resize()).observe(el);
  return c;
}

export function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function route() {
  const name = (location.hash || "#live").slice(1);
  const page = pages[name] || pages.live;
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === name));
  if (teardown) teardown();
  setStatus("");
  // each page gets its own container, so a page still loading after the user
  // navigated away writes into a detached element instead of the new page
  const root = document.createElement("div");
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
route();
