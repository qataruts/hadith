import { api } from "../api.js";
import { esc, fmt, gradeBadge, stripTashkeel } from "../util.js";
import { renderNass } from "../components/nass.js";
import { renderChain } from "../components/chain.js";

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

  ${(h.sanads ?? []).map((s, i) => `
    <div class="card">
      <div class="spread">
        <h3 style="margin:0">الإسناد${h.sanads.length > 1 ? ` ${fmt(i + 1)}` : ""}</h3>
        <div class="row">${gradeBadge(s.grade)}<span class="badge">${fmt(s.length)} راوياً</span></div>
      </div>
      ${s.hukm ? `<p class="muted" style="margin:6px 0 12px">${esc(s.hukm)}</p>` : ""}
      ${renderChain(s)}
    </div>`).join("")}

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
