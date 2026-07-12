/**
 * فحص الاتصال الزمني — render the chronological contact audit: each link of a
 * chain is shown between its two narrators, coloured by verdict. Advisory, not
 * a ruling — only a confirmed break (student born after the teacher died, or an
 * explicit marker) is flagged red; large tabaqa jumps are amber "worth checking".
 */
import { esc, fmt, rankVar } from "../util.js";
import { termLink } from "./glossary.js";

const V = {
  ok: { cls: "c-ok", icon: "✓" },
  note: { cls: "c-note", icon: "•" },
  suspect: { cls: "c-suspect", icon: "⚠" },
  break: { cls: "c-break", icon: "⌁" },
};

const yr = (n) => (n?.death ? `ت ${fmt(n.death)}هـ` : n?.deathRaw ? `ت ${esc(n.deathRaw)}هـ` : "");

function narratorRow(n) {
  return `<div class="c-node">
    <a href="#/rawi/${n.rawiId}">${esc(n.name)}</a>
    <span class="c-meta">${n.tabaka ? `الطبقة ${fmt(n.tabaka)}` : ""}${yr(n) ? " · " + yr(n) : ""}</span>
  </div>`;
}

export function renderContact(data) {
  if (!data.sanads?.length)
    return `<div class="muted" style="padding:8px">لا بيانات إسناد.</div>`;

  return data.sanads.map((s, si) => {
    const summary = s.flags
      ? `<span class="badge grade-daif">${fmt(s.flags)} موضع يستدعي النظر</span>`
      : `<span class="badge grade-sahih">لا قفزات ظاهرة في الطبقات</span>`;
    const seq = s.timeline;
    let body = "";
    for (let i = 0; i < seq.length; i++) {
      body += narratorRow(seq[i]);
      const link = s.links[i];
      if (link) {
        const v = V[link.verdict] ?? V.ok;
        body += `<div class="c-link ${v.cls}">
          <span class="c-ic">${v.icon}</span>
          <span>${link.note ? esc(link.note) : `فارق ${link.tGap >= 0 ? "+" : ""}${fmt(link.tGap)} طبقة`}</span>
        </div>`;
      }
    }
    return `<div class="contact-sanad">
      <div class="spread" style="margin-bottom:6px">
        <strong>الإسناد${data.sanads.length > 1 ? ` ${fmt(si + 1)}` : ""}</strong>
        ${summary}
      </div>
      <div class="c-flow">${body}</div>
    </div>`;
  }).join("") +
  `<div class="muted" style="margin-top:10px;font-size:12.5px">
    الفحص قرينةٌ مُعِينة لا حُكم: القفزة الكبيرة في ${termLink("tabaqa", "الطبقات")} قد تدلّ على ${termLink("inqita", "انقطاع")} خفيّ،
    والانقطاع المؤكَّد يكون بولادة التلميذ بعد وفاة شيخه.
  </div>`;
}
