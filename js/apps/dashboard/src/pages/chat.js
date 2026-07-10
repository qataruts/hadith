/** المحادثة البحثية — RAG chat with streamed answers and numbered citations. */
import { chatStream } from "../api.js";
import { esc, fmt, gradeBadge } from "../util.js";

let history = [];
let sources = [];
let generation = 0;          // invalidates in-flight streams on page re-entry
let activeCtrl = null;

export async function chatPage() {
  history = [];
  sources = [];
  generation++;
  activeCtrl?.abort();
  activeCtrl = null;
  return `
  <div class="chat-layout">
    <div class="card chat-main">
      <div class="chat-msgs" id="chat-msgs">
        <div class="msg bot">السلام عليكم — اسألني عن أي حديث أو مسألة حديثية، وسأجيبك من قاعدة تضم ${fmt(715790)} حديثاً مع ذكر المصادر ودرجة كل حديث.
مثال: «ما صحة حديث إنما الأعمال بالنيات؟» أو «ما ورد في فضل صلة الرحم؟»</div>
      </div>
      <form class="search-box" id="chat-form" style="max-width:100%">
        <input name="q" placeholder="سؤالك…" autocomplete="off" autofocus />
        <button>إرسال</button>
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
      <div class="spread">
        <span><span class="n">${s.n}</span> ${esc(s.book ?? "")}</span>
        ${gradeBadge(s.hukm)}
      </div>
      <div class="muted" style="margin-top:6px">${esc(s.matn ?? "")}…</div>
    </a>`).join("")}</div>`;
}

/** Replace 【n】 with clickable citation chips. */
const citeHtml = (text) =>
  esc(text).replace(/【(\d+)】/g, (_, n) =>
    `<span class="cite" data-n="${n}" title="المصدر ${n}">${n}</span>`);

document.addEventListener("page:rendered", () => {
  const form = document.getElementById("chat-form");
  if (!form) return;
  const msgs = document.getElementById("chat-msgs");

  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return;
    form.q.value = "";
    form.querySelector("button").disabled = true;

    msgs.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(q)}</div>`);
    msgs.insertAdjacentHTML("beforeend",
      `<div class="msg bot" id="pending"><span class="typing"><i></i><i></i><i></i></span></div>`);
    msgs.lastElementChild.scrollIntoView({ behavior: "smooth" });

    let answer = "";
    const gen = generation;
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    addEventListener("hashchange", () => ctrl.abort(), { once: true });
    const bubble = () => document.getElementById("pending");
    await chatStream(
      { question: q, history: history.slice(-6) },
      {
        onSources(s) { if (gen !== generation) return; sources = s; renderSources(); },
        onDelta(text) {
          if (gen !== generation) return;
          answer += text;
          if (bubble()) bubble().innerHTML = citeHtml(answer);
        },
        onError(err) {
          if (gen !== generation) return;
          if (bubble()) bubble().innerHTML = `<span class="muted">تعذر الجواب — ${esc(err)}</span>`;
          form.querySelector("button").disabled = false;
        },
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
          }
          history.push({ role: "user", text: q }, { role: "model", text: answer });
          form.querySelector("button").disabled = false;
        },
      },
      ctrl.signal);
  };
});
