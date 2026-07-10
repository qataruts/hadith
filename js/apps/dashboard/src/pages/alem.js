import { api } from "../api.js";
import { esc, fmt, rankBadge, hijri } from "../util.js";

export async function alemsPage() {
  const { alems } = await api.alems();
  return `
  <div class="sec-title">أئمة الجرح والتعديل <span class="tag-count">${fmt(alems.length)}</span></div>
  <div class="grid grid-3">
    ${alems.filter((a) => a.aqwalQty > 0).map((a) => `
      <a class="card result-card" href="#/alem/${a.alemId}">
        <div class="spread"><strong>${esc(a.shuhra)}</strong>${rankBadge(a.rank)}</div>
        <div class="muted" style="margin-top:6px">ت ${fmt(a.deathYear)}هـ · ${fmt(a.aqwalQty)} قولاً</div>
      </a>`).join("")}
  </div>`;
}

export async function alemPage({ args: [id], params }) {
  const offset = Number(params.get("offset") ?? 0);
  const a = await api.alem(id, 50, offset);
  if (!a) return `<div class="empty">غير موجود</div>`;
  return `
  <div class="crumbs"><a href="#/alems">النقّاد</a> ‹ ${esc(a.shuhra)}</div>
  <div class="card">
    <div class="spread">
      <div>
        <h2 style="margin:0">${esc(a.shuhra)}</h2>
        <div class="muted">${esc(a.name)}${a.laqab ? ` · ${esc(a.laqab)}` : ""}</div>
      </div>
      ${rankBadge(a.rank)}
    </div>
    <div class="row" style="margin-top:10px">
      ${a.deathYear ? `<span class="badge">ت ${hijri(a.deathYear)}</span>` : ""}
      ${a.tabaka ? `<span class="badge">الطبقة ${fmt(a.tabaka)}</span>` : ""}
      <span class="badge">${fmt(a.aqwalQty)} قولاً في الرواة</span>
    </div>
    ${a.notes ? `<p class="muted" style="margin:10px 0 0">${esc(a.notes)}</p>` : ""}
  </div>
  <div class="sec-title">أقواله في الرواة</div>
  <div class="grid grid-2">
    ${(a.aqwal ?? []).map((q) => `
      <div class="card" style="padding:12px 16px">
        <div>«${esc(q.qawl)}»</div>
        <a class="muted" href="#/rawi/${q.rawiId}">في: ${esc(q.rawi)}</a>
      </div>`).join("")}
  </div>
  <div class="pager">
    ${offset > 0 ? `<a class="btn" href="#/alem/${id}?offset=${Math.max(0, offset - 50)}">السابق</a>` : ""}
    ${(a.aqwal ?? []).length === 50 ? `<a class="btn" href="#/alem/${id}?offset=${offset + 50}">المزيد</a>` : ""}
  </div>`;
}
