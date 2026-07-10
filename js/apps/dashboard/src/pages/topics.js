/** Topic tree browser — drill down 54,862 subjects to hadith. */
import { api } from "../api.js";
import { esc, fmt } from "../util.js";
import { groupCard, hadithCard } from "../components/cards.js";

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
