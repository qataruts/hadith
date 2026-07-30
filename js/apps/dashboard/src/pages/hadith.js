import { api } from "../api.js";
import { esc, fmt, gradeBadge, stripTashkeel, isnadLegend, onVisible } from "../util.js";
import { renderNass } from "../components/nass.js";
import { renderChain } from "../components/chain.js";
import { mountRawiPopup } from "../components/rawipop.js";
import { renderWhy } from "../components/why.js";
import { renderItibar } from "../components/itibar.js";
import { renderContact } from "../components/contact.js";
import { diff, words, renderOps } from "../components/matndiff.js";

/** شريط الطرق data for the current hadith: {base, sibs} — set while building the
 *  page, consumed by the page:rendered binder below. */
let routeSibs = null;

export async function hadithPage({ args: [id], render }) {
  routeSibs = null;
  const h = await api.hadith(id);
  if (!h) return `<div class="empty">الحديث غير موجود</div>`;
  const books = await api.books();
  const book = books.books.find((b) => b.bookId === h.bookId);
  document.title = `${book?.name ?? "حديث"} ${fmt(h.noInBook)} — الجامع`;

  const page = (extras) => `
  <div class="crumbs no-print">
    <a href="#/book/${h.bookId}">${esc(book?.name ?? "")}</a> ‹ حديث رقم ${fmt(h.noInBook)}
    ${extras.nav ?? ""}
  </div>

  <div class="card">
    <div class="spread no-print" style="margin-bottom:14px">
      <div class="row">
        ${gradeBadge(h.hukm)}
        <span class="badge" title="نوع الرواية كما في المصدر">${esc(h.type)}</span>
        ${h.groupId ? `<a class="chip" href="#/group/${h.groupId}?from=${h.hadithId}">كل روايات هذا المعنى</a>` : ""}
      </div>
      <div class="row">
        <button class="chip" id="tashkeel-btn" title="إظهار/إخفاء التشكيل">التشكيل</button>
        <button class="chip" id="copy-hadith" title="نسخ النص مع العزو">نسخ</button>
        <button class="chip" id="takhrij-btn" title="دفترُ تخريجٍ كاملٌ للطباعة أو الحفظ PDF">دفتر التخريج</button>
        <span class="muted">صفحة ${fmt(h.page)}</span>
      </div>
    </div>
    <div class="nass" id="hadith-nass">${renderNass(h)}</div>
    ${extras.routes ?? ""}
    ${extras.takhrij ?? ""}
    <div class="muted no-print" style="margin-top:14px">أسماء الرواة في النص روابط — اضغط أي اسم لفتح ترجمته</div>
  </div>

  ${h.groupId ? `<div class="card no-print" id="audit-host" data-hid="${h.hadithId}" style="margin-top:14px">
    <div class="spread" style="align-items:center">
      <h3 style="margin:0">الخلاصة النقدية</h3>
      <span class="nibras-tag">نبراس · قراءةٌ من الموسوعة لا فتوى</span>
    </div>
    <div id="audit-body" style="margin-top:10px"><div class="skeleton" style="height:90px"></div></div>
  </div>` : ""}

  ${h.groupId ? `<div id="uplift-host" class="no-print" data-hid="${h.hadithId}"></div>` : ""}

  ${(h.sanads ?? []).length ? `<div class="card" id="isnad-host" data-hid="${h.hadithId}" style="position:relative">
    <div class="no-print">
      <h3 style="margin:0">أسانيد الحديث — ملوّنةً بدرجات الرواة</h3>
      <div class="muted" style="margin:2px 0 4px">
        لون كل راوٍ يبيّن درجته في الرواية، ولون الوصلة بين راويَين يأخذ <b>أضعف</b> الطرفين
        (فالإسناد لا يقوى إلا بأضعف رجاله). اضغط أي راوٍ لبطاقته، و«لماذا هذا الحكم؟» لبيان مواطن النظر.
      </div>
    </div>
    ${isnadLegend()}
    ${h.sanads.map((s, i) => `
      <div style="margin-top:14px">
        <div class="spread">
          <strong>الإسناد${h.sanads.length > 1 ? ` ${fmt(i + 1)}` : ""}</strong>
          <div class="row">
            ${gradeBadge(s.grade)}<span class="badge">${fmt(s.length)} راوياً</span>
            <button class="chip why-btn" data-sanad="${i}">لماذا هذا الحكم؟</button>
          </div>
        </div>
        ${s.hukm ? `<p class="muted" style="margin:6px 0 10px">${esc(s.hukm)}</p>` : ""}
        <div class="why-slot" data-sanad="${i}"></div>
        ${renderChain(s, { idx: i, book: book?.name, bookId: h.bookId, noInBook: h.noInBook })}
      </div>`).join("")}
  </div>` : ""}

  ${h.groupId ? `<div class="card no-print" id="itibar-host" data-hid="${h.hadithId}">
    <div class="spread" style="align-items:flex-start">
      <div>
        <h3 style="margin:0">الاعتبار — المتابعات والشواهد</h3>
        <p class="muted" style="margin:6px 0 0">جمعُ طرق الحديث لمعرفة هل تُوبِع راويه أو شُهد لحديثه — وهو أصل التقوية بكثرة الطرق.</p>
      </div>
      <a class="btn" href="#/board/${h.groupId}" style="flex:none">لوحة الاعتبار الكاملة ←</a>
    </div>
    <div id="itibar-body" style="margin-top:12px"></div>
  </div>` : ""}

  ${(h.sanads ?? []).length ? `<div class="card no-print" id="contact-host" data-hid="${h.hadithId}">
    <h3 style="margin:0">فحص الاتصال الزمني</h3>
    <p class="muted" style="margin:6px 0 0">مقارنة طبقات الرواة المتجاورين ووفياتهم لكشف الانقطاع الخفيّ (قرينة لا حُكم).</p>
    <div id="contact-body" style="margin-top:12px"></div>
  </div>` : ""}

  ${book ? `<div class="card muted">
    <strong>${esc(book.name)}</strong> — ${esc(book.authorName)} (ت ${fmt(book.authorDeathYear)}هـ)
    · ${esc(book.tasnif)} · ${fmt(book.hadithQty)} حديثاً
    <span class="tag-count" style="margin-inline-start:10px">المعرف في الجامع: ${fmt(h.hadithId)}</span>
  </div>` : ""}`;

  render(page({}));

  // secondary data: prev/next + takhrij line (other books carrying this meaning)
  const [nav, group] = await Promise.all([
    api.hadithNav(h.hadithId).catch(() => null),
    h.groupId ? api.group(h.groupId, 40).catch(() => null) : null,  // 40 = enough for شريط الطرق
  ]);
  const navHtml = nav
    ? `<span style="margin-inline-start:auto" class="row">
        ${nav.prev ? `<a class="chip" href="#/hadith/${nav.prev.id}">→ السابق (${fmt(nav.prev.no_inbook)})</a>` : ""}
        ${nav.next ? `<a class="chip" href="#/hadith/${nav.next.id}">التالي (${fmt(nav.next.no_inbook)}) ←</a>` : ""}
      </span>`
    : "";
  // شريط الطرق — every other route of this meaning, right here: press one to see
  // its wording diffed against the one on screen (تتبُّعُ الألفاظ بلا مغادرة الصفحة)
  let routesHtml = "";
  const sibs = (group?.narrations ?? []).filter((n) => n.hadithId !== h.hadithId && n.taraf);
  if (sibs.length) {
    routesHtml = `
      <div class="no-print" style="margin-top:14px;border-top:1px solid var(--hairline);padding-top:10px">
        <div class="muted" style="font-size:12.5px;margin-bottom:5px">
          <strong style="color:var(--ink-2)">طرقُ هذا المعنى (${fmt(sibs.length + 1)})</strong>
          — اضغطْ طريقًا لتُقابلَ لفظَه بلفظِ ما بين يديك، أو افتحْه في صفحته
        </div>
        <div class="routes-bar" id="h-routes">
          <button class="route-chip on" data-i="-1">اللفظُ المعروض</button>
          ${sibs.slice(0, 40).map((n, i) => `
            <button class="route-chip" data-i="${i}" title="${esc(n.hukm ?? "")}">
              ${esc(n.bookName ?? "—")}${n.noInBook ? ` · ${fmt(n.noInBook)}` : ""}
            </button>`).join("")}
        </div>
        <div id="h-routes-out"></div>
      </div>`;
    // the bar is bound in the page:rendered handler below (the final HTML is
    // injected by the router after this function returns)
    routeSibs = { base: stripTashkeel(h.taraf ?? h.matnClean ?? ""), sibs };
  }
  let takhrijHtml = "";
  if (group?.books?.length > 1) {
    const others = group.books.filter((b) => b.bookId !== h.bookId).slice(0, 8);
    if (others.length)
      takhrijHtml = `<div class="muted" style="margin-top:14px;border-top:1px solid var(--hairline);padding-top:10px">
        <strong style="color:var(--ink-2)">أخرجه أيضاً:</strong>
        ${others.map((b) => `<a href="#/group/${h.groupId}">${esc(b.name)} (${fmt(b.count)})</a>`).join("، ")}${group.books.length - 1 > others.length ? "…" : ""}
      </div>`;
  }
  return page({ nav: navHtml, takhrij: takhrijHtml, routes: routesHtml });
}

