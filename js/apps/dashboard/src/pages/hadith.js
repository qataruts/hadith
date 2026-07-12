import { api } from "../api.js";
import { esc, fmt, gradeBadge, stripTashkeel, isnadLegend, onVisible } from "../util.js";
import { renderNass } from "../components/nass.js";
import { renderChain } from "../components/chain.js";
import { mountRawiPopup } from "../components/rawipop.js";
import { renderWhy } from "../components/why.js";
import { renderItibar } from "../components/itibar.js";
import { renderContact } from "../components/contact.js";

export async function hadithPage({ args: [id], render }) {
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
        ${h.groupId ? `<a class="chip" href="#/group/${h.groupId}?from=${h.hadithId}">🕸 كل روايات هذا المعنى</a>` : ""}
      </div>
      <div class="row">
        <button class="chip" id="tashkeel-btn" title="إظهار/إخفاء التشكيل">التشكيل</button>
        <button class="chip" id="copy-hadith" title="نسخ النص مع العزو">نسخ</button>
        <span class="muted">صفحة ${fmt(h.page)}</span>
      </div>
    </div>
    <div class="nass" id="hadith-nass">${renderNass(h)}</div>
    ${extras.takhrij ?? ""}
    <div class="muted no-print" style="margin-top:14px">أسماء الرواة في النص روابط — اضغط أي اسم لفتح ترجمته</div>
  </div>

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
        ${renderChain(s, { idx: i })}
      </div>`).join("")}
  </div>` : ""}

  ${h.groupId ? `<div class="card no-print" id="itibar-host" data-hid="${h.hadithId}">
    <h3 style="margin:0">الاعتبار — المتابعات والشواهد</h3>
    <p class="muted" style="margin:6px 0 0">جمعُ طرق الحديث لمعرفة هل تُوبِع راويه أو شُهد لحديثه — وهو أصل التقوية بكثرة الطرق.</p>
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
    h.groupId ? api.group(h.groupId, 0).catch(() => null) : null,
  ]);
  const navHtml = nav
    ? `<span style="margin-inline-start:auto" class="row">
        ${nav.prev ? `<a class="chip" href="#/hadith/${nav.prev.id}">→ السابق (${fmt(nav.prev.no_inbook)})</a>` : ""}
        ${nav.next ? `<a class="chip" href="#/hadith/${nav.next.id}">التالي (${fmt(nav.next.no_inbook)}) ←</a>` : ""}
      </span>`
    : "";
  let takhrijHtml = "";
  if (group?.books?.length > 1) {
    const others = group.books.filter((b) => b.bookId !== h.bookId).slice(0, 8);
    if (others.length)
      takhrijHtml = `<div class="muted" style="margin-top:14px;border-top:1px solid var(--hairline);padding-top:10px">
        <strong style="color:var(--ink-2)">أخرجه أيضاً:</strong>
        ${others.map((b) => `<a href="#/group/${h.groupId}">${esc(b.name)} (${fmt(b.count)})</a>`).join("، ")}${group.books.length - 1 > others.length ? "…" : ""}
      </div>`;
  }
  return page({ nav: navHtml, takhrij: takhrijHtml });
}

document.addEventListener("page:rendered", () => {
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
