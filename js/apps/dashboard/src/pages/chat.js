/** نبراس — one chat surface, two modes:
 *   محادثة  → open RAG Q&A (POST /api/chat)
 *   تحقّق   → paste a claim → claim_check + grounded verdict (POST /api/nibras/compose)
 * The structured result of تحقّق (grade, route spread, matches) fills the source
 * panel; the streamed prose fills the bubble. */
import { chatStream, nibrasComposeStream, api } from "../api.js";
import { esc, fmt, gradeBadge, keyErrorHtml } from "../util.js";
import { getScopeIds } from "../components/scope.js";

let history = [];
let sources = [];
let generation = 0;
let activeCtrl = null;
let mode = "chat";

const LV = ["صحيح", "حسن", "ضعيف", "شديد الضعف", "متهم بالوضع", "موضوع"];
const LVCLS = ["grade-sahih", "grade-hasan", "grade-daif", "grade-daif", "grade-mawdu", "grade-mawdu"];
const lvLabel = (lv) => (lv >= 0 && lv < LV.length ? LV[lv] : "غير محدَّد");

const scopeNote = () => getScopeIds()
  ? `<br/><span class="badge grade-hasan" style="margin-top:6px">ضمن الكتب المختارة (${fmt(getScopeIds().length)}) — غيّرها من زرّ «نطاق الكتب»</span>` : "";
const introFor = (m) => m === "check"
  ? `وضع التحقّق: الصِق حديثاً أو دعوى متداولة، فأبحث عنها في الموسوعة (${fmt(715790)} حديثاً) وأُعطيك لفظها ومصدرها ودرجتها كما دُوِّنت — أو أُخبرك بصراحة أنّي لم أجدها.<br/><span class="nibras-tag" style="margin-top:6px;display:inline-block">قراءةٌ من الموسوعة لا فتوى</span>`
  : `السلام عليكم — اسألني عن أي حديث أو مسألة حديثية، وسأجيبك من قاعدةٍ تضم ${fmt(715790)} حديثاً مع ذكر المصادر ودرجة كل حديث.${scopeNote()}<br/>مثال: «ما صحة حديث إنما الأعمال بالنيات؟» أو «ما ورد في فضل صلة الرحم؟»`;

export async function chatPage() {
  history = []; sources = []; generation++; activeCtrl?.abort(); activeCtrl = null; mode = "chat";
  return `
  <div class="chat-layout">
    <div class="card chat-main">
      <div class="chat-mode" id="chat-mode">
        <button class="cm-btn active" data-mode="chat">محادثة بحثية</button>
        <button class="cm-btn" data-mode="check">تحقّق من حديث</button>
      </div>
      <div class="chat-msgs" id="chat-msgs">
        <div class="msg bot" id="chat-intro">${introFor("chat")}</div>
      </div>
      <form class="search-box" id="chat-form" style="max-width:100%">
        <input name="q" id="chat-input" placeholder="سؤالك…" autocomplete="off" autofocus />
        <button>إرسال</button>
        <button type="button" id="chat-stop" hidden title="إيقاف">إيقاف</button>
      </form>
    </div>
    <div id="chat-sources">
      <div class="card muted">المصادر المسندة لكل جواب تظهر هنا — كل مصدر يفتح صفحة الحديث كاملة بأسانيده.</div>
    </div>
  </div>`;
}

function renderSources() {
  const el = document.getElementById("chat-sources");
  if (!el || !sources.length) return;
  el.innerHTML = `<div class="grid">${sources.map((s) => `
    <a class="card src-card result-card" href="#/hadith/${s.hadithId}" id="src-${s.n}">
      <div class="spread"><span><span class="n">${s.n}</span> ${esc(s.book ?? "")}</span>${gradeBadge(s.hukm)}</div>
      <div class="muted" style="margin-top:6px">${esc(s.matn ?? "")}…</div>
    </a>`).join("")}</div>`;
}

/** تحقّق: the structured claim_check result → source panel. */
function renderCheckPanel(chk) {
  const el = document.getElementById("chat-sources");
  if (!el) return;
  if (!chk || chk.status === "not_found" || chk.status === "empty") {
    el.innerHTML = `<div class="card muted">لم يُعثر على هذا اللفظ في الموسوعة — لا مصادر مطابقة.</div>`;
    return;
  }
  const g = chk.group;
  el.innerHTML = `
    <div class="card">
      <div class="muted" style="font-size:12px;margin-bottom:8px">أقرب المواضع</div>
      ${(chk.matches ?? []).map((m) => `
        <a class="card src-card result-card" href="#/hadith/${m.hadithId}" style="margin-bottom:6px">
          <div class="spread"><span>${esc(m.book ?? "")}${m.noInBook ? ` · ${fmt(m.noInBook)}` : ""}</span>${gradeBadge(m.hukm)}</div>
          <div class="muted" style="margin-top:4px">${esc((m.taraf ?? "").slice(0, 90))}…</div>
        </a>`).join("")}
      ${g ? `<div class="muted" style="font-size:12.5px;margin-top:8px;line-height:2">
        توزيع درجات المعنى (${fmt(g.routes)} طريقاً):<br/>
        ${g.dist.map((x) => `<span class="badge ${LVCLS[x.lv] ?? ""}">${lvLabel(x.lv)} ${fmt(x.c)}</span>`).join(" ")}
        ${g.groupId ? `<br/><a class="chip" style="margin-top:8px" href="#/board/${g.groupId}">لوحة الاعتبار</a>` : ""}
      </div>` : ""}
    </div>`;
}

