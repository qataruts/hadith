/**
 * Charts per the dataviz method: horizontal bars (magnitude by category),
 * single sequential hue, thin marks, direct value labels, recessive chrome.
 */
import { esc, fmt } from "../util.js";

/** rows: [{label, value, href?, title?}] — one series, one hue, no legend needed.
 * Value is encoded by LENGTH only; the direct label carries the exact number. */
export function bars(rows, { maxBars = 14 } = {}) {
  if (!rows?.length) return `<div class="empty">لا بيانات</div>`;
  const shown = rows.slice(0, maxBars);
  const max = Math.max(...shown.map((r) => r.value), 1);
  return `<div class="bars">${shown
    .map((r, i) => {
      const w = Math.max(1.5, (r.value / max) * 100);
      const color = "var(--seq-4)";
      const label = r.href
        ? `<a href="${r.href}" title="${esc(r.title ?? r.label)}">${esc(r.label)}</a>`
        : `<span title="${esc(r.title ?? r.label)}">${esc(r.label)}</span>`;
      return `<div class="bar-row">
        <div class="bar-label">${label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
        <div class="bar-val">${fmt(r.value)}</div>
      </div>`;
    })
    .join("")}${rows.length > maxBars
      ? `<div class="muted" style="margin-top:4px">+ ${fmt(rows.length - maxBars)} أخرى</div>` : ""}
  </div>`;
}

/** tabaqat: {"1": n, ...} — ordinal x, magnitude bars. */
export function tabaqatChart(tabaqat) {
  const rows = Object.entries(tabaqat ?? {})
    .map(([t, v]) => ({ t: Number(t), v }))
    .filter((r) => r.t > 0)
    .sort((a, b) => a.t - b.t)
    .map((r) => ({ label: `الطبقة ${r.t}`, value: r.v, title: `رواة الطبقة ${r.t}` }));
  return bars(rows, { maxBars: 30 });
}

export function statTiles(items) {
  return `<div class="grid grid-4">${items
    .map((s) => `<div class="card stat-tile"><div class="v">${fmt(s.v)}</div><div class="k">${esc(s.k)}</div></div>`)
    .join("")}</div>`;
}
