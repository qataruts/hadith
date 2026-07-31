/** فهرسُ العلل — browse hadith by the STRUCTURED defect type parsed from the
 * recorded hukum (م٤): إرسال · انقطاع · تدليس · جهالة · ضعف راوٍ … Descriptive:
 * these are the recorded gradings' own stated 3ilal, surfaced for study — never
 * a new ruling. Each hadith links to its full unified file. */
import { api } from "../api.js";
import { esc, fmt } from "../util.js";

const HINT = {
  idal: "سقط منه أكثرُ من راوٍ متوالٍ", irsal: "رفعه تابعيٌّ إلى النبي ﷺ بلا صحابيّ",
  inqita: "لم يسمعْ راوٍ ممّن فوقه", taleeq: "حُذف أوّلُ إسناده", tadlis: "روى مدلّسٌ بصيغةٍ محتمِلة",
  wad: "في سنده متّهمٌ بالوضع أو الكذب", nakara: "تفرّد بما يُنكَر", jahala: "في سنده مجهولٌ لا يُعرف",
  daif: "في سنده ضعيفُ الحفظ أو الضبط",
};

export async function ilal({ params }) {
  const type = params.get("type") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const { types, items, total } = await api.ilal(type, offset);
  document.title = "فهرسُ العلل — الجامع";

  const active = type || types[0]?.key || "";
  // if no type was requested, land on the first (most-structural) one
  if (!type && active) { location.replace(`#/ilal?type=${active}`); return `<div class="skeleton" style="height:200px"></div>`; }

  const chips = types.map((t) =>
    `<a class="fchip ${t.key === active ? "active" : ""}" href="#/ilal?type=${t.key}"
        title="${esc(HINT[t.key] ?? "")}">${esc(t.label)} <span class="tag-count">${fmt(t.count)}</span></a>`).join("");

  const list = items.map((it) => `
    <a class="card result-card" href="#/hadith/${it.hadithId}">
      <div class="nass nass-sm">${esc(it.taraf ?? "")}</div>
      <div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap;align-items:center">
        <span class="tag-count">${esc(it.book ?? "")}${it.noInBook ? ` · ${fmt(it.noInBook)}` : ""}</span>
        <span class="row" style="gap:5px;flex-wrap:wrap;margin-inline-start:auto">
          ${(it.types ?? []).map((t) => `<span class="badge illa-badge">${esc(t)}</span>`).join("")}
        </span>
      </div>
    </a>`).join("");

  const pager = total > items.length + offset || offset > 0 ? `
    <div class="pager" style="margin-top:16px">
      ${offset > 0 ? `<a class="btn" href="#/ilal?type=${active}&offset=${Math.max(0, offset - 40)}">→ السابق</a>` : ""}
      <span class="muted">${fmt(offset + 1)}–${fmt(offset + items.length)} من ${fmt(total)}</span>
      ${offset + items.length < total ? `<a class="btn" href="#/ilal?type=${active}&offset=${offset + 40}">التالي ←</a>` : ""}
    </div>` : "";

  return `
    <div class="search-hero" style="padding:20px 0 6px">
      <h1 style="font-size:26px">فهرسُ العلل</h1>
      <p>تصفَّحِ الأحاديثَ بحسب العلّةِ المذكورةِ في حكمها — مستخرَجةً آليًّا من نصِّ الحكم.
        <br/><span class="badge grade-hasan" style="margin-top:6px">وصفٌ للعلّةِ المدوَّنة يُعينُ على الدراسة، لا حكمٌ جديد؛ والحكمُ منقولٌ كما هو.</span></p>
    </div>
    <div class="gfilters" style="margin:10px 0 16px">${chips}</div>
    <div class="muted" style="margin-bottom:10px">${esc(HINT[active] ?? "")} — <b>${fmt(total)}</b> حديثاً.</div>
    <div class="grid">${list || `<div class="empty">لا نتائج ضمن النطاق</div>`}</div>
    ${pager}`;
}