function renderAudit(d) {
  if (!d) return `<div class="muted">تعذّرت الخلاصة</div>`;
  return `
    <div class="audit-headline">${esc(d.headline ?? "")}</div>
    <div class="audit-signals">
      ${(d.signals ?? []).map((s) => `
        <div class="audit-sig tone-${s.tone}">
          <span class="audit-dot"></span>
          <div><b>${esc(s.label)}</b><div class="muted" style="font-size:13px">${esc(s.detail)}</div></div>
        </div>`).join("")}
    </div>
    <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
      ${d.groupId ? `<a class="chip" href="#/board/${d.groupId}">لوحة الاعتبار</a>
        <a class="chip" href="#/icma/${d.groupId}">تحليل الإسناد والمتن</a>` : ""}
    </div>`;
}

/** الارتقاءُ بالاعتبار — did a «يحسن إذا توبع» isnad actually find its متابعة? */
function renderUplift(d) {
  if (!d?.conditional) return "";
  const tone = d.level === "sound" ? "ok" : d.level === "corroborated" ? "gold" : "warn";
  const suppList = (arr, label) => arr.length ? `
    <div style="margin-top:9px">
      <div class="muted" style="font-size:12px;margin-bottom:4px">${label}</div>
      <div class="itibar-list">${arr.map((s) => `
        <a class="edge-item" href="#/hadith/${s.hadithId}">
          <div class="edge-item-head">
            <span class="muted">${esc(s.book ?? "")}${s.noInBook ? ` · ${fmt(s.noInBook)}` : ""}</span>
            ${s.inScope === false ? `<span class="badge scope-out" title="من كتابٍ خارج نطاقك — يُعرض لأن الاعتبار يزن المصنَّف كله">خارج النطاق</span>` : ""}
            ${gradeBadge(s.hukm)}
          </div>
          ${s.taraf ? `<div class="edge-item-matn">${esc(s.taraf)}</div>` : ""}
        </a>`).join("")}</div>
    </div>` : "";
  const recorded = (d.recorded || "").replace(/^إسناده?\s*/, "");
  return `
    <div class="card uplift uplift-${tone}" style="margin-top:14px">
      <div class="uplift-head">
        <span class="uplift-icon">${d.met ? "✓" : "—"}</span>
        <div>
          <h3 style="margin:0">الارتقاءُ بالاعتبار</h3>
          <div class="muted" style="font-size:12.5px;margin-top:2px">قيلَ في إسناده: «${esc(recorded)}» — فهل تحقّق الشرطُ فِعلاً؟</div>
        </div>
      </div>
      <div class="uplift-verdict">${esc(d.verdict)}</div>
      ${suppList(d.sound, "طرقٌ صحيحةٌ أو حسنةٌ مستقلّةٌ ترفعُه")}
      ${suppList(d.corroborating, d.level === "corroborated" ? "طرقٌ عاضِدةٌ (ضعفٌ يسيرٌ يجبُرُ بعضُه بعضًا)" : "طرقٌ عاضِدةٌ أخرى")}
      <div class="muted" style="font-size:11.5px;margin-top:9px">
        قرينةٌ محسوبةٌ من الشبكة توجِّهُ النظر؛ الحكمُ النهائيُّ بجبرِ الضعفِ لأهلِ الشأن.
      </div>
    </div>`;
}

