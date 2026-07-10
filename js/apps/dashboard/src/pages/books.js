import { api } from "../api.js";
import { esc, fmt } from "../util.js";
import { hadithCard } from "../components/cards.js";

export async function booksPage() {
  const { books } = await api.books();
  const byTasnif = new Map();
  for (const b of books) {
    const list = byTasnif.get(b.tasnif) ?? [];
    list.push(b);
    byTasnif.set(b.tasnif, list);
  }
  return [...byTasnif.entries()]
    .map(([tasnif, list]) => `
      <div class="sec-title">${esc(tasnif)} <span class="tag-count">${fmt(list.length)} كتاباً</span></div>
      <div class="grid grid-3">
        ${list.sort((a, b) => b.hadithQty - a.hadithQty).map((b) => `
          <a class="card result-card" href="#/book/${b.bookId}">
            <strong>${esc(b.name)}</strong>
            <div class="muted" style="margin-top:6px">${esc(b.authorName)} (ت ${fmt(b.authorDeathYear)}هـ)</div>
            <div class="muted">${fmt(b.hadithQty)} حديثاً</div>
          </a>`).join("")}
      </div>`)
    .join("");
}

export async function bookPage({ args: [id], params }) {
  const offset = Number(params.get("offset") ?? 0);
  const b = await api.book(id, 20, offset);
  if (!b) return `<div class="empty">الكتاب غير موجود</div>`;
  return `
  <div class="crumbs"><a href="#/books">الكتب</a> ‹ ${esc(b.name)}</div>
  <div class="card">
    <h2 style="margin:0">${esc(b.name)}</h2>
    <div class="muted" style="margin-top:4px">${esc(b.authorName)} (ت ${fmt(b.authorDeathYear)}هـ) · ${esc(b.tasnif)}</div>
    <div class="row" style="margin-top:10px">
      <span class="badge">${fmt(b.hadithQty)} حديثاً</span>
      ${b.dar ? `<span class="badge">${esc(b.dar)}${b.city ? " — " + esc(b.city) : ""}</span>` : ""}
    </div>
  </div>
  <div class="sec-title">الأحاديث</div>
  <div class="grid">${b.hadiths.map(hadithCard).join("")}</div>
  <div class="pager">
    ${offset > 0 ? `<a class="btn" href="#/book/${id}?offset=${Math.max(0, offset - 20)}">السابق</a>` : ""}
    <span class="muted" style="align-self:center">${fmt(offset + 1)}–${fmt(offset + b.hadiths.length)} من ${fmt(b.hadithQty)}</span>
    ${offset + 20 < b.hadithQty ? `<a class="btn" href="#/book/${id}?offset=${offset + 20}">التالي</a>` : ""}
  </div>`;
}
