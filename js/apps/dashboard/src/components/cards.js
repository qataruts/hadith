/** Shared result cards. */
import { esc, fmt, gradeBadge, rankBadge, hijri } from "../util.js";

/* قاعدةُ العرض الثنائية — كلُّ شاشةٍ تفصلُ بين وحدتين وتربطهما:
 *   • الطرفُ  = وحدةُ المعنى الجامعة — لا يُعرَضُ قطُّ بلا عدّاداته.
 *   • الروايةُ = نصٌّ مسندٌ معيَّن — تحملُ دائمًا شريحةَ طرفِها، فلا تطفو منبتَّةً.
 * فيرى الباحثُ أبدًا: هذه روايةٌ واحدةٌ، وهذا موضعُها من معناها الجامع. */

/** opts.noTaraf suppresses the طرف slip (used ON a طرف page, where it's implied).
 *  Note: callers often do `.map(hadithCard)`, which passes the index as the 2nd
 *  argument — so anything non-object is treated as "no options". */
export const hadithCard = (h, opts) => {
  const o = typeof opts === "object" && opts !== null ? opts : {};
  return `
  <div class="card result-card rc-wrap">
    <a class="rc-main" href="#/hadith/${h.hadithId}">
      <div class="spread">
        <span class="muted">${esc(h.bookName ?? "")} · ${fmt(h.noInBook)}</span>
        <span class="row">${gradeBadge(h.hukm)}<span class="badge">${esc(h.type ?? "")}</span></span>
      </div>
      <div class="nass nass-sm" style="margin-top:8px">${esc(h.taraf ?? "")}</div>
    </a>
    ${h.groupId && !o.noTaraf ? `<a class="taraf-slip" href="#/group/${h.groupId}?from=${h.hadithId}"
        title="هذه روايةٌ من طرفٍ (معنًى) له طرقٌ أخرى — اضغطْ لكلِّ رواياته">
        ↖ من طرفٍ${h.groupHadithCount ? ` له ${fmt(h.groupHadithCount)} رواية` : ""}</a>` : ""}
  </div>`;
};

export const groupCard = (g) => `
  <a class="card result-card" href="#/group/${g.groupId}">
    <div class="row" style="margin-bottom:7px">
      <span class="badge taraf-badge" title="وحدةُ المعنى الجامعة — تحتها كلُّ رواياتِه بأسانيدها">طرف</span>
      <span class="badge">${fmt(g.hadithCount)} رواية</span>
      ${g.sahabiCount != null ? `<span class="badge rank-sahabi">${fmt(g.sahabiCount)} صحابي</span>` : ""}
      ${g.bookCount != null ? `<span class="badge">${fmt(g.bookCount)} كتاب</span>` : ""}
      ${g.score != null ? `<span class="tag-count">تشابه ${fmt(Math.round(g.score * 100))}٪</span>` : ""}
    </div>
    <div class="nass nass-sm">${esc(g.nass ?? g.meaning ?? "")}</div>
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
