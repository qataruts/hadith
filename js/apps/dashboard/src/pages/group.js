/** Meaning-group page — the heart of the app: everything about one meaning. */
import { api } from "../api.js";
import { esc, fmt, gradeBadge } from "../util.js";
import { tabaqatChart, bars } from "../components/charts.js";
import { hadithCard } from "../components/cards.js";
import { renderTree, bindTree } from "../components/tree.js";

export async function groupPage({ args: [id], params }) {
  const offset = Number(params.get("offset") ?? 0);
  const g = await api.group(id, 30, offset);
  if (!g) return `<div class="empty">المعنى غير موجود</div>`;

  return `
  <div class="crumbs"><a href="#/search?mode=group">الأطراف</a> ‹ معنى ${fmt(g.groupId)}</div>

  <div class="card">
    <div class="nass" style="font-size:24px">${esc(g.nass)}</div>
    <div class="row" style="margin-top:14px">
      <span class="badge">${fmt(g.hadithCount)} رواية</span>
      <span class="badge rank-sahabi">${fmt(g.sahabis.length)} صحابي</span>
      <span class="badge">${fmt(g.books.length)} كتاب</span>
      <span class="badge">${fmt(g.takhrijCount)} طريق تخريج</span>
      ${g.isQudsi ? `<span class="badge grade-hasan">قدسي</span>` : ""}
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="spread">
      <h3 style="margin:0">شجرة الإسناد <span class="tag-count">كل طرق هذا المعنى في رسم واحد</span></h3>
      <div class="row" id="tree-filters" data-group="${g.groupId}"></div>
    </div>
    <div id="isnad-tree" style="margin-top:12px"><div class="skeleton" style="height:260px"></div></div>
    <div class="muted" style="margin-top:8px">
      أعلى الشجرة النبي ﷺ، ثم الصحابة (بالذهبي)، نزولاً بالطبقات إلى مصنّفي الكتب.
      سماكة الخط = عدد الطرق المارّة به · مرّر على راوٍ لإضاءة طرقه · اضغط لفتح ترجمته.
    </div>
  </div>

  <div class="grid grid-2" style="margin-top:14px">
    <div class="card">
      <h3>الصحابة الرواة</h3>
      ${bars(g.sahabis.map((s) => ({
        label: s.name ?? `راوٍ ${s.rawiId}`, value: s.count,
        href: `#/rawi/${s.rawiId}`, title: "عدد طرقه" })), { maxBars: 12 })}
    </div>
    <div class="card">
      <h3>الرواة في كل طبقة</h3>
      <div class="muted" style="margin-bottom:8px">كم راوياً مختلفاً حمل هذا المعنى في كل جيل</div>
      ${tabaqatChart(g.tabaqat)}
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3>انتشاره في الكتب</h3>
    ${bars(g.books.map((b) => ({
      label: b.name, value: b.count, href: `#/book/${b.bookId}` })), { maxBars: 12 })}
  </div>

  <div class="sec-title">الروايات</div>
  <div class="grid">${(g.narrations ?? []).map(hadithCard).join("") || `<div class="empty">لا روايات</div>`}</div>
  ${g.hadithCount > 30 ? `
    <div class="pager">
      ${offset > 0 ? `<a class="btn" href="#/group/${g.groupId}?offset=${Math.max(0, offset - 30)}">السابق</a>` : ""}
      <span class="muted" style="align-self:center">${fmt(offset + 1)}–${fmt(Math.min(offset + 30, g.hadithCount))} من ${fmt(g.hadithCount)}</span>
      ${offset + 30 < g.hadithCount ? `<a class="btn" href="#/group/${g.groupId}?offset=${offset + 30}">التالي</a>` : ""}
    </div>` : ""}`;
}

const TREE_AUTO_LIMIT = 350; // above this many chains, start filtered to the top sahabi
let treeReq = 0;             // stale async loads must not hijack a newer page/filter

async function loadTree(groupId, sahabi) {
  const req = ++treeReq;
  const holder = document.getElementById("isnad-tree");
  if (!holder) return;
  holder.innerHTML = `<div class="skeleton" style="height:260px"></div>`;
  try {
    let tree = await api.groupTree(groupId, sahabi);
    if (req !== treeReq) return;
    if (!tree) { holder.innerHTML = `<div class="empty">لا أسانيد</div>`; return; }
    // huge bundle unfiltered → focus the strongest sahabi route by default
    if (!sahabi && tree.chains > TREE_AUTO_LIMIT && tree.sahabis.length > 1) {
      sahabi = tree.sahabis[0].rawiId;
      tree = await api.groupTree(groupId, sahabi);
      if (req !== treeReq) return;
    }
    holder.innerHTML =
      (tree.madar ? `<div class="row" style="margin-bottom:8px">
        <span class="badge grade-hasan">◈ مدار الحديث: ${esc(tree.madar.name)} — تلتقي عنده ${fmt(tree.madar.count)} طريقاً</span>
        <span class="badge">${fmt(tree.chains)} إسناد${tree.chains !== tree.totalChains ? ` من ${fmt(tree.totalChains)}` : ""}</span>
      </div>` : "") + renderTree(tree);
    bindTree(holder);

    const filters = document.getElementById("tree-filters");
    if (filters && tree.sahabis.length > 1) {
      const full = await (tree.chains === tree.totalChains ? tree : api.groupTree(groupId));
      if (req !== treeReq) return;
      filters.innerHTML = [
        `<button class="chip ${!sahabi ? "active" : ""}" data-s="">الكل (${fmt(full.totalChains)})</button>`,
        ...full.sahabis.slice(0, 6).map((s) =>
          `<button class="chip ${s.rawiId === sahabi ? "active" : ""}" data-s="${s.rawiId}">${esc(s.name)} (${fmt(s.count)})</button>`),
      ].join("");
      filters.querySelectorAll(".chip").forEach((b) =>
        (b.onclick = () => loadTree(groupId, Number(b.dataset.s) || undefined)));
    }
  } catch (e) {
    holder.innerHTML = `<div class="empty">تعذر رسم الشجرة — ${esc(e.message)}</div>`;
  }
}

document.addEventListener("page:rendered", () => {
  const f = document.getElementById("tree-filters");
  if (f?.dataset.group && !f.dataset.bound) {
    f.dataset.bound = "1";
    loadTree(Number(f.dataset.group));
  }
});
