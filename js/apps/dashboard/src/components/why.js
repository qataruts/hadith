/** Render a per-sanad "why this ruling?" explanation in plain Arabic with
 * clickable glossary terms. GRADE-AWARE: for an authenticated hadith the
 * narrator traits (tadlis/ikhtilat) are shown as neutral notes the scholars
 * accounted for — never as defects that contradict the recorded ruling. For a
 * weak hadith they are presented as the causes of weakness. */
import { esc } from "../util.js";
import { termLink } from "./glossary.js";

const rawiLink = (id, name) => `<a href="#/rawi/${id}">${esc(name)}</a>`;

function rankTerm(rank = "") {
  const k = /متروك|كذاب|وضاع/.test(rank) ? "matruk"
    : /ضعيف|منكر/.test(rank) ? "daif"
    : /مجهول|مستور|مقبول|لين/.test(rank) ? "majhul"
    : /صدوق|لا بأس/.test(rank) ? "saduq"
    : /ثقة|حافظ|إمام|حجة|ثبت/.test(rank) ? "thiqa" : null;
  return k ? termLink(k, rank) : esc(rank);
}

export function renderWhy(sanad) {
  const strong = sanad.gradeClass === "sahih" || sanad.gradeClass === "hasan";
  const obs = sanad.observations ?? [];

  const line = (iss) => {
    switch (iss.type) {
      case "weak":
        return strong
          ? `أدنى رجاله رتبةً ${rawiLink(iss.rawiId, iss.name)} (${rankTerm(iss.rank ?? iss.label)})، وقد احتُجّ بحديثه هنا.`
          : `أضعف رجاله ${rawiLink(iss.rawiId, iss.name)} — ${rankTerm(iss.rank ?? iss.label)}؛ و${termLink("weakest", "الإسناد لا يقوى إلا بأضعف رجاله")}.`;
      case "tadlis":
        return strong
          ? `من رجاله من وُصف بـ${termLink("tadlis")}: ${rawiLink(iss.rawiId, iss.name)}، وقد احتُجّ بحديثه هنا (يُنظر تصريحه بالسماع).`
          : `فيه ${termLink("tadlis")}: ${rawiLink(iss.rawiId, iss.name)} موصوف به، فيُتوقّف في ${termLink("anana", "عنعنته")} حتى يُصرّح بالسماع.`;
      case "ikhtilat":
        return strong
          ? `من رجاله من وقع له ${termLink("ikhtilat")}: ${rawiLink(iss.rawiId, iss.name)}، وحديثه هنا محمول على الصحّة.`
          : `فيه من وقع له ${termLink("ikhtilat")}: ${rawiLink(iss.rawiId, iss.name)}، فيُنظر أسُمع منه قبل اختلاطه أم بعده.`;
      case "inqita":
        return `فيه ${termLink("inqita")} — ${esc(iss.name)}.`;
      default: return "";
    }
  };

  const head = strong
    ? `<div class="why-verdict ok">إسناد ظاهره ${sanad.gradeClass === "sahih" ? "الصحّة" : "الحُسن"}${obs.length ? "، مع فوائد إسنادية:" : "، ولا مأخذ ظاهر على رجاله."}</div>`
    : obs.length
      ? `<div class="why-verdict warn">مواطن الضعف في هذا الإسناد:</div>`
      : `<div class="why-verdict">الحكم مستند إلى نصّ المصدر.</div>`;

  const bullets = obs.map((o) => `<li>${line(o)}</li>`).filter(Boolean).join("");
  return `<div class="why-box">
    ${head}
    ${bullets ? `<ul class="why-list">${bullets}</ul>` : ""}
    ${sanad.hukm ? `<div class="muted" style="margin-top:6px">نصّ الحكم في المصدر: «${esc(sanad.hukm)}»</div>` : ""}
  </div>`;
}
