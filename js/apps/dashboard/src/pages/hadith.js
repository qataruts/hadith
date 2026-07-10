import { api } from "../api.js";
import { esc, fmt, gradeBadge } from "../util.js";
import { renderNass } from "../components/nass.js";
import { renderChain } from "../components/chain.js";

export async function hadithPage({ args: [id] }) {
  const h = await api.hadith(id);
  if (!h) return `<div class="empty">الحديث غير موجود</div>`;
  const books = await api.books();
  const book = books.books.find((b) => b.bookId === h.bookId);

  return `
  <div class="crumbs">
    <a href="#/book/${h.bookId}">${esc(book?.name ?? "")}</a> ‹ حديث رقم ${fmt(h.noInBook)}
  </div>

  <div class="card">
    <div class="spread" style="margin-bottom:14px">
      <div class="row">
        ${gradeBadge(h.hukm)}
        <span class="badge">${esc(h.type)}</span>
        ${h.groupId ? `<a class="chip" href="#/group/${h.groupId}">🕸 كل روايات هذا المعنى</a>` : ""}
      </div>
      <span class="muted">صفحة ${fmt(h.page)}</span>
    </div>
    <div class="nass">${renderNass(h)}</div>
    <div class="muted" style="margin-top:14px">أسماء الرواة في النص روابط — اضغط أي اسم لفتح ترجمته</div>
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
  </div>` : ""}`;
}
