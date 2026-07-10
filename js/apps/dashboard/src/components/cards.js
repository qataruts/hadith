/** Shared result cards. */
import { esc, fmt, gradeBadge, rankBadge, hijri } from "../util.js";

export const hadithCard = (h) => `
  <a class="card result-card" href="#/hadith/${h.hadithId}">
    <div class="spread">
      <span class="muted">${esc(h.bookName ?? "")} · ${fmt(h.noInBook)}</span>
      <span class="row">${gradeBadge(h.hukm)}<span class="badge">${esc(h.type ?? "")}</span></span>
    </div>
    <div class="nass nass-sm" style="margin-top:8px">${esc(h.taraf ?? "")}</div>
  </a>`;

export const groupCard = (g) => `
  <a class="card result-card" href="#/group/${g.groupId}">
    <div class="nass nass-sm">${esc(g.nass ?? g.meaning ?? "")}</div>
    <div class="row" style="margin-top:10px">
      <span class="badge">${fmt(g.hadithCount)} رواية</span>
      ${g.sahabiCount != null ? `<span class="badge rank-sahabi">${fmt(g.sahabiCount)} صحابي</span>` : ""}
      ${g.bookCount != null ? `<span class="badge">${fmt(g.bookCount)} كتاب</span>` : ""}
      ${g.score != null ? `<span class="tag-count">تشابه ${fmt(Math.round(g.score * 100))}٪</span>` : ""}
    </div>
  </a>`;

export const rawiCard = (r) => `
  <a class="card result-card" href="#/rawi/${r.rawiId}">
    <div class="spread">
      <strong>${esc(r.nickname)}</strong>
      ${rankBadge(r.rank)}
    </div>
    <div class="muted" style="margin-top:6px">
      ${r.tabaka ? `الطبقة ${fmt(r.tabaka)} · ` : ""}${fmt(r.chainCount)} إسناد
      ${r.deathYear ? ` · ت ${hijri(r.deathYear, r.deathYearRaw)}` : ""}
    </div>
  </a>`;
