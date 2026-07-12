/**
 * Interactive glossary of hadith-science terms. Any element with
 * data-term="key" becomes a dotted, tappable term; a global click handler
 * shows its plain-Arabic definition in a popover. Also renders a full
 * glossary panel. termLink(key, label?) builds an inline term span.
 */
import { esc } from "../util.js";

export const TERMS = {
  tadlis: ["التدليس", "أن يروي الراوي عمّن عاصره ما لم يسمعه منه بصيغة توهم السماع (كـ«عن»)، فيُخشى سقوط راوٍ ضعيف بينهما."],
  ikhtilat: ["الاختلاط", "فساد حفظ الراوي في آخر عمره؛ فيُقبل ما رواه عنه من سمع منه قبل اختلاطه، ويُتوقف فيمن سمع بعده."],
  madar: ["مدار الحديث", "الراوي الذي تلتقي عنده طرق الحديث وتدور عليه؛ إذا تفرّد به فمداره عليه وحده."],
  mutabaa: ["المتابعة", "موافقة راوٍ لراوٍ آخر في روايته عن شيخه أو من فوقه، تقوّي الحديث. (تامّة إن وافقه في شيخه، قاصرة إن وافقه فيمن فوقه)."],
  shahid: ["الشاهد", "حديث آخر بمعنى الحديث يُروى من طريق صحابيٍّ آخر، يعضده ويقوّيه."],
  anana: ["العنعنة", "رواية الحديث بصيغة «عن فلان» دون تصريح بالسماع؛ محتملة للاتصال والانقطاع، وتُقبل من غير المدلِّس."],
  inqita: ["الانقطاع", "سقوط راوٍ أو أكثر من الإسناد، فلا يكون متصلاً؛ وهو من أسباب الضعف."],
  irsal: ["الإرسال", "رواية التابعي الحديث عن النبي ﷺ مباشرةً بإسقاط الصحابي."],
  thiqa: ["الثقة", "الراوي العدل الضابط لما يرويه؛ تُقبل روايته ويُحتجّ بها."],
  saduq: ["الصدوق", "من خفّ ضبطه قليلاً مع عدالته؛ حديثه في رتبة الحسن."],
  daif: ["الضعيف", "من لا يُحتجّ بحديثه لخللٍ في ضبطه أو عدالته؛ وقد يتقوّى بالمتابعات والشواهد."],
  matruk: ["المتروك", "من اتُّهم بالكذب أو فحُش غلطه؛ لا يُكتب حديثه ولا يُعتبر به."],
  majhul: ["المجهول", "من لم تُعرف عينه أو حاله؛ لا تُقبل روايته حتى يُعرف."],
  tabaqa: ["الطبقة", "جيلٌ من الرواة متقاربون في السنّ والأخذ عن الشيوخ؛ تُعرف بها معاصرة الرواة."],
  musannif: ["المصنِّف", "مؤلّف الكتاب الذي خرّج الحديث بإسناده."],
  marfu: ["المرفوع", "ما أُضيف إلى النبي ﷺ من قولٍ أو فعلٍ أو تقرير."],
  mawquf: ["الموقوف", "ما أُضيف إلى الصحابي من قوله أو فعله ولم يُرفع إلى النبي ﷺ."],
  maqtu: ["المقطوع", "ما أُضيف إلى التابعي فمن دونه من قولٍ أو فعل."],
  weakest: ["أضعف حلقة", "أضعف راوٍ في الإسناد؛ والإسناد لا يقوى إلا بأضعف رجاله."],
};

export const termLink = (key, label) => {
  const t = TERMS[key];
  if (!t) return esc(label ?? key);
  return `<span class="term" data-term="${key}" tabindex="0" role="button">${esc(label ?? t[0])}</span>`;
};

let pop;
function ensurePopover() {
  if (pop) return pop;
  pop = document.createElement("div");
  pop.className = "term-pop";
  pop.hidden = true;
  document.body.appendChild(pop);
  return pop;
}
function showTerm(el) {
  const key = el.dataset.term;
  const t = TERMS[key];
  if (!t) return;
  const p = ensurePopover();
  p.innerHTML = `<strong>${esc(t[0])}</strong><div>${esc(t[1])}</div>`;
  p.hidden = false;
  const r = el.getBoundingClientRect();
  p.style.top = `${window.scrollY + r.bottom + 6}px`;
  const w = Math.min(320, window.innerWidth - 24);
  p.style.width = `${w}px`;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
  p.style.left = `${left}px`;
}
export function hideTerm() { if (pop) pop.hidden = true; }

/** Install once: global delegation so any [data-term] anywhere works. */
export function initGlossary() {
  if (window.__glossaryReady) return;
  window.__glossaryReady = true;
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-term]");
    if (t) { e.stopPropagation(); showTerm(t); }
    else if (!e.target.closest(".term-pop")) hideTerm();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTerm();
    if (e.key === "Enter" && document.activeElement?.dataset?.term) showTerm(document.activeElement);
  });
  addEventListener("hashchange", hideTerm);
}

/** Full glossary panel (for a dedicated view or a help drawer). */
export function glossaryPanel() {
  return `<div class="grid grid-2">${Object.entries(TERMS)
    .map(([, [term, def]]) => `<div class="card" style="padding:12px 16px">
      <strong>${esc(term)}</strong>
      <div class="muted" style="margin-top:4px;font-size:13px">${esc(def)}</div>
    </div>`).join("")}</div>`;
}
