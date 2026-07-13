/** نبراس · حارس الإسناد (claim_check) — paste a circulating hadith/claim; the
 * app searches the encyclopedia and returns the matched wording, its book +
 * grade, and whether the MEANING is authenticated by any route. Absence is a
 * coverage statement, never «لا أصل له». It only reports recorded gradings. */
import { api, nibrasComposeStream } from "../api.js";
import { esc, fmt, gradeBadge } from "../util.js";

let streamAbort = null;

const LV = ["صحيح", "حسن", "ضعيف", "شديد الضعف", "متهم بالوضع", "موضوع"];
const LVCLS = ["grade-sahih", "grade-hasan", "grade-daif", "grade-daif", "grade-mawdu", "grade-mawdu"];
const lvLabel = (lv) => (lv >= 0 && lv < LV.length ? LV[lv] : "غير محدَّد");

export async function check() {
  document.title = "حارس الإسناد — الجامع";
  return `
    <div class="wrap-narrow" style="margin:0 auto">
      <h1 style="margin:0 0 4px">حارس الإسناد</h1>
      <p class="muted" style="margin:0 0 10px">
        الصِق حديثاً أو دعوى متداولة، فأبحث عنها في الموسوعة (٧١٥ ألف حديث)، وأُعيد لك
        لفظها ومصدرها ودرجتها كما سُجِّلت — أو أُخبرك بصراحةٍ أنّي لم أجدها.
      </p>
      <div class="nibras-banner">بياناتٌ من الموسوعة، لا فتوى — الأحكام منقولةٌ عن أهلها كما دُوِّنت.</div>
      <form id="check-form" style="margin:14px 0">
        <textarea id="check-q" rows="3" placeholder="الصِق نص الحديث هنا…"
          style="width:100%;padding:12px 14px;border:1px solid var(--hairline);border-radius:10px;background:var(--surface);color:var(--ink);font-family:var(--font-nass);font-size:17px;line-height:1.9;resize:vertical"></textarea>
        <button class="btn primary" style="margin-top:8px">تحقّق</button>
      </form>
      <div id="check-result"></div>
    </div>`;
}

function run() {
  const q = document.getElementById("check-q").value.trim();
  const box = document.getElementById("check-result");
  if (q.length < 8) { box.innerHTML = `<div class="muted" style="padding:8px">اكتب نصاً أطول للبحث…</div>`; return; }
  streamAbort?.abort();
  streamAbort = new AbortController();
  box.innerHTML = `
    <div id="nibras-prose" class="card verdict-card v-medium" style="display:none"></div>
    <div id="nibras-struct"><div class="skeleton" style="height:120px"></div></div>`;
  const prose = box.querySelector("#nibras-prose");
  const struct = box.querySelector("#nibras-struct");
  let text = "";
  const paint = () => {
    prose.style.display = "";
    prose.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:4px">قراءة نبراس</div>
      <div style="font-size:16px;line-height:2;white-space:pre-wrap">${esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</div>`;
  };
  nibrasComposeStream({ claim: q }, {
    onCheck: (chk) => { struct.innerHTML = render(chk); },
    onDelta: (t) => { text += t; paint(); },
    onNokey: () => { /* structured result already shown; no composed reading without a key */ },
    onError: async () => {
      if (!struct.querySelector(".verdict-card")) {           // structured never arrived → fallback
        const d = await api.nibrasCheck(q).catch(() => null);
        struct.innerHTML = d ? render(d) : `<div class="empty">تعذّر البحث</div>`;
      }
    },
    onDone: () => {},
  }, streamAbort.signal);
}

function render(d) {
  if (d.status === "empty")
    return `<div class="muted" style="padding:8px">اكتب نصاً أطول للبحث…</div>`;
  if (d.status === "not_found")
    return `
      <div class="card verdict-card v-alone">
        <div class="verdict-text">لم أعثر على هذا اللفظ في هذه الموسوعة.</div>
        <div class="muted" style="margin-top:8px;line-height:1.9">
          بحثتُ في ${fmt(d.searched)} حديثاً. وهذا <b>بيان تغطية</b> لا حكمٌ بعدم وجوده؛
          فقد يكون في مصادر أخرى، أو بلفظٍ مختلف، أو أثراً موقوفاً/مقطوعاً خارج التغطية
          الدلالية الحالية. جرِّب لفظاً أدقّ أو ابحث بالمعنى من صفحة البحث.
        </div>
      </div>`;

  const g = d.group;
  const found = d.status === "found";
  return `
    <div class="card verdict-card ${found ? "v-strong" : "v-medium"}">
      <div class="verdict-text">${found ? "وجدتُ هذا اللفظ في الموسوعة." : "وجدتُ لفظاً مقارباً — لا مطابقاً تماماً."}</div>
      <div style="margin-top:10px;font-size:15px">
        <a href="#/hadith/${d.best.hadithId}"><b>${esc(d.best.book ?? "")}</b>${d.best.noInBook ? ` · رقم ${fmt(d.best.noInBook)}` : ""}</a>
        ${d.best.hukm ? gradeBadge(d.best.hukm) : ""}
        <span class="muted" style="font-size:12.5px"> · تطابق ${d.best.coverage}%</span>
      </div>
      ${g ? `<div class="muted" style="margin-top:12px;line-height:2">
        والمعنى ورد من <b>${fmt(g.routes)}</b> طريقاً، وتوزُّع درجاتها:<br/>
        ${g.dist.map((x) => `<span class="badge ${LVCLS[x.lv] ?? ""}">${lvLabel(x.lv)} ×${fmt(x.c)}</span>`).join(" ")}
        ${g.bestLv <= 1 && g.worstLv >= 3
          ? `<br/><b style="color:var(--ink-2)">تتفاوت الطرق في الدرجة</b> — فالعبرة بأقواها؛ افتح الحديث لترى حكم كل طريقٍ وسببه، أو <a href="#/board/${g.groupId}">لوحة الاعتبار</a>.`
          : ""}
      </div>` : ""}
    </div>
    ${(d.matches?.length ?? 0) > 1 ? `
      <h3 style="margin:18px 0 8px">مواضع أخرى وردت</h3>
      <div class="grid">
        ${d.matches.slice(1).map((m) => `
          <a class="card result-card" href="#/hadith/${m.hadithId}">
            <div class="nass nass-sm">${esc(m.taraf ?? "")}</div>
            <div class="row" style="margin-top:8px;gap:8px;align-items:center">
              ${m.hukm ? gradeBadge(m.hukm) : ""}
              <span class="tag-count" style="margin-inline-start:auto">${esc(m.book ?? "")}${m.noInBook ? ` · ${fmt(m.noInBook)}` : ""} · تطابق ${m.coverage}%</span>
            </div>
          </a>`).join("")}
      </div>` : ""}`;
}

document.addEventListener("page:rendered", () => {
  const f = document.getElementById("check-form");
  if (!f || f.dataset.bound) return;
  f.dataset.bound = "1";
  f.onsubmit = (e) => { e.preventDefault(); run(); };
});
