/** Rawi dossier — bio, jarh wa ta'dil, teachers/students, narrations. */
import { api } from "../api.js";
import { esc, fmt, rankBadge, hijri } from "../util.js";
import { bars } from "../components/charts.js";
import { hadithCard } from "../components/cards.js";

export async function rawiPage({ args: [id], params, render }) {
  const r = await api.rawi(id);
  if (!r) return `<div class="empty">الراوي غير موجود</div>`;

  const bio = [
    r.tabaka ? ["الطبقة", fmt(r.tabaka)] : null,
    r.birthYear || r.birthYearRaw ? ["الولادة", hijri(r.birthYear, r.birthYearRaw)] : null,
    r.deathYear || r.deathYearRaw ? ["الوفاة", hijri(r.deathYear, r.deathYearRaw)] : null,
    r.deathPlace ? ["مكان الوفاة", esc(r.deathPlace)] : null,
    r.profession ? ["المهنة", esc(r.profession)] : null,
    r.nasab ? ["النسب", esc(r.nasab)] : null,
    r.iqama ? ["الإقامة", esc(r.iqama)] : null,
  ].filter(Boolean);

  const flags = [
    r.isBukhari && "روى له البخاري",
    r.isMuslim && "روى له مسلم",
    r.hasTadlis && "موصوف بالتدليس",
    r.hasIkhtilat && "وقع له اختلاط",
    r.isStub && "ترجمة ناقصة في المصدر",
  ].filter(Boolean);

  const page = (hadithsHtml) => `
  <div class="crumbs"><a href="#/search?mode=rawi">الرواة</a> ‹ ${esc(r.nickname)}</div>

  <div class="card">
    <div class="spread">
      <div>
        <h2 style="margin:0">${esc(r.nickname)}</h2>
        <div class="muted">${esc(r.name)}</div>
      </div>
      <div class="row">${rankBadge(r.rank)}</div>
    </div>
    <div class="row" style="margin-top:12px">
      <span class="badge">${fmt(r.chainCount)} إسناد</span>
      <span class="badge">${fmt(r.hadithCount)} حديث</span>
      ${flags.map((f) => `<span class="badge">${f}</span>`).join("")}
    </div>
    ${bio.length ? `<hr class="hair"/><div class="row" style="gap:18px">${
      bio.map(([k, v]) => `<span><span class="muted">${k}:</span> ${v}</span>`).join("")}</div>` : ""}
  </div>

  <div class="grid grid-2" style="margin-top:14px">
    <div class="card">
      <h3>شيوخه <span class="tag-count">يروي عنهم</span></h3>
      ${bars((r.teachers ?? []).map((t) => ({
        label: t.name, value: t.n, href: `#/rawi/${t.id}`, title: t.rank ?? "" })), { maxBars: 12 })}
    </div>
    <div class="card">
      <h3>تلاميذه <span class="tag-count">يروون عنه</span></h3>
      ${bars((r.students ?? []).map((t) => ({
        label: t.name, value: t.n, href: `#/rawi/${t.id}`, title: t.rank ?? "" })), { maxBars: 12 })}
    </div>
  </div>

  ${(r.aqwal ?? []).length ? `
  <div class="card" style="margin-top:14px">
    <h3>أقوال النقّاد فيه <span class="tag-count">${fmt(r.aqwal.length)}</span></h3>
    <div class="grid grid-2" style="margin-top:10px">
      ${r.aqwal.map((a) => `
        <div style="border-right:2px solid var(--hairline);padding-right:12px">
          <div>«${esc(a.qawl)}»</div>
          <a class="muted" href="#/alem/${a.alemId}">— ${esc(a.alem)}</a>
        </div>`).join("")}
    </div>
  </div>` : ""}

  <div class="sec-title">من مروياته</div>
  <div id="rawi-hadiths">${hadithsHtml}</div>`;

  render(page(`<div class="skeleton" style="height:200px"></div>`));
  const offset = Number(params.get("offset") ?? 0);
  const { hadiths } = await api.rawiHadiths(id, 10, offset);
  return page(
    `<div class="grid">${hadiths.map(hadithCard).join("") || `<div class="empty">لا مرويات مباشرة</div>`}</div>
     <div class="pager">
       ${offset > 0 ? `<a class="btn" href="#/rawi/${id}?offset=${Math.max(0, offset - 10)}">السابق</a>` : ""}
       ${hadiths.length === 10 ? `<a class="btn" href="#/rawi/${id}?offset=${offset + 10}">المزيد</a>` : ""}
     </div>`);
}
