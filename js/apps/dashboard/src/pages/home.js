import { api } from "../api.js";
import { esc, fmt } from "../util.js";
import { statTiles, bars } from "../components/charts.js";

export async function home() {
  const stats = await api.stats();
  const { counts, tasnifs, topRawis, topGroups, grades, scopedBooks } = stats;
  const topGroupDocs = await Promise.all(
    (topGroups ?? []).slice(0, 6).map((g) => api.group(g.groupId, 0).catch(() => null)));

  return `
  <div class="search-hero">
    <h1>الجامع</h1>
    <p>شبكة معرفية تربط ${fmt(counts.hadiths)} حديثاً بأسانيدها ورواتها ومعانيها — من ${fmt(counts.books)} كتاباً
    ${scopedBooks ? `<br/><span class="badge grade-hasan" style="margin-top:6px">الأرقام ضمن ${fmt(scopedBooks)} كتاباً مختاراً — غيّرها من زرّ 📚 أعلى الصفحة</span>` : ""}</p>
    <form class="search-box" id="hero-search">
      <input name="q" placeholder="ابحث بنص الحديث أو بالمعنى…" autocomplete="off" autofocus />
      <button>بحث</button>
    </form>
    <div class="mode-pills" id="hero-modes">
      <button class="chip active" data-mode="semantic">بالمعنى</button>
      <button class="chip" data-mode="text">باللفظ</button>
      <button class="chip" data-mode="rawi">عن راوٍ</button>
      <a class="chip" href="#/chat">💬 اسأل سؤالاً بحثياً</a>
    </div>
  </div>

  ${statTiles([
    { v: counts.hadiths, k: "حديث" },
    { v: counts.sanads, k: "إسناد" },
    { v: counts.rawis, k: "راوٍ" },
    { v: counts.groups, k: "معنى (طرف)" },
    { v: counts.books, k: "كتاب" },
    { v: counts.aqwal, k: "قول في الجرح والتعديل" },
  ])}

  <div class="sec-title">أكثر المعاني رواية</div>
  <div class="grid grid-2">
    ${topGroupDocs.filter(Boolean).map((g) => `
      <a class="card result-card" href="#/group/${g.groupId}">
        <div class="nass nass-sm">${esc(g.nass.slice(0, 140))}${g.nass.length > 140 ? "…" : ""}</div>
        <div class="row" style="margin-top:8px">
          <span class="badge">${fmt(g.hadithCount)} رواية</span>
          <span class="badge rank-sahabi">${fmt(g.sahabis.length)} صحابي</span>
          <span class="badge">${fmt(g.books.length)} كتاب</span>
        </div>
      </a>`).join("")}
  </div>

  <div class="grid grid-2" style="margin-top:28px">
    <div class="card">
      <h3>أكثر الرواة إسناداً</h3>
      ${bars((topRawis ?? []).slice(0, 10).map((r) => ({
        label: r.name, value: r.chains, href: `#/rawi/${r.rawiId}` })))}
    </div>
    <div class="card">
      <h3>مصنفات الكتب</h3>
      ${bars((tasnifs ?? []).map((t) => ({
        label: t.tasnif, value: t.hadiths, title: `${t.books} كتاباً` })))}
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3>درجات الأحاديث</h3>
    ${bars((grades ?? []).slice(0, 8).map((g) => ({ label: g.grade, value: g.c })))}
  </div>`;
}

document.addEventListener("page:rendered", () => {
  const form = document.getElementById("hero-search");
  if (!form) return;
  let mode = "semantic";
  document.querySelectorAll("#hero-modes .chip[data-mode]").forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      mode = b.dataset.mode;
      document.querySelectorAll("#hero-modes .chip").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    };
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (q) location.hash = `#/search?mode=${mode}&q=${encodeURIComponent(q)}`;
  };
});
