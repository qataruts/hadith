import { api } from "../api.js";
import { esc, keyErrorHtml } from "../util.js";
import { hadithCard, groupCard, rawiCard } from "../components/cards.js";

const MODES = [
  ["semantic", "بالمعنى", "يفهم سؤالك ويجد الأحاديث بمعناها ولو اختلف اللفظ"],
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
    let hits = [], error = null;
    try { ({ hits, error } = await api.semanticGroups(q, 15)); }
    catch (e) { error = String(e.message ?? e); }
    resultsHtml = error
      ? `<div class="empty">${keyErrorHtml(error) ?? esc(error)}</div>`
      : hits.length
        ? `<div class="muted" style="margin-bottom:10px">معانٍ مرتبة بالتشابه الدلالي — كل معنى يجمع رواياته من كل الكتب</div>
           <div class="grid">${hits.map(groupCard).join("")}</div>`
        : `<div class="empty">لا نتائج</div>`;
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
