/**
 * الاعتبار — render the auto-i'tibar analysis: pick a studied narrator in the
 * reference chain, and see every route of the meaning bucketed into متابعة
 * تامة / قاصرة / شاهد. Terms link to the glossary.
 */
import { esc, fmt, rankBadge, gradeBadge, rankVar } from "../util.js";
import { termLink } from "./glossary.js";

const list = (arr, empty) => arr.length
  ? `<div class="itibar-list">${arr.map((h) => `
      <a class="edge-item" href="#/hadith/${h.hadithId}">
        <div class="edge-item-head">
          <span class="muted">${esc(h.book ?? "")}${h.noInBook ? ` · ${fmt(h.noInBook)}` : ""}${h.via ? ` — عن طريق ${esc(h.via)}` : ""}${h.note ? ` — ${esc(h.note)}` : ""}</span>
          ${gradeBadge(h.hukm)}
        </div>
        ${h.taraf ? `<div class="edge-item-matn">${esc(h.taraf)}</div>` : ""}
      </a>`).join("")}</div>`
  : `<div class="muted" style="padding:6px 2px">${empty}</div>`;

export function renderItibar(d) {
  if (!d.available)
    return `<div class="muted" style="padding:8px">لا يمكن إجراء الاعتبار لهذا الحديث (لا مجموعة معنى مرتبطة).</div>`;

  const chip = (n) => `<button class="chip itibar-rawi ${n.isFocus ? "active" : ""}"
      data-rawi="${n.rawiId}" style="border-inline-start:4px solid ${rankVar(n.rank ?? "")}">
      ${esc(n.name)}${n.isCompanion ? " (صحابي)" : ""}</button>`;

  return `
    <div class="muted" style="margin-bottom:8px">
      اختر ${termLink("__", "الراوي المُعتبَر به")} من السلسلة (المُلوَّن الآن)، فنبيّن مَن تابعه ومَن شهد لحديثه:
    </div>
    <div class="row itibar-chain" style="gap:6px;margin-bottom:6px">${d.chain.map(chip).join("")}</div>
    <div class="muted" style="margin-bottom:14px;font-size:12.5px">
      المُعتبَر به: <b>${esc(d.focus.name)}</b> ${rankBadge(d.focus.rank)} · شيخه: <b>${esc(d.shaykh.name)}</b> · الصحابي: <b>${esc(d.companion.name)}</b>
    </div>

    <div class="itibar-grid">
      <div class="itibar-col">
        <h4>${termLink("mutabaa", "متابعة تامة")} <span class="tag-count">${fmt(d.counts.tamma)}</span></h4>
        <div class="muted" style="font-size:12px;margin-bottom:6px">شاركه غيرُه في الرواية عن شيخه نفسه.</div>
        ${list(d.tamma, "لا متابعة تامة — قد يكون متفرِّداً عن شيخه.")}
      </div>
      <div class="itibar-col">
        <h4>متابعة قاصرة <span class="tag-count">${fmt(d.counts.qasira)}</span></h4>
        <div class="muted" style="font-size:12px;margin-bottom:6px">التقى معه الطريق أعلى من شيخه المباشر.</div>
        ${list(d.qasira, "لا متابعة قاصرة.")}
      </div>
      <div class="itibar-col">
        <h4>${termLink("shahid", "شواهد")} <span class="tag-count">${fmt(d.counts.shawahid)}</span></h4>
        <div class="muted" style="font-size:12px;margin-bottom:6px">رواه صحابيٌّ آخر بمعناه.</div>
        ${list(d.shawahid, "لا شواهد من صحابةٍ آخرين.")}
      </div>
    </div>`;
}