/** دفترُ التخريج — a self-contained, print/PDF-ready dossier of one narration:
 *  text · recorded grade · the computed critical summary · uplift evidence ·
 *  takhrij across books · citation. منقولٌ (أحكام العلماء) موسومٌ عن المحسوب. */
async function openTakhrijDossier(hid, btn) {
  const label = btn.textContent;
  btn.textContent = "…يُجهَّز"; btn.disabled = true;
  try {
    const h = await api.hadith(hid);
    const [audit, uplift, group] = await Promise.all([
      api.nibrasAudit(hid).catch(() => null),
      api.hadithUplift(hid).catch(() => null),
      h.groupId ? api.group(h.groupId, 40).catch(() => null) : Promise.resolve(null),
    ]);
    const books = await api.books().then((b) => b.books).catch(() => []);
    const bookName = (id) => books.find((b) => b.bookId === id)?.name ?? "";
    const num = (n) => (n == null ? "" : new Intl.NumberFormat("ar-EG").format(n));
    const toneWord = { good: "✔", warn: "•", bad: "✕", neutral: "◦" };
    const nass = (h.nass || "").trim();

    const signalsHtml = (audit?.signals ?? []).map((s) =>
      `<li><b>${esc(s.label)}:</b> ${esc(s.detail)} <span class="tg">[محسوب]</span></li>`).join("");
    const upSound = (uplift?.sound ?? []).map((s) =>
      `<li>${esc(s.book ?? "")}${s.noInBook ? ` (${num(s.noInBook)})` : ""} — ${esc(s.hukm || "")}</li>`).join("");
    const takhrij = (group?.books ?? []).slice(0, 30).map((b) =>
      `${esc(b.name)} (${num(b.count)})`).join(" · ");
    const grade = h.hukm || "";
    const today = new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

    const doc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <title>دفتر تخريج — ${esc(bookName(h.bookId))} ${num(h.noInBook)}</title>
      <style>
        @page { margin: 2cm; }
        body { font-family: "Amiri", "Times New Roman", serif; color: #1a1a1a; line-height: 1.9; max-width: 780px; margin: 0 auto; padding: 24px; }
        h1 { font-size: 22px; border-bottom: 2px solid #0b6e56; padding-bottom: 6px; color: #0b6e56; }
        h2 { font-size: 16px; color: #0b6e56; margin: 22px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
        .ref { color: #555; font-size: 14px; margin: 4px 0 14px; }
        blockquote { background: #f7f4ee; border-inline-start: 4px solid #c8a24a; margin: 0; padding: 12px 16px; font-size: 17px; border-radius: 6px; }
        ul { margin: 6px 0; padding-inline-start: 20px; } li { margin: 3px 0; font-size: 14.5px; }
        .grade { display: inline-block; padding: 2px 12px; border-radius: 999px; background: #eef4f1; color: #0b6e56; font-weight: 700; }
        .tg { color: #888; font-size: 11px; }
        .verdict { font-weight: 700; font-size: 15px; }
        footer { margin-top: 26px; border-top: 1px solid #ddd; padding-top: 10px; color: #666; font-size: 12px; }
        .noprint { text-align: center; margin-bottom: 16px; }
        button { font: inherit; padding: 8px 18px; border-radius: 8px; border: 1px solid #0b6e56; background: #0b6e56; color: #fff; cursor: pointer; }
        @media print { .noprint { display: none; } }
      </style></head><body>
      <div class="noprint"><button onclick="window.print()">اطبعْ أو احفظْ PDF</button></div>
      <h1>دفترُ التخريج</h1>
      <div class="ref">${esc(bookName(h.bookId))}${h.noInBook ? ` — رقم ${num(h.noInBook)}` : ""}${h.page ? ` · صفحة ${num(h.page)}` : ""} · <span class="grade">${esc(grade)}</span></div>
      <blockquote>${esc(nass)}</blockquote>
      ${audit ? `<h2>الخلاصةُ النقديّة <span class="tg">(قرائنُ محسوبةٌ لا فتوى)</span></h2>
        <div class="verdict">${esc(audit.headline || "")}</div><ul>${signalsHtml}</ul>` : ""}
      ${uplift?.conditional ? `<h2>الارتقاءُ بالاعتبار</h2>
        <div class="verdict">${esc(uplift.verdict)}</div>
        ${upSound ? `<div>الطرقُ المُرقِّية:</div><ul>${upSound}</ul>` : ""}` : ""}
      ${takhrij ? `<h2>التخريج — أخرجه أيضًا</h2><div style="font-size:14px">${takhrij}</div>` : ""}
      <footer>مُصدَّرٌ من «الجامع — الشبكة المعرفية للحديث الشريف» بتاريخ ${today}.<br>
        الأحكامُ والدرجاتُ منقولةٌ كما دُوِّنت؛ وما وُسِمَ «محسوب» قرائنُ من الشبكةِ توجِّهُ النظرَ لا فتوى.</footer>
      </body></html>`;

    const w = window.open("", "_blank");
    if (!w) { alert("مُنِعت النافذةُ المنبثقة — اسمحْ بها ثم أعِدِ المحاولة."); return; }
    w.document.write(doc); w.document.close();
  } catch (e) {
    alert("تعذّر تجهيزُ الدفتر: " + (e?.message ?? e));
  } finally {
    btn.textContent = label; btn.disabled = false;
  }
}

document.addEventListener("page:rendered", () => {
  // دفترُ التخريج — assemble a printable dossier on demand
  const tb = document.getElementById("takhrij-btn");
  if (tb && !tb.dataset.bound) {
    tb.dataset.bound = "1";
    const hid = Number(document.getElementById("uplift-host")?.dataset.hid
      || document.getElementById("audit-host")?.dataset.hid
      || (location.hash.match(/hadith\/(\d+)/) || [])[1]);
    if (hid) tb.onclick = () => openTakhrijDossier(hid, tb);
  }

  // الارتقاءُ بالاعتبار — lazy, and only renders if the isnad was conditionally graded
  const upHost = document.getElementById("uplift-host");
  if (upHost && !upHost.dataset.bound) {
    upHost.dataset.bound = "1";
    api.hadithUplift(Number(upHost.dataset.hid))
      .then((d) => { if (upHost.isConnected) upHost.innerHTML = renderUplift(d); })
      .catch(() => {});
  }

  // شريط الطرق — press a route to diff its wording against the one on screen
  const rBar = document.getElementById("h-routes");
  if (rBar && routeSibs && !rBar.dataset.bound) {
    rBar.dataset.bound = "1";
    const { base, sibs } = routeSibs;
    const outEl = document.getElementById("h-routes-out");
    rBar.addEventListener("click", (e) => {
      const b = e.target.closest(".route-chip");
      if (!b || !outEl) return;
      rBar.querySelectorAll(".route-chip").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      const i = Number(b.dataset.i);
      if (i < 0) { outEl.innerHTML = ""; return; }
      const n = sibs[i];
      const ops = diff(words(base), words(stripTashkeel(n.taraf ?? "")));
      outEl.innerHTML = `
        <div class="card" style="margin-top:9px;background:var(--surface-2)">
          <div class="spread" style="margin-bottom:7px">
            <div class="row" style="gap:7px">
              <b>${esc(n.bookName ?? "")}${n.noInBook ? ` · ${fmt(n.noInBook)}` : ""}</b>
              ${gradeBadge(n.hukm)}
            </div>
            <a class="chip" href="#/hadith/${n.hadithId}">افتحْ هذه الرواية ←</a>
          </div>
          <div class="nass nass-sm">${renderOps(ops)}</div>
          <div class="muted" style="font-size:12px;margin-top:6px">
            الملوَّنُ زيادةٌ أو خلافٌ عن اللفظ المعروض — والحكمُ أعلاه منقولٌ كما دُوِّن
          </div>
        </div>`;
    });
  }

  const aHost = document.getElementById("audit-host");
  if (aHost && !aHost.dataset.bound) {
    aHost.dataset.bound = "1";
    const hid = Number(aHost.dataset.hid);
    const body = document.getElementById("audit-body");
    api.nibrasAudit(hid)
      .then((d) => { body.innerHTML = renderAudit(d); })
      .catch(() => { body.innerHTML = `<div class="muted">تعذّرت الخلاصة</div>`; });
  }

  const itHost = document.getElementById("itibar-host");
  if (itHost && !itHost.dataset.bound) {
    itHost.dataset.bound = "1";
    const hid = Number(itHost.dataset.hid);
    const body = document.getElementById("itibar-body");
    let reqSeq = 0;
    const run = async (rawi) => {
      const my = ++reqSeq;
      body.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
      try {
        const d = await api.hadithItibar(hid, rawi);
        if (my === reqSeq) body.innerHTML = renderItibar(d);
      } catch { if (my === reqSeq) body.innerHTML = `<div class="muted">تعذّر إجراء الاعتبار</div>`; }
    };
    onVisible(itHost, () => run());
    itHost.addEventListener("click", (e) => {
      const chip = e.target.closest(".itibar-rawi");
      if (chip) { e.preventDefault(); run(Number(chip.dataset.rawi)); }
    });
  }

  const cHost = document.getElementById("contact-host");
  if (cHost && !cHost.dataset.bound) {
    cHost.dataset.bound = "1";
    const hid = Number(cHost.dataset.hid);
    const body = document.getElementById("contact-body");
    onVisible(cHost, async () => {
      body.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
      try { body.innerHTML = renderContact(await api.hadithContact(hid)); }
      catch { body.innerHTML = `<div class="muted">تعذّر الفحص</div>`; }
    });
  }

  const host = document.getElementById("isnad-host");
  if (host && !host.dataset.bound) {
    host.dataset.bound = "1";
    const pop = mountRawiPopup(host, (id) => api.rawi(id));
    let whyData = null;
    host.addEventListener("click", async (e) => {
      const btn = e.target.closest(".rawi-node");
      if (btn) { e.stopPropagation(); pop.show(btn, Number(btn.dataset.rawi)); return; }
      const why = e.target.closest(".why-btn");
      if (why) {
        e.stopPropagation();
        const i = Number(why.dataset.sanad);
        const slot = host.querySelector(`.why-slot[data-sanad="${i}"]`);
        if (slot.innerHTML) { slot.innerHTML = ""; why.classList.remove("active"); return; }
        why.classList.add("active");
        slot.innerHTML = `<div class="skeleton" style="height:60px"></div>`;
        try {
          whyData ??= (await api.hadithWhy(Number(host.dataset.hid))).sanads;
          slot.innerHTML = whyData[i] ? renderWhy(whyData[i], i) : `<div class="muted">لا تحليل</div>`;
        } catch { slot.innerHTML = `<div class="muted">تعذّر التحليل</div>`; }
        return;
      }
      if (!e.target.closest("[data-term]")) pop.hide();
    });
  }

  const nassEl = document.getElementById("hadith-nass");
  if (!nassEl) return;

  const tk = document.getElementById("tashkeel-btn");
  if (tk && !tk.dataset.bound) {
    tk.dataset.bound = "1";
    tk.dataset.orig = nassEl.innerHTML;
    tk.onclick = () => {
      const off = tk.classList.toggle("active");
      nassEl.innerHTML = off ? stripTashkeel(tk.dataset.orig) : tk.dataset.orig;
    };
  }
  const cp = document.getElementById("copy-hadith");
  if (cp && !cp.dataset.bound) {
    cp.dataset.bound = "1";
    cp.onclick = () => {
      const crumb = document.querySelector(".crumbs a")?.textContent ?? "";
      const no = document.title.match(/[\d٠-٩,،]+/)?.[0] ?? "";
      const grade = document.querySelector(".card .badge")?.textContent ?? "";
      navigator.clipboard.writeText(
        `${nassEl.innerText.trim()}\n\n— ${crumb} (${no})${grade ? ` · ${grade}` : ""} · عبر تطبيق الجامع`);
      cp.textContent = "نُسخ ✓";
      setTimeout(() => (cp.textContent = "نسخ"), 1500);
    };
  }
});
