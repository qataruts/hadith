/** Topic tree browser — drill down 54,862 subjects to hadith. */
import { api } from "../api.js";
import { esc, fmt } from "../util.js";
import { groupCard, hadithCard } from "../components/cards.js";

const LV = [
  ["صحيح", "var(--rk-thiqa)"], ["حسن", "var(--rk-saduq)"], ["ضعيف", "var(--rk-daif)"],
  ["شديد الضعف", "var(--serious)"], ["متهم بالوضع", "var(--rk-matruk)"], ["موضوع", "var(--critical)"],
  ["غير محدَّد", "var(--rk-unknown)"],
];
const lvIdx = (lv) => (lv < 0 ? 6 : lv);

function renderTopicAudit(d) {
  if (!d || !d.total) return `<div class="muted">لا أحاديث مصنَّفة في هذا الباب</div>`;
  const bar = d.dist.map((x) =>
    `<span title="${LV[lvIdx(x.lv)][0]}: ${fmt(x.c)}" style="flex:${x.c};background:${LV[lvIdx(x.lv)][1]}"></span>`).join("");
  const kids = d.children.slice().sort((a, b) => b.weakPct - a.weakPct);
  return `
    <div class="audit-headline">يضمّ هذا الباب ${fmt(d.total)} حديثاً — الصحيح والحسن ${d.soundPct}%، والضعيف فما دونه ${d.weakPct}%.</div>
    <div class="grade-bar">${bar}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0">
      ${d.dist.map((x) => `<span class="badge" style="border-inline-start:4px solid ${LV[lvIdx(x.lv)][1]};padding-inline-start:8px">${LV[lvIdx(x.lv)][0]} ${fmt(x.c)}</span>`).join("")}
    </div>
    <div class="muted" style="font-size:12.5px;line-height:1.9">
      ارتفاعُ نسبة الضعيف في بعض الأبواب (كالرقائق والفضائل) أمرٌ معروفٌ عند أهل العلم لا عيبٌ في الباب،
      والعبرة في كل حديثٍ بأقوى طرقه. هذا توزيعٌ للأحكام كما دُوِّنت لا إعادةَ حكم.
    </div>
    ${kids.length ? `<div class="sec-title" style="margin-top:6px">الفروع مرتَّبةً بنسبة الضعف</div>
      <div class="topic-audit-kids">
        ${kids.map((c) => `
          <a class="taudit-kid" href="#/topics/${c.id}">
            <span class="tk-name">${esc(c.name.length > 60 ? c.name.slice(0, 60) + "…" : c.name)}</span>
            <span class="tk-meter"><span style="width:${c.weakPct}%"></span></span>
            <span class="tk-pct muted">${fmt(c.total)} · ضعف ${c.weakPct}%</span>
          </a>`).join("")}
      </div>` : ""}`;
}


export async function topicsPage({ args: [id] }) {
  if (!id) {
    const { topics } = await api.topics();
    const root = topics[0];
    if (root) return topicsPage({ args: [root.topicId] });
    return `<div class="empty">لا موضوعات</div>`;
  }

  const t = await api.topic(id);
  if (!t) return `<div class="empty">الموضوع غير موجود</div>`;

  // breadcrumb by walking parents (levels are shallow; a few requests max)
  const crumbs = [];
  let p = t.parentId;
  let guard = 0;
  while (p && guard++ < 8) {
    const pt = await api.topic(p);
    if (!pt) break;
    crumbs.unshift(`<a href="#/topics/${pt.topicId}">${esc(pt.name.slice(0, 40))}</a>`);
    p = pt.parentId;
  }

  return `
  <div class="crumbs">${crumbs.length ? crumbs.join(" ‹ ") + " ‹ " : ""}<strong>${esc(t.name.slice(0, 60))}</strong></div>

  <div class="card">
    <h2 style="margin:0;font-size:20px">${esc(t.name)}</h2>
    <div class="muted" style="margin-top:4px">
      المستوى ${fmt(t.level)}${t.childCount ? ` · ${fmt(t.childCount)} فرعاً` : ""}
    </div>
  </div>

  ${t.children?.length ? `<div class="card no-print" id="topic-audit-host" data-tid="${t.topicId}" style="margin-top:14px">
    <div class="spread" style="align-items:center">
      <h3 style="margin:0">الخلاصة النقدية للباب</h3>
      <span class="nibras-tag">نبراس · توزيعُ الأحكام كما دُوِّنت</span>
    </div>
    <div id="topic-audit-body" style="margin-top:10px"><div class="skeleton" style="height:90px"></div></div>
  </div>` : ""}

  ${t.children?.length ? `
    <div class="sec-title">الفروع</div>
    <div class="grid grid-3">
      ${t.children.map((c) => `
        <a class="card result-card" href="#/topics/${c.topicId}">
          <div style="font-size:14px">${esc(c.name.length > 90 ? c.name.slice(0, 90) + "…" : c.name)}</div>
          <div class="muted" style="margin-top:6px">${c.childCount ? `${fmt(c.childCount)} فرعاً` : c.groupId ? "معنى مسند" : ""}</div>
        </a>`).join("")}
    </div>` : ""}

  ${t.group ? `
    <div class="sec-title">المعنى المسند</div>
    ${groupCard({ ...t.group, sahabiCount: t.group.sahabis?.length, bookCount: t.group.books?.length })}
    <div class="sec-title">من رواياته</div>
    <div class="grid">${(t.narrations ?? []).map(hadithCard).join("")}</div>` : ""}`;
}

document.addEventListener("page:rendered", () => {
  const host = document.getElementById("topic-audit-host");
  if (!host || host.dataset.bound) return;
  host.dataset.bound = "1";
  const body = document.getElementById("topic-audit-body");
  api.nibrasTopicAudit(host.dataset.tid)
    .then((d) => { body.innerHTML = renderTopicAudit(d); })
    .catch(() => { body.innerHTML = `<div class="muted">تعذّرت الخلاصة</div>`; });
});
