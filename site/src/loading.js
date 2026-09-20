// Loading states in the PopDex UI language (same as 3P / Creators):
// a purple ring with a halo for whole pages, pulsing skeleton blocks for tiles
// and tables, and a striped, breathing overlay with a progress chip for charts.

export const spinner = (title = "Connecting to PopDex", caption = "") => `
  <div class="ld-page pd-rise">
    <div class="ld-ring"><i></i><b></b></div>
    <p class="ld-title">${title}</p>
    <div class="pd-track ld-track"><div class="pd-fill pd-fill--shimmer" style="width:18%"></div></div>
    <p class="pd-caption">${caption}</p>
  </div>`;

export const skelTiles = (n = 4) => Array.from({ length: n }, () => `
  <div class="pd-card tile ld-tile"><span class="ld-bar w40 h10"></span><span class="ld-bar w70 h22"></span><span class="ld-bar w55 h10"></span></div>`).join("");

export const skelTable = (rows = 6, cols = 5) => `<table class="ld-table"><tr>${Array.from({ length: cols }, () => `<th><span class="ld-bar w60 h9"></span></th>`).join("")}</tr>` +
  Array.from({ length: rows }, (_, i) => `<tr>${Array.from({ length: cols }, (_, j) => `<td><span class="ld-bar ${j === 0 ? "w70" : "w50"} h11" style="animation-delay:${(i * cols + j) * 40}ms"></span></td>`).join("")}</tr>`).join("") + `</table>`;

export const skelFeed = (rows = 6) => `<div class="ld-feed">` + Array.from({ length: rows }, (_, i) => `<div style="animation-delay:${i * 90}ms"><span class="ld-bar w15 h10"></span><span class="ld-bar w10 h10"></span><span class="ld-bar w25 h10"></span><span class="ld-bar w20 h10"></span></div>`).join("") + `</div>`;

/** Striped overlay for a chart container; call progress(done,total) to update the chip, done() to remove. */
export function chartLoading(el, label = "Loading") {
  const ov = document.createElement("div");
  ov.className = "ld-chart";
  ov.innerHTML = `<span class="ld-chip"><span class="live-dot" aria-hidden="true"></span><span>${label}</span><b></b></span>`;
  el.appendChild(ov);
  const b = ov.querySelector("b");
  return {
    progress: (done, total) => { b.textContent = total ? ` · ${Math.round((100 * done) / total)}%` : ""; },
    done: () => { ov.classList.add("is-done"); setTimeout(() => ov.remove(), 400); },
  };
}
