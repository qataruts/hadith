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

// Top-nav grouped so ten destinations don't sprawl across one row: two always-
// visible entry points (الرئيسية · البحث), two themed dropdowns (الأدوات · التصفّح),
// and نِبراس set apart as the AI companion. Dropdown menus are positioned fixed on
// open (openNavGroup), so the horizontally-scrollable mobile nav never clips them.
const NAV = [
  { href: "#/", label: "الرئيسية" },
  { href: "#/search", label: "البحث" },
  {
    label: "الأدوات", items: [
      ["#/check", "حارس الإسناد"],
      ["#/conflicts", "تعارض الأحكام"],
      ["#/tafarrud", "الأفراد والغرائب"],
      ["#/quiz", "احكم على السند"],
    ],
  },
  {
    label: "التصفّح", items: [
      ["#/topics", "المواضيع"],
      ["#/books", "الكتب"],
      ["#/alems", "النقّاد"],
    ],
  },
  { href: "#/nibras", label: "نِبراس", cls: "nav-nibras" },
];

const navActive = (h, cur) => (h === "#/" ? cur === "#/" : cur.startsWith(h));

/** Render the grouped nav: plain links + dropdown groups (menu hidden until opened). */
function renderNav(cur) {
  return NAV.map((it) => {
    if (!it.items) {
      return `<a href="${it.href}" class="${it.cls ? it.cls + " " : ""}${navActive(it.href, cur) ? "active" : ""}">${it.label}</a>`;
    }
    const active = it.items.some(([h]) => navActive(h, cur));
    const menu = it.items
      .map(([h, t]) => `<a href="${h}" role="menuitem" class="${navActive(h, cur) ? "active" : ""}">${t}</a>`)
      .join("");
    return `<div class="nav-group">`
      + `<button class="nav-group-btn${active ? " active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">${it.label}<span class="nav-caret" aria-hidden="true">▾</span></button>`
      + `<div class="nav-group-menu" role="menu" hidden>${menu}</div>`
      + `</div>`;
  }).join("");
}

/** Mobile drawer nav: primary links flat, each group as a labelled section. */
function renderDrawerNav(cur) {
  return NAV.map((it) => {
    if (!it.items) {
      return `<a href="${it.href}" class="${it.cls ? it.cls + " " : ""}${navActive(it.href, cur) ? "active" : ""}">${it.label}</a>`;
    }
    return `<div class="drawer-section"><div class="drawer-section-h">${it.label}</div>`
      + it.items.map(([h, t]) => `<a href="${h}" class="${navActive(h, cur) ? "active" : ""}">${t}</a>`).join("")
      + `</div>`;
  }).join("");
}

/* Mobile drawer — open/close via a body class (the markup lives in the shell and
 * re-renders each route, so route() clears the class; delegated handlers below). */
function openDrawer() {
  document.body.classList.add("drawer-open");
  document.getElementById("menu-btn")?.setAttribute("aria-expanded", "true");
}
function closeDrawer() {
  document.body.classList.remove("drawer-open");
  document.getElementById("menu-btn")?.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", (e) => {
  if (e.target.closest?.("#menu-btn")) { e.preventDefault(); openDrawer(); return; }
  if (e.target.closest?.("[data-drawer-close]") || e.target.closest?.(".drawer-nav a")) closeDrawer();
});

/* Grouped-nav dropdowns — fixed-positioned menus, wired once via delegation
 * (the whole shell re-renders on every route, so per-element handlers would leak). */
function closeNavGroups() {
  document.querySelectorAll(".nav-group.open").forEach((g) => {
    g.classList.remove("open");
    g.querySelector(".nav-group-btn")?.setAttribute("aria-expanded", "false");
    const m = g.querySelector(".nav-group-menu");
    if (m) m.hidden = true;
  });
}
function openNavGroup(g) {
  const btn = g.querySelector(".nav-group-btn");
  const menu = g.querySelector(".nav-group-menu");
  if (!btn || !menu) return;
  menu.hidden = false;
  g.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  const r = btn.getBoundingClientRect();                       // fixed → viewport coords, RTL-aligned
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
  menu.style.left = "auto";
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest?.(".nav-group-btn");
  if (btn) {
    e.preventDefault();
    const g = btn.closest(".nav-group");
    const wasOpen = g.classList.contains("open");
    closeNavGroups();
    if (!wasOpen) openNavGroup(g);
    return;
  }
  if (e.target.closest?.(".nav-group-menu a")) return closeNavGroups(); // navigate + close
  if (!e.target.closest?.(".nav-group-menu")) closeNavGroups();          // click outside
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeNavGroups(); closeDrawer(); } });
addEventListener("resize", closeNavGroups);
document.addEventListener("scroll", closeNavGroups, { passive: true, capture: true }); // capture: inner scrollers too

const app = document.getElementById("app");

function shell(content) {
  const cur = location.hash.replace(/\?.*/, "") || "#/";
  return `
  <header class="topbar"><div class="topbar-in">
    <button class="menu-btn" id="menu-btn" type="button" aria-label="القائمة" aria-controls="drawer" aria-expanded="false">☰</button>
    <a class="brand" href="#/">${logoMark(30)}<span>الجامع</span> <small>الشبكة المعرفية للحديث الشريف</small></a>
    <nav class="nav">${renderNav(cur)}</nav>
    <button class="scope-btn" id="scope-btn" title="اختيار نطاق الكتب التي يعمل ضمنها التطبيق">${icon.scope()} <span id="scope-lbl"></span></button>
    <button class="icon-btn" id="theme-toggle" title="تبديل الوضع الليلي" aria-label="تبديل الوضع الليلي">${icon.moon()}</button>
  </div></header>
  <div class="drawer-root" id="drawer">
    <div class="drawer-backdrop" data-drawer-close></div>
    <aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="قائمة التنقّل">
      <div class="drawer-head">
        <span class="drawer-brand">الجامع</span>
        <button class="drawer-close" data-drawer-close type="button" aria-label="إغلاق القائمة">✕</button>
      </div>
      <nav class="drawer-nav">${renderDrawerNav(cur)}</nav>
    </aside>
  </div>
  <main class="wrap" id="page">${content}</main>`;
}

let renderToken = 0;
async function route() {
  const token = ++renderToken;
  document.body.classList.remove("drawer-open"); // shell re-renders below; never carry an open drawer across nav
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
