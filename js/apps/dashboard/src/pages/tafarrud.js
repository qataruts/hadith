/** الأفراد والغرائب — meanings that exist in a single chain, filterable by the
 * weakest narrator's grade. Suspect singular narrations (أفراد الضعفاء) are the
 * classical hunting ground for منكر / موضوع. */
import { api } from "../api.js";
import { esc, rankBadge, rankVar } from "../util.js";
import { termLink } from "../components/glossary.js";

const GRADES = [
  ["", "الكل"], ["matruk", "متروك/وضّاع"], ["daif", "ضعيف"],
  ["majhul", "مجهول/مقبول"], ["saduq", "صدوق"], ["thiqa", "ثقة"],
];

export async function tafarrud({ params }) {
  const grade = params.get("grade") ?? "matruk";   // default to the suspect ones
  const offset = Number(params.get("offset") ?? 0);
  const { items, hasMore } = await api.tafarrud(grade, offset);
  document.title = "الأفراد والغرائب — الجامع";

  const chips = GRADES.map(([g, l]) =>
    `<a class="fchip ${g === grade ? "active" : ""}" href="#/tafarrud?grade=${g}">${l}</a>`).join("");

  const list = items.map((it) => `
    <a class="card result-card" href="#/hadith/${it.hadithId}">
      <div class="nass nass-sm">${esc(it.nass)}</div>
      <div class="row" style="margin-top:10px;gap:8px">
        <span style="border-inline-start:4px solid ${rankVar(it.weakest.rank)};padding-inline-start:8px">
          تفرّد به <b>${esc(it.weakest.name)}</b></span>
        ${rankBadge(it.weakest.rank)}
        <span class="muted">عن ${esc(it.sahabi.name)}</span>
        <span class="tag-count">${esc(it.book ?? "")}</span>
      </div>
    </a>`).join("") || `<div class="empty">لا أفراد بهذا الوصف</div>`;

  return `
  <div class="spread" style="margin-bottom:6px">
    <h1 style="margin:0;font-size:26px">الأفراد والغرائب</h1>
  </div>
  <p class="muted" style="margin:0 0 14px">
    أحاديثُ لم تأتِ إلا من ${termLink("__", "طريقٍ واحد")} (فرد مطلق)، مرتّبةٌ بحسب أضعف راوٍ فيها.
    ${termLink("__", "تفرُّد")} الثقة يُحتمل، وتفرُّد الضعيف والمتروك مظنّة ${termLink("__", "النكارة")} والوضع.
  </p>
  <div class="gfilters" style="margin-bottom:16px"><div class="grp"><b>أضعف راوٍ</b>${chips}</div></div>
  <div class="grid">${list}</div>
  <div class="pager">
    ${offset > 0 ? `<a class="btn" href="#/tafarrud?grade=${grade}&offset=${Math.max(0, offset - 40)}">السابق</a>` : ""}
    ${hasMore ? `<a class="btn" href="#/tafarrud?grade=${grade}&offset=${offset + 40}">التالي</a>` : ""}
  </div>`;
}
