/** الجامع — SPA shell + hash router. */
import "./styles.css";
import { esc } from "./util.js";
import { logoMark, icon } from "./icons.js";
import { initGlossary } from "./components/glossary.js";
import { openScopeModal, scopeLabel, ensureDefaultScope } from "./components/scopebar.js";
import { home } from "./pages/home.js";
import { search } from "./pages/search.js";
import { hadithPage } from "./pages/hadith.js";
import { groupPage } from "./pages/group.js";
import { rawiPage } from "./pages/rawi.js";
import { alemPage, alemsPage } from "./pages/alem.js";
import { bookPage, booksPage } from "./pages/books.js";
import { topicsPage } from "./pages/topics.js";
import { tafarrud } from "./pages/tafarrud.js";
import { quiz } from "./pages/quiz.js";
import { board } from "./pages/board.js";
import { icma } from "./pages/icma.js";
import { conflicts } from "./pages/conflicts.js";
import { check } from "./pages/check.js";
import { chatPage } from "./pages/chat.js";
import { nibras } from "./pages/nibras.js";

const routes = [
  [/^\/?$/, home, "الرئيسية"],
  [/^\/search/, search, "البحث"],
  [/^\/hadith\/(\d+)/, hadithPage, "حديث"],
  [/^\/board\/(\d+)/, board, "لوحة الاعتبار"],
  [/^\/icma\/(\d+)/, icma, "تحليل الإسناد والمتن"],
  [/^\/group\/(\d+)/, groupPage, "معنى"],
  [/^\/rawi\/(\d+)/, rawiPage, "راوٍ"],
  [/^\/alem\/(\d+)/, alemPage, "ناقد"],
  [/^\/alems/, alemsPage, "النقّاد"],
  [/^\/book\/(\d+)/, bookPage, "كتاب"],
  [/^\/books/, booksPage, "الكتب"],
  [/^\/topics(?:\/(\d+))?/, topicsPage, "المواضيع"],
  [/^\/tafarrud/, tafarrud, "الأفراد والغرائب"],
  [/^\/conflicts/, conflicts, "تعارض الأحكام"],
  [/^\/check/, check, "حارس الإسناد"],
  [/^\/quiz/, quiz, "احكم على السند"],
  [/^\/nibras/, nibras, "نِبراس"],
  [/^\/chat/, chatPage, "المحادثة البحثية"],
];

const NAV = [
  ["#/", "الرئيسية"],
  ["#/search", "البحث"],
  ["#/topics", "المواضيع"],
  ["#/tafarrud", "الأفراد والغرائب"],
  ["#/conflicts", "تعارض الأحكام"],
  ["#/check", "حارس الإسناد"],
  ["#/quiz", "احكم على السند"],
  ["#/books", "الكتب"],
  ["#/alems", "النقّاد"],
  ["#/nibras", "نِبراس"],
];

const app = document.getElementById("app");

function shell(content) {
  const cur = location.hash.replace(/\?.*/, "") || "#/";
  return `
  <header class="topbar"><div class="topbar-in">
    <a class="brand" href="#/">${logoMark(30)}<span>الجامع</span> <small>الشبكة المعرفية للحديث الشريف</small></a>
    <nav class="nav">${NAV.map(([h, t]) =>
      `<a href="${h}" class="${(h === "#/" ? cur === "#/" : cur.startsWith(h)) ? "active" : ""}">${t}</a>`).join("")}
    </nav>
    <button class="scope-btn" id="scope-btn" title="اختيار نطاق الكتب التي يعمل ضمنها التطبيق">${icon.scope()} <span id="scope-lbl"></span></button>
    <button class="icon-btn" id="theme-toggle" title="تبديل الوضع الليلي" aria-label="تبديل الوضع الليلي">${icon.moon()}</button>
  </div></header>
  <main class="wrap" id="page">${content}</main>`;
}

let renderToken = 0;
async function route() {
  const token = ++renderToken;
  const hash = location.hash.slice(1) || "/";
  const [path, qs] = hash.split("?");
  const params = new URLSearchParams(qs ?? "");
  for (const [re, page, title] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.title = `${title} — الجامع`;
    app.innerHTML = shell(`<div class="skeleton" style="height:200px"></div>`);
    bindShell();
    try {
      const html = await page({ args: m.slice(1), params, render: (h) => partial(token, h) });
      if (token !== renderToken) return;
      if (html != null) document.getElementById("page").innerHTML = html;
      const y = Number(sessionStorage.getItem("sc:" + (location.hash || "#/")) || 0);
      window.scrollTo({ top: y, behavior: "instant" });   // restore on back-nav, else top
      document.dispatchEvent(new CustomEvent("page:rendered", { detail: { path } }));
    } catch (e) {
      console.error(e);
      if (token === renderToken)
        document.getElementById("page").innerHTML =
          `<div class="empty">تعذر تحميل الصفحة<br/><span class="muted">${esc(String(e.message ?? e))}</span><br/><a class="btn" style="margin-top:10px;display:inline-block" href="${location.hash}" onclick="location.reload()">إعادة المحاولة</a></div>`;
    }
    return;
  }
  document.title = "الجامع";
  app.innerHTML = shell(`<div class="empty">الصفحة غير موجودة — <a href="#/">العودة للرئيسية</a></div>`);
  bindShell();
}

function partial(token, html) {
  if (token !== renderToken) return;
  document.getElementById("page").innerHTML = html;
  document.dispatchEvent(new CustomEvent("page:rendered", {}));
}

function bindShell() {
  const sb = document.getElementById("scope-btn");
  if (sb) {
    document.getElementById("scope-lbl").textContent = scopeLabel();
    sb.onclick = openScopeModal;
  }
  const tt = document.getElementById("theme-toggle");
  const paintTheme = () =>
    (tt.innerHTML = document.documentElement.dataset.theme === "dark" ? icon.sun() : icon.moon());
  paintTheme();
  tt.onclick = () => {
    const cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = cur;
    localStorage.setItem("theme", cur);
    paintTheme();
  };
}

const saved = localStorage.getItem("theme");
document.documentElement.dataset.theme =
  saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

initGlossary();
ensureDefaultScope();                    // first-ever load → default to top-30 books
addEventListener("scope:change", route); // re-render the current view on scope change
addEventListener("hashchange", (e) => {   // save the leaving page's scroll, then route
  const old = "#" + (e.oldURL.split("#")[1] ?? "/");
  try { sessionStorage.setItem("sc:" + old, String(window.scrollY)); } catch { /* private mode */ }
  route();
});
route();
