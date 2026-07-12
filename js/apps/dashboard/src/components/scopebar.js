/** Corpus-scope UI: a topbar control + a book-picker modal. The whole app
 * (search, meaning graphs, narrations) then works within the chosen books. */
import { api } from "../api.js";
import { esc, fmt } from "../util.js";
import { getScopeIds, setScope, hasScopeSet } from "./scope.js";

let allBooks = null;
async function books() {
  allBooks ??= (await api.books()).books.slice().sort((a, b) => b.hadithQty - a.hadithQty);
  return allBooks;
}

const PRESET_IDS = {
  sahihayn: [1, 2],
  six: [1, 2, 3, 4, 5, 6],
  nine: [1, 2, 3, 4, 5, 6, 7, 8, 9],
};

/** On first ever load, default the scope to the top-30 books by hadith count. */
export async function ensureDefaultScope() {
  if (hasScopeSet()) return;
  const bs = await books();
  setScope(bs.slice(0, 30).map((b) => b.bookId));
}

export function scopeLabel() {
  const ids = getScopeIds();
  return ids ? `${fmt(ids.length)} كتاباً` : "كل الكتب";
}

export async function openScopeModal() {
  const bs = await books();
  const cur = getScopeIds();
  let sel = new Set(cur ?? bs.map((b) => b.bookId));   // "all" → start fully checked
  let filter = "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal scope-modal" role="dialog" aria-label="نطاق الكتب">
      <div class="spread" style="margin-bottom:4px">
        <h3 style="margin:0">نطاق الكتب</h3>
        <button class="icon-btn" data-x>✕</button>
      </div>
      <p class="muted" style="margin:0 0 12px">كل ما يعرضه التطبيق (بحث، شبكات الرواة، الروايات) يعمل ضمن الكتب المختارة فقط.</p>
      <div class="row" id="scope-presets" style="gap:6px;margin-bottom:10px">
        <button class="chip" data-preset="all">كل الكتب (${fmt(bs.length)})</button>
        <button class="chip" data-preset="top30">أهمّ ٣٠</button>
        <button class="chip" data-preset="nine">الكتب التسعة</button>
        <button class="chip" data-preset="six">الستة</button>
        <button class="chip" data-preset="sahihayn">الصحيحان</button>
      </div>
      <div class="row" style="gap:8px;margin-bottom:8px">
        <input id="scope-search" placeholder="تصفية الكتب بالاسم…" autocomplete="off"
          style="flex:1;padding:8px 12px;border:1px solid var(--hairline);border-radius:9px;background:var(--surface);color:var(--ink);font-family:inherit" />
        <span class="muted" id="scope-count"></span>
      </div>
      <div class="scope-list" id="scope-list"></div>
      <div class="row" style="justify-content:flex-start;gap:8px;margin-top:14px">
        <button class="btn primary" data-save>حفظ وتطبيق</button>
        <button class="btn" data-x>إلغاء</button>
        <button class="btn" data-none style="margin-inline-start:auto">إلغاء تحديد الكل</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector("#scope-list");
  const countEl = overlay.querySelector("#scope-count");
  const paint = () => {
    countEl.textContent = `${fmt(sel.size)} من ${fmt(bs.length)} محدَّد`;
    const shown = filter ? bs.filter((b) => b.name.includes(filter)) : bs;
    listEl.innerHTML = shown.map((b) => `
      <label class="book-row ${sel.has(b.bookId) ? "on" : ""}">
        <input type="checkbox" data-id="${b.bookId}" ${sel.has(b.bookId) ? "checked" : ""} />
        <span class="bk-name">${esc(b.name)}</span>
        <span class="bk-count">${fmt(b.hadithQty)}</span>
      </label>`).join("") || `<div class="muted" style="padding:10px">لا كتب مطابقة</div>`;
  };
  paint();

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-x]")) return close();
    const preset = e.target.closest("[data-preset]")?.dataset.preset;
    if (preset) {
      sel = preset === "all" ? new Set(bs.map((b) => b.bookId))
        : preset === "top30" ? new Set(bs.slice(0, 30).map((b) => b.bookId))
        : new Set(PRESET_IDS[preset]);
      paint();
      return;
    }
    if (e.target.closest("[data-none]")) { sel = new Set(); paint(); return; }
    if (e.target.closest("[data-save]")) {
      // full selection ⇒ "all" (no restriction), so counts stay corpus-wide.
      // setScope fires "scope:change" → main.js re-renders the current view.
      setScope(sel.size >= bs.length ? null : [...sel]);
      close();
      return;
    }
  });
  listEl.addEventListener("change", (e) => {
    const id = Number(e.target.dataset.id);
    if (!id) return;
    if (e.target.checked) sel.add(id); else sel.delete(id);
    e.target.closest(".book-row")?.classList.toggle("on", e.target.checked);
    countEl.textContent = `${fmt(sel.size)} من ${fmt(bs.length)} محدَّد`;
  });
  overlay.querySelector("#scope-search").addEventListener("input", (e) => {
    filter = e.target.value.trim(); paint();
  });
  document.addEventListener("keydown", function esc2(ev) {
    if (ev.key === "Escape") { close(); document.removeEventListener("keydown", esc2); }
  });
}
