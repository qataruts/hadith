/** Shared narrator dossier card (used by the isnad chain X-ray and the tree). */
import { esc, fmt, rankBadge, hijri, rankVar } from "../util.js";
import { termLink } from "./glossary.js";

/** Build the card body HTML from a full /api/rawi record. `treeCount` optional. */
export function rawiCardHtml(r, { treeCount } = {}) {
  const flags = [
    r.isBukhari && "روى له البخاري", r.isMuslim && "روى له مسلم",
    r.hasTadlis && termLink("tadlis", "مدلِّس"), r.hasIkhtilat && termLink("ikhtilat", "اختلط"),
    r.isStub && "ترجمة ناقصة",
  ].filter(Boolean);
  const meta = [
    r.tabaka ? `الطبقة ${fmt(r.tabaka)}` : null,
    (r.deathYear || r.deathYearRaw) ? `ت ${hijri(r.deathYear, r.deathYearRaw)}` : null,
    r.deathPlace ? esc(r.deathPlace) : null,
    r.profession ? esc(r.profession) : null,
  ].filter(Boolean).join(" · ");
  return `
    <div class="spread" style="gap:8px">
      <strong style="font-size:14.5px;border-inline-start:4px solid ${rankVar(r.rank)};padding-inline-start:8px">${esc(r.nickname)}</strong>
      ${rankBadge(r.rank)}
    </div>
    <div class="muted" style="font-size:12px;margin-top:3px">${esc(r.name)}</div>
    ${meta ? `<div style="font-size:12.5px;margin-top:6px">${meta}</div>` : ""}
    <div class="row" style="margin-top:8px;gap:6px">
      <span class="badge">${fmt(r.chainCount)} إسناد</span>
      <span class="badge">${fmt(r.hadithCount)} حديث</span>
      ${treeCount != null ? `<span class="badge">في هذه الشجرة: ${fmt(treeCount)} طريق</span>` : ""}
    </div>
    ${flags.length ? `<div class="row" style="margin-top:6px;gap:6px">${flags.map((f) => `<span class="badge">${f}</span>`).join("")}</div>` : ""}
    ${(r.aqwal ?? []).length ? `
      <div style="margin-top:10px;border-top:1px solid var(--hairline);padding-top:8px">
        ${r.aqwal.slice(0, 3).map((q) => `<div style="font-size:12.5px;margin-bottom:4px">«${esc(q.qawl)}» <span class="muted">— ${esc(q.alem)}</span></div>`).join("")}
        ${r.aqwal.length > 3 ? `<div class="muted" style="font-size:11.5px">و${fmt(r.aqwal.length - 3)} أقوال أخرى…</div>` : ""}
      </div>` : ""}
    ${(r.teachers ?? []).length || (r.students ?? []).length ? `
      <div class="muted" style="font-size:12px;margin-top:8px">
        ${r.teachers?.length ? `شيوخه: ${r.teachers.slice(0, 3).map((t) => esc(t.name)).join("، ")}${r.teachers.length > 3 ? "…" : ""}` : ""}
        ${r.students?.length ? `<br/>تلاميذه: ${r.students.slice(0, 3).map((t) => esc(t.name)).join("، ")}${r.students.length > 3 ? "…" : ""}` : ""}
      </div>` : ""}
    <div class="row" style="margin-top:10px;gap:8px">
      <a class="chip" href="#/rawi/${r.rawiId}">الترجمة الكاملة ←</a>
    </div>`;
}

/**
 * Mount a floating popup inside `host` (position:relative). Returns
 * { show(anchorEl, id), hide() }. `fetchRawi(id)` returns a full record.
 */
export function mountRawiPopup(host, fetchRawi) {
  const pop = document.createElement("div");
  pop.className = "rawi-pop";
  pop.hidden = true;
  host.appendChild(pop);
  const cache = new Map();
  let seq = 0;

  const place = (anchor) => {
    const hr = host.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    let x = ar.left - hr.left + ar.width / 2 - pop.offsetWidth / 2;
    let y = ar.bottom - hr.top + 8;
    x = Math.max(6, Math.min(x, hr.width - pop.offsetWidth - 6));
    if (y + pop.offsetHeight > hr.height - 6 && ar.top - hr.top > pop.offsetHeight)
      y = ar.top - hr.top - pop.offsetHeight - 8;
    pop.style.left = `${x}px`;
    pop.style.top = `${Math.max(6, y)}px`;
  };
  const hide = () => { pop.hidden = true; seq++; };

  async function show(anchor, id) {
    const my = ++seq;
    const fresh = () => my === seq && !pop.hidden && pop.isConnected;
    pop.hidden = false;
    pop.innerHTML = `<div class="skeleton" style="height:110px;width:280px"></div>`;
    place(anchor);
    let r = cache.get(id);
    if (!r) {
      try { r = await fetchRawi(id); cache.set(id, r); }
      catch { if (fresh()) pop.innerHTML = `<div class="muted">تعذر التحميل</div>`; return; }
    }
    if (!fresh()) return;
    if (!r) { pop.innerHTML = `<div class="muted">لا ترجمة</div>`; return; }
    pop.innerHTML = rawiCardHtml(r);
    place(anchor);
  }

  // scope the Escape listener to this mount; drop it on the next navigation so
  // repeated page visits don't accumulate listeners
  const ctrl = new AbortController();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); }, { signal: ctrl.signal });
  addEventListener("hashchange", () => ctrl.abort(), { once: true });
  return { show, hide, el: pop, destroy: () => ctrl.abort() };
}
