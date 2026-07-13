import { api } from "../api.js";
import { esc, fmt, gradeBadge, keyErrorHtml } from "../util.js";
import { hadithCard, groupCard, rawiCard } from "../components/cards.js";

const atharCard = (h) => `
  <a class="card result-card" href="#/hadith/${h.hadithId}">
    <div class="nass nass-sm">${esc((h.taraf ?? "").slice(0, 170))}</div>
    <div class="row" style="margin-top:8px;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="badge">${esc(h.type ?? "")}</span>
      ${gradeBadge(h.hukm)}
      <span class="tag-count" style="margin-inline-start:auto">${esc(h.book ?? "")}${h.noInBook ? ` · ${fmt(h.noInBook)}` : ""}</span>
    </div>
  </a>`;

const MODES = [
  ["semantic", "بالمعنى", "يفهم سؤالك ويجد الأحاديث والآثار بمعناها ولو اختلف اللفظ"],
  ["text", "باللفظ", "بحث نصي في متون الأحاديث"],
  ["group", "الأطراف", "بحث في نصوص الأطراف (المعاني المجردة)"],
  ["rawi", "الرواة", "بحث في أسماء الرواة وكناهم"],
];

export async function search({ params, render }) {
  const q = params.get("q") ?? "";
  const mode = params.get("mode") ?? "semantic";

  const shellHtml = (resultsHtml) => `
    <form class="search-box" id="search-form" style="max-width:100%">
      <input name="q" value="${esc(q)}" placeholder="ابحث…" autocomplete="off" autofocus />
      <button>بحث</button>
    </form>
    <div class="mode-pills" style="justify-content:flex-start" id="search-modes">
      ${MODES.map(([m, t, tip]) =>
        `<a class="chip ${m === mode ? "active" : ""}" title="${tip}"
            href="#/search?mode=${m}&q=${encodeURIComponent(q)}">${t}</a>`).join("")}
    </div>
    <div style="margin-top:20px">${resultsHtml}</div>`;

  if (!q) return shellHtml(`<div class="empty">اكتب ما تبحث عنه — بالمعنى أو باللفظ</div>`);

  render(shellHtml(`<div class="skeleton" style="height:300px"></div>`));

  let resultsHtml;
  if (mode === "semantic") {
    let hits = [], error = null, athar = [];
    try {
      const [g, a] = await Promise.all([
        api.semanticGroups(q, 12),
        api.searchAthar(q, 10).catch(() => ({ hits: [] })),
      ]);
      hits = g.hits ?? []; error = g.error;
      athar = a.hits ?? [];
    } catch (e) { error = String(e.message ?? e); }
    const marfu = hits.length
      ? `<div class="muted" style="margin-bottom:10px">معانٍ مرفوعة مرتَّبة بالتشابه الدلالي — كل معنى يجمع رواياته من كل الكتب</div>
         <div class="grid">${hits.map(groupCard).join("")}</div>`
      : "";
    const atharHtml = athar.length
      ? `<div class="sec-title" style="margin-top:24px">آثار الصحابة والتابعين <span class="tag-count">موقوف / مقطوع — بالمعنى</span></div>
         <div class="grid">${athar.map(atharCard).join("")}</div>`
      : "";
    resultsHtml = error
      ? `<div class="empty">${keyErrorHtml(error) ?? esc(error)}</div>`
      : (hits.length || athar.length) ? marfu + atharHtml : `<div class="empty">لا نتائج</div>`;
  } else if (mode === "text") {
    const { hits } = await api.searchHadiths(q, 30);
    resultsHtml = hits.length
      ? `<div class="grid">${hits.map(hadithCard).join("")}</div>`
      : `<div class="empty">لا نتائج لفظية — جرّب البحث بالمعنى</div>`;
  } else if (mode === "group") {
    const { hits } = await api.searchGroups(q, 30);
    resultsHtml = hits.length
      ? `<div class="grid">${hits.map(groupCard).join("")}</div>`
      : `<div class="empty">لا نتائج</div>`;
  } else {
    const { hits } = await api.searchRawis(q, 30);
    resultsHtml = hits.length
      ? `<div class="grid grid-2">${hits.map(rawiCard).join("")}</div>`
      : `<div class="empty">لا نتائج</div>`;
  }
  return shellHtml(resultsHtml);
}

document.addEventListener("page:rendered", () => {
  const form = document.getElementById("search-form");
  if (!form) return;
  form.onsubmit = (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    const mode = new URLSearchParams(location.hash.split("?")[1] ?? "").get("mode") ?? "semantic";
    if (q) location.hash = `#/search?mode=${mode}&q=${encodeURIComponent(q)}`;
  };
});
