/** Meaning-group page — the heart of the app: everything about one meaning. */
import { api } from "../api.js";
import { esc, fmt, gradeBadge, onVisible } from "../util.js";
import { tabaqatChart, bars } from "../components/charts.js";
import { hadithCard } from "../components/cards.js";
import { mountIsnadTree } from "../components/tree.js";
import { renderMatnDiff } from "../components/matndiff.js";
import { renderGeoMap } from "../components/geomap.js";

export async function groupPage({ args: [id], params }) {
  const offset = Number(params.get("offset") ?? 0);
  const g = await api.group(id, 30, offset);
  if (!g) return `<div class="empty">المعنى غير موجود</div>`;
  document.title = `معنى: ${g.nass.slice(0, 40)}… — الجامع`;
  queueMicrotask(() => {   // highlight the narration the user came from
    const from = params.get("from");
    if (!from) return;
    const el = document.querySelector(`a[href="#/hadith/${from}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.animate([{ outline: "2px solid var(--gold)" }, { outline: "none" }], 1800);
  });

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
      ${g.scopedBooks ? `<span class="badge grade-hasan" title="الأرقام محسوبة ضمن الكتب المختارة">ضمن ${fmt(g.scopedBooks)} كتاباً مختاراً</span>` : ""}
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3 style="margin:0 0 4px" data-group="${g.groupId}" id="tree-anchor">شجرة الإسناد <span class="tag-count">لون كل راوٍ = درجته · لون الخط = أضعف حلقة</span></h3>
    <div class="gfilters" id="tree-filters"></div>
    <div class="row" id="tree-head" style="margin:6px 0"></div>
    <div id="isnad-tree"><div class="skeleton" style="height:300px"></div></div>
    <div class="muted" style="margin-top:8px;line-height:1.9">
      <strong style="color:var(--ink-2)">كيف نلخّص؟</strong> يبدأ الرسم بعرضٍ مختصرٍ يُبرز الرواة الأكثر وروداً في الطرق
      (محور الإسناد)، وتُخفى الطرق النادرة؛ الرقم <b>+N</b> تحت اسم الراوي = عدد طرقه المخفية، اضغطه لتوسيعها،
      أو اضغط <b>«توسيع كل الأسانيد»</b> لإظهار كل الطرق دفعةً واحدة ثم <b>«العرض المختصر»</b> للعودة.
      <br/>اسحب للتنقل · عجلة الفأرة للتكبير · ⛶ لملء الشاشة · اضغط راوياً لبطاقته ومرتين لصفحته · اضغط أي خط لعرض رواياته ونصوصها.
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

  <div class="card no-print" id="geo-host" data-group="${g.groupId}">
    <h3 style="margin:0">مسار الانتقال الجغرافي</h3>
    <p class="muted" style="margin:6px 0 0">كيف انتقل هذا المعنى بين الأمصار على ألسنة الرواة — من مواطنهم ووفياتهم.</p>
    <div id="geo-body" style="margin-top:12px"></div>
  </div>

  <div class="card no-print" id="matndiff-host" data-group="${g.groupId}">
    <h3 style="margin:0">مقارنة الألفاظ — الزيادات والاختلاف بين الطرق</h3>
    <p class="muted" style="margin:6px 0 0">محاذاة ألفاظ الروايات لإبراز الزيادات (ziyādāt) ومواضع الاختلاف بينها.</p>
    <div id="matndiff-body" style="margin-top:12px"></div>
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

let treeReq = 0;             // stale async loads must not hijack a newer page/filter
let treeInstance = null;
let treeFull = null;         // unfiltered tree (for sahabi chips)

// Teardown on every navigation: kills the tree's document-level listeners and
// scroll lock, and invalidates any in-flight loadTree continuation (which
// would otherwise mount into a detached holder). Re-entering a group page
// re-runs loadTree via page:rendered.
addEventListener("hashchange", () => {
  treeReq++;
  treeInstance?.destroy();
  treeInstance = null;
});

// filter state. sahabi: undefined=auto-pick strongest, null=all, number=one.
const gs = { groupId: null, sahabi: undefined, grade: "", book: 0, problems: false };

async function loadTree(patch = {}) {
  Object.assign(gs, patch);
  const req = ++treeReq;
  const holder = document.getElementById("isnad-tree");
  if (!holder) return;
  treeInstance?.destroy();
  treeInstance = null;
  holder.innerHTML = `<div class="skeleton" style="height:300px"></div>`;
  const params = {};
  if (gs.sahabi) params.sahabi = gs.sahabi;
  if (gs.grade) params.grade = gs.grade;
  if (gs.book) params.book = gs.book;
  if (gs.problems) params.problems = 1;
  try {
    let tree = await api.groupTree(gs.groupId, params);
    if (req !== treeReq) return;
    if (!tree) { holder.innerHTML = `<div class="empty">لا أسانيد</div>`; return; }
    // first view: focus the strongest companion (one sahabi is far clearer than 60)
    if (gs.sahabi === undefined && !gs.grade && !gs.book && !gs.problems
        && tree.sahabis.length > 1) {
      treeFull = tree;                       // keep the global facets
      gs.sahabi = tree.sahabis[0].rawiId;
      tree = await api.groupTree(gs.groupId, { sahabi: gs.sahabi });
      if (req !== treeReq) return;
    }
    treeFull ??= tree;
    if (!holder.isConnected) return;

    const head = document.getElementById("tree-head");
    if (head)
      head.innerHTML = (tree.madar
        ? `<span class="badge grade-hasan">◈ مدار الحديث: ${esc(tree.madar.name)} — ${fmt(tree.madar.count)} طريقاً</span>` : "")
        + `<span class="badge">${fmt(tree.chains)} إسناد${tree.chains !== tree.totalChains ? ` من ${fmt(tree.totalChains)}` : ""}</span>`
        + (tree.chains === 0 ? ` <span class="badge grade-daif">لا نتائج بهذه المرشِّحات</span>` : "");

    renderFilters();
    if (tree.chains === 0) {
      holder.innerHTML = `<div class="empty">لا طرق مطابقة لهذه المرشِّحات — <button class="chip" id="clear-f">إلغاء المرشِّحات</button></div>`;
      holder.querySelector("#clear-f").onclick = () =>
        loadTree({ grade: "", book: 0, problems: false });
      return;
    }
    treeInstance = mountIsnadTree(holder, tree, {
      budget: gs.sahabi ? 46 : 60,
      fetchRawi: (id) => api.rawi(id),
      onEdge: (from, to) => {
        const f = {};
        if (gs.sahabi) f.sahabi = gs.sahabi;
        if (gs.grade) f.grade = gs.grade;
        if (gs.book) f.book = gs.book;
        if (gs.problems) f.problems = 1;
        return api.groupEdge(gs.groupId, from, to, f).then((r) => r.narrations);
      },
    });
  } catch (e) {
    holder.innerHTML = `<div class="empty">تعذر رسم الشجرة — ${esc(e.message)}</div>`;
  }
}

function renderFilters() {
  const el = document.getElementById("tree-filters");
  if (!el || !treeFull) return;
  const chip = (active, label, on, cls = "") =>
    `<button class="fchip ${cls} ${active ? "active" : ""}" data-on='${esc(JSON.stringify(on))}'>${label}</button>`;
  const parts = [];
  if (treeFull.sahabis.length > 1)
    parts.push(`<div class="grp"><b>الصحابي</b>`
      + chip(gs.sahabi === null, `الكل (${fmt(treeFull.totalChains)})`, { sahabi: null })
      + treeFull.sahabis.slice(0, 6).map((s) =>
          chip(gs.sahabi === s.rawiId, `${esc(s.name)} (${fmt(s.count)})`, { sahabi: s.rawiId })).join("")
      + `</div>`);
  if (treeFull.grades?.length > 1)
    parts.push(`<div class="grp"><b>الدرجة</b>`
      + chip(!gs.grade, "الكل", { grade: "" })
      + treeFull.grades.map((g) =>
          chip(gs.grade === g.key, `${g.label} (${fmt(g.count)})`, { grade: g.key })).join("")
      + `</div>`);
  if (treeFull.books?.length > 1)
    parts.push(`<div class="grp"><b>الكتاب</b>`
      + chip(!gs.book, "الكل", { book: 0 })
      + treeFull.books.slice(0, 6).map((b) =>
          chip(gs.book === b.bookId, `${esc(b.name)} (${fmt(b.count)})`, { book: b.bookId })).join("")
      + `</div>`);
  parts.push(`<div class="grp">${chip(gs.problems, "المشاكل فقط ⚠", { problems: !gs.problems }, "warn")}</div>`);
  el.innerHTML = parts.join("");
  el.querySelectorAll("[data-on]").forEach((b) =>
    (b.onclick = () => loadTree(JSON.parse(b.dataset.on))));
}

document.addEventListener("page:rendered", () => {
  const a = document.getElementById("tree-anchor");
  if (a?.dataset.group && !a.dataset.bound) {
    a.dataset.bound = "1";
    treeFull = null;
    Object.assign(gs, { groupId: Number(a.dataset.group), sahabi: undefined, grade: "", book: 0, problems: false });
    loadTree();
  }

  const geo = document.getElementById("geo-host");
  if (geo && !geo.dataset.bound) {
    geo.dataset.bound = "1";
    const gid = Number(geo.dataset.group);
    const body = document.getElementById("geo-body");
    onVisible(geo, async () => {
      body.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
      try { body.innerHTML = renderGeoMap(await api.groupGeo(gid)); }
      catch { body.innerHTML = `<div class="muted">تعذّرت الخريطة</div>`; }
    });
  }

  const md = document.getElementById("matndiff-host");
  if (md && !md.dataset.bound) {
    md.dataset.bound = "1";
    const gid = Number(md.dataset.group);
    const body = document.getElementById("matndiff-body");
    let data = null;
    const paint = (baseIdx) => { body.innerHTML = renderMatnDiff(data, baseIdx); };
    onVisible(md, async () => {
      body.innerHTML = `<div class="skeleton" style="height:140px"></div>`;
      try { data = await api.groupMatns(gid); paint(0); }
      catch { body.innerHTML = `<div class="muted">تعذّرت المقارنة</div>`; }
    });
    md.addEventListener("change", (e) => {
      if (e.target.id === "diff-base" && data) paint(Number(e.target.value));
    });
  }
});
