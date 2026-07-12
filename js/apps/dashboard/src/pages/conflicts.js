/** تعارض الأحكام بين الطرق — hadith whose isnads carry different gradings. The
 * point is teaching, not indictment: a matn may be sound from one route and weak
 * from another. Severity = the spread on the 0–5 grade scale across its sanads. */
import { api } from "../api.js";
import { esc, fmt } from "../util.js";
import { termLink } from "../components/glossary.js";

const LV = [
  ["صحيح", "grade-sahih"], ["حسن", "grade-hasan"], ["ضعيف", "grade-daif"],
  ["شديد الضعف", "grade-daif"], ["متهم بالوضع", "grade-mawdu"], ["موضوع", "grade-mawdu"],
];
const GAPS = [
  ["2", "درجتان فأكثر"], ["3", "ثلاث درجات فأكثر"], ["4", "أربع درجات فأكثر"], ["5", "الأقصى: صحيح ↔ موضوع"],
];

export async function conflicts({ params }) {
  const minGap = params.get("minGap") ?? "2";
  const offset = Number(params.get("offset") ?? 0);
  const { conflicts: items, total } = await api.conflicts(minGap, offset);
  document.title = "تعارض الأحكام بين الطرق — الجامع";

  const chips = GAPS.map(([g, l]) =>
    `<a class="fchip ${g === minGap ? "active" : ""}" href="#/conflicts?minGap=${g}">${l}</a>`).join("");

  const list = items.map((it) => {
    const badges = it.dist.map((d) =>
      `<span class="badge ${LV[d.lv]?.[1] ?? ""}">${LV[d.lv]?.[0] ?? "?"}${d.c > 1 ? ` ×${fmt(d.c)}` : ""}</span>`).join(" ");
    return `
    <a class="card result-card" href="#/hadith/${it.hadithId}">
      <div class="nass nass-sm">${esc(it.taraf ?? "")}</div>
      <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap;align-items:center">
        ${badges}
        <span class="tag-count" style="margin-inline-start:auto">${esc(it.book ?? "")}${it.noInBook ? ` · ${fmt(it.noInBook)}` : ""} · ${fmt(it.sanads)} طرق</span>
      </div>
    </a>`;
  }).join("") || `<div class="empty">لا تعارض بهذه الشدة ضمن نطاقك</div>`;

  const hasMore = offset + 40 < total;
  return `
  <div class="spread" style="margin-bottom:6px">
    <h1 style="margin:0;font-size:26px">تعارض الأحكام بين الطرق</h1>
    <span class="badge">${fmt(total)} حديثاً</span>
  </div>
  <p class="muted" style="margin:0 0 14px;line-height:1.9">
    قد يصحّ المتن من ${termLink("__", "طريقٍ")} ويضعف من آخر — واختلافُ الحكم بين الطرق
    <b>لا يعني تناقض الحديث ولا ضعفه بإطلاق</b>؛ بل هو صميم ${termLink("__", "علم العلل")}: كل طريقٍ
    يُحكَم على حِدَة، والعبرة بأقواها. هذه قائمةٌ تعليمية مرتّبةٌ بشدّة التباين — افتح الحديث لترى
    حكم كل طريقٍ وسببه.
  </p>
  <div class="gfilters" style="margin-bottom:16px"><div class="grp"><b>شدّة التعارض</b>${chips}</div></div>
  <div class="grid">${list}</div>
  <div class="pager">
    ${offset > 0 ? `<a class="btn" href="#/conflicts?minGap=${minGap}&offset=${Math.max(0, offset - 40)}">السابق</a>` : ""}
    ${hasMore ? `<a class="btn" href="#/conflicts?minGap=${minGap}&offset=${offset + 40}">التالي</a>` : ""}
  </div>`;
}