const citeHtml = (text) =>
  esc(text).replace(/【(\d+)】/g, (_, n) => `<span class="cite" data-n="${n}" title="المصدر ${n}">${n}</span>`);

document.addEventListener("page:rendered", () => {
  const form = document.getElementById("chat-form");
  if (!form) return;
  const msgs = document.getElementById("chat-msgs");
  const input = document.getElementById("chat-input");

  document.getElementById("chat-mode").onclick = (e) => {
    const btn = e.target.closest(".cm-btn");
    if (!btn) return;
    mode = btn.dataset.mode;
    document.querySelectorAll(".cm-btn").forEach((b) => b.classList.toggle("active", b === btn));
    input.placeholder = mode === "check" ? "الصِق حديثاً للتحقّق منه…" : "سؤالك…";
    const intro = document.getElementById("chat-intro");
    if (intro) intro.innerHTML = introFor(mode);
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return;
    if (mode === "check" && q.length < 8) return;
    form.q.value = "";
    const sendBtn = form.querySelector("button");
    sendBtn.disabled = true;

    msgs.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(q)}</div>`);
    msgs.insertAdjacentHTML("beforeend",
      `<div class="msg bot" id="pending"><span class="typing"><i></i><i></i><i></i></span></div>`);
    msgs.lastElementChild.scrollIntoView({ behavior: "smooth" });

    const gen = generation;
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    addEventListener("hashchange", () => ctrl.abort(), { once: true });
    const stopBtn = document.getElementById("chat-stop");
    if (stopBtn) { stopBtn.hidden = false; stopBtn.onclick = () => ctrl.abort(); }
    const bubble = () => document.getElementById("pending");
    const done = () => { sendBtn.disabled = false; if (stopBtn) stopBtn.hidden = true; };
    let answer = "";

    if (mode === "check") {
      nibrasComposeStream(q, {
        onCheck(chk) { if (gen === generation) renderCheckPanel(chk); },
        onDelta(t) { if (gen !== generation) return; answer += t; if (bubble()) bubble().innerHTML = esc(answer).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); },
        onNokey() { if (gen === generation && bubble() && !answer) bubble().innerHTML = `<span class="muted">النتيجة المفصَّلة في اللوحة الجانبية. أضِف مفتاح Gemini لقراءةٍ مركَّبة.</span>`; },
        onError(err) { if (gen === generation && bubble()) bubble().innerHTML = keyErrorHtml(err) ?? `<span class="muted">تعذّر التحقّق — ${esc(err)}</span>`; done(); },
        onDone() { if (gen !== generation) return; const b = bubble(); if (b) b.removeAttribute("id");
          history.push({ role: "user", text: q }, { role: "model", text: answer || "(نتيجة تحقّق)" }); done(); },
      }, ctrl.signal);
      return;
    }

    await chatStream(
      { question: q, history: history.slice(-6) },
      {
        onSources(s) { if (gen !== generation) return; sources = s; renderSources(); },
        onDelta(text) { if (gen !== generation) return; answer += text; if (bubble()) bubble().innerHTML = citeHtml(answer); },
        onError(err) { if (gen !== generation) return; if (bubble()) bubble().innerHTML = keyErrorHtml(err) ?? `<span class="muted">تعذر الجواب — ${esc(err)}</span>`; done(); },
        onDone() {
          if (gen !== generation) return;
          const b = bubble();
          if (b) {
            b.removeAttribute("id");
            b.querySelectorAll(".cite").forEach((c) => {
              c.onclick = () => {
                const src = document.getElementById(`src-${c.dataset.n}`);
                src?.scrollIntoView({ behavior: "smooth", block: "center" });
                src?.animate([{ outline: "2px solid var(--accent)" }, { outline: "none" }], 1200);
              };
            });
            if (answer.trim()) {
              const cp = document.createElement("button");
              cp.className = "chip"; cp.style.marginTop = "10px"; cp.textContent = "نسخ الجواب";
              cp.onclick = () => { navigator.clipboard.writeText(answer); cp.textContent = "نُسخ"; setTimeout(() => (cp.textContent = "نسخ الجواب"), 1500); };
              b.appendChild(cp);
            }
          }
          history.push({ role: "user", text: q }, { role: "model", text: answer });
          done();
        },
      },
      ctrl.signal);
  };
});
