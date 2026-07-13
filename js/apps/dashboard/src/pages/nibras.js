/** نِبراس — grounded multi-chat research assistant for «الجامع» (ported from the
 * Quran «نِبراس»). A planner routes each turn to: search hadith/آثār by meaning ·
 * verify a claim · or draft a خطبة/منشور/محاضرة/تلخيص from the gathered material —
 * always grounded in the encyclopedia, always cited. «قراءةٌ من الموسوعة لا فتوى». */
import { api, nibrasComposeStream } from "../api.js";
import { esc, fmt, gradeBadge } from "../util.js";
import * as store from "../components/nibras-store.js";
import { icon } from "../icons.js";

let currentId = null;
let busy = false;
let unsub = null;
let streamAbort = null;

const EXAMPLES = [
  "ابحثْ عن أحاديثَ في فضل الصبر على البلاء",
  "ما صحّة حديث «مَن غشَّنا فليس منّا»؟",
  "اجمعْ أحاديثَ في صلة الرحم، ثمّ اكتبْ منشوراً موجزاً منها",
  "أحاديثُ في برّ الوالدين، ثمّ مسوّدةُ خطبة",
];

export async function nibras() {
  document.title = "نِبراس — الجامع";
  if (!currentId || !store.getChat(currentId)) currentId = store.getChats()[0]?.id ?? null;
  return `
  <div class="nib-page">
    <aside class="nib-list" id="nib-list"></aside>
    <section class="nib-main">
      <div class="nib-thread" id="nib-thread"></div>
      <form class="nib-inputbar" id="nib-form">
        <div class="nib-input">
          <textarea id="nib-q" rows="1" placeholder="اكتبْ ما تريد — موضوعاً للبحث، أو حديثاً للتحقّق، أو اطلبْ صياغة…" autocomplete="off"></textarea>
          <button class="nib-send" id="nib-send" title="إرسال" aria-label="إرسال">${icon.node({ size: 18 })}</button>
        </div>
        <div class="nib-foot">نِبراس يجمع ويصوغ من الموسوعة — مسوّداتٌ للباحث، قراءةٌ من الموسوعة لا فتوى.</div>
      </form>
    </section>
  </div>`;
}

// ── rendering ────────────────────────────────────────────────────────────────
function renderList() {
  const el = document.getElementById("nib-list");
  if (!el) return;
  const chats = store.getChats();
  el.innerHTML = `
    <button class="nib-new" id="nib-new">${icon.chat({ size: 15 })} محادثة جديدة</button>
    <div class="nib-chats">
      ${chats.map((c) => `
        <div class="nib-chat ${c.id === currentId ? "on" : ""}" data-id="${c.id}">
          <span class="nib-chat-t">${esc(c.title || "محادثة")}</span>
          <button class="nib-chat-x" data-del="${c.id}" title="حذف" aria-label="حذف">${icon.close({ size: 13 })}</button>
        </div>`).join("") || `<div class="muted" style="padding:10px;font-size:12.5px">لا محادثات بعد</div>`}
    </div>`;
}

const HERO = `
  <div class="nib-hero">
    <div class="nib-hero-mark">${icon.node({ size: 34 })}</div>
    <h2 class="nib-hero-h">بمَ نبدأ؟</h2>
    <p class="nib-hero-sub">نِبراس — بحثٌ بالمعنى، وتحقّقٌ من الأحاديث، وصياغةٌ من الموسوعة (٧١٥ ألف حديثٍ وآثارُها). اكتبْ موضوعاً، أو الصِقْ حديثاً للتحقّق، أو اطلبْ خطبةً أو منشوراً من الأحاديث.</p>
    <div class="nib-examples">
      ${EXAMPLES.map((e) => `<button class="nib-ex" data-ex="${esc(e)}">${esc(e)}</button>`).join("")}
    </div>
  </div>`;

const bold = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

function hadithCards(ahadith) {
  if (!ahadith?.length) return "";
  return `<div class="nib-ahadith">${ahadith.map((h) => `
    <a class="nib-hadith" href="#/hadith/${h.hadithId}">
      <div class="nib-hadith-t">${esc((h.matn ?? "").slice(0, 220))}</div>
      <div class="nib-hadith-r">
        ${h.kind && h.kind !== "مرفوع" ? `<span class="badge">${esc(h.kind)}</span>` : ""}
        ${h.hukm ? gradeBadge(h.hukm) : ""}
        <span class="tag-count" style="margin-inline-start:auto">${esc(h.book ?? "")}${h.noInBook ? ` · ${fmt(h.noInBook)}` : ""}</span>
      </div>
    </a>`).join("")}</div>`;
}

function msgHtml(m) {
  if (m.role === "user") return `<div class="nib-msg"><div class="nib-user">${esc(m.text)}</div></div>`;
  const parts = [];
  if (m.pending && !m.text && !m.draft) parts.push(`<div class="nib-typing"><i></i><i></i><i></i></div>`);
  if (m.text) parts.push(`<div class="nib-reply ${m.error ? "err" : ""}">${bold(m.text)}</div>`);
  if (m.ahadith?.length) parts.push(hadithCards(m.ahadith));
  if (m.draft) parts.push(`
    <div class="nib-draft">
      <div class="nib-draft-note">مسوّدةٌ من أحاديثِ الموسوعة — راجِعْها. قراءةٌ لا فتوى.</div>
      <div class="nib-draft-body">${bold(m.draft)}</div>
      <button class="nib-copy" data-copy="${m.id}">نسخ</button>
    </div>`);
  return `<div class="nib-msg"><div class="nib-asst" data-mid="${m.id}">${parts.join("")}</div></div>`;
}

function renderThread() {
  const el = document.getElementById("nib-thread");
  if (!el) return;
  const chat = store.getChat(currentId);
  if (!chat || !chat.messages.length) { el.innerHTML = HERO; bindHero(); return; }
  el.innerHTML = chat.messages.map(msgHtml).join("");
  el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => {
    const m = chat.messages.find((x) => x.id === b.dataset.copy);
    if (m?.draft) { navigator.clipboard.writeText(m.draft); b.textContent = "نُسخ"; setTimeout(() => (b.textContent = "نسخ"), 1400); }
  }));
  el.scrollTop = el.scrollHeight;
}

// live handle to the streaming assistant bubble (avoids full re-render mid-stream)
function bubbleEl(mid) { return document.querySelector(`.nib-asst[data-mid="${mid}"]`); }

// ── the turn ─────────────────────────────────────────────────────────────────
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  const q = document.getElementById("nib-q");
  if (q) { q.value = ""; q.style.height = "auto"; }
  document.getElementById("nib-send")?.setAttribute("disabled", "");

  if (!currentId || !store.getChat(currentId)) currentId = store.createChat();
  const chat = store.getChat(currentId);
  if (chat.messages.length === 0) store.renameChat(currentId, text.slice(0, 42));

  store.addMessage(currentId, { role: "user", text });
  const mid = store.addMessage(currentId, { role: "assistant", pending: true });
  renderThread();

  streamAbort?.abort();
  streamAbort = new AbortController();
  const finish = (patch) => { store.patchMessage(currentId, mid, { ...patch, pending: false }); busy = false; document.getElementById("nib-send")?.removeAttribute("disabled"); renderThread(); };

  try {
    const material = store.chatMaterial(chat);
    const messages = chat.messages.filter((m) => !m.pending).map((m) => ({ role: m.role, text: m.text }));
    const plan = await api.nibrasPlan(messages, material);

    // gather (search_meaning / the search half of search_compose)
    let gathered = [];
    if (plan.action === "search_meaning" || plan.action === "search_compose") {
      const r = await api.nibrasRetrieve(plan.query || text).catch(() => ({ hits: [] }));
      gathered = r.hits ?? [];
    }

    if (plan.action === "check") {
      // verify a claim → structured verdict panel + streamed reading
      let prose = "", checkData = null;
      const el = () => bubbleEl(mid);
      const paint = () => { if (el()) el().innerHTML = `<div class="nib-reply">${bold(prose)}</div>${checkData ? checkCards(checkData) : ""}`; };
      await nibrasComposeStream({ claim: plan.query || text }, {
        onCheck(c) { checkData = c; paint(); },
        onDelta(t) { prose += t; paint(); },
        onNokey() { if (!prose) prose = "النتيجة في الأسفل — أضِفْ مفتاح Gemini لقراءةٍ مركّبة."; paint(); },
        onError() {}, onDone() {},
      }, streamAbort.signal);
      finish({ text: prose || plan.reply, ahadith: checkData?.matches?.map((x) => ({ hadithId: x.hadithId, matn: x.taraf, book: x.book, noInBook: x.noInBook, hukm: x.hukm, kind: "مرفوع" })) ?? [] });
      return;
    }

    if (plan.action === "compose" || plan.action === "search_compose") {
      // union of freshly-gathered + prior material; continue any prior draft
      const union = new Map();
      for (const h of [...gathered, ...material.ahadith]) if (!union.has(h.hadithId)) union.set(h.hadithId, h);
      const ahadith = [...union.values()].slice(0, 16);
      if (!ahadith.length) { finish({ text: "لم أجدْ أحاديثَ لأبني عليها — جرّبْ صياغةً أدقَّ للموضوع، أو ابحثْ أوّلاً." }); return; }
      const task = ["khutba", "post", "lecture", "summary"].includes(plan.task) ? plan.task : "post";
      const length = plan.length || (task === "khutba" || task === "lecture" ? "long" : "medium");
      const el = () => bubbleEl(mid);
      let draft = "";
      // show the gathered sources immediately, then stream the draft under them
      if (el()) el().innerHTML = (plan.reply ? `<div class="nib-reply">${esc(plan.reply)}</div>` : "") + hadithCards(gathered.length ? gathered : ahadith) + `<div class="nib-draft"><div class="nib-draft-note">أصوغُ المسوّدة…</div><div class="nib-draft-body" id="nib-live-${mid}"></div></div>`;
      await nibrasComposeStream(
        { task, subject: plan.subject || text, length, ahadith, instruction: text, previous: store.lastDraft(chat) },
        { onDelta(t) { draft += t; const live = document.getElementById(`nib-live-${mid}`); if (live) live.innerHTML = bold(draft); },
          onNokey() { draft = "الصياغة تتطلّب مفتاح Gemini على الخادم."; }, onError() {}, onDone() {} },
        streamAbort.signal);
      finish({ text: plan.reply || "", ahadith: gathered, draft: draft || "(تعذّرت الصياغة)", composed: true });
      return;
    }

    // search_meaning → show cards; none → just the reply
    finish({ text: plan.reply || (gathered.length ? "" : "لا نتائج."), ahadith: gathered });
  } catch (e) {
    finish({ text: `تعذّر إتمام الطلب — ${esc(String(e.message ?? e))}`, error: true });
  }
}

function checkCards(c) {
  if (!c || c.status === "not_found" || c.status === "empty")
    return `<div class="muted" style="margin-top:8px;font-size:12.5px">لم يُعثر على اللفظ في الموسوعة — بيانُ تغطيةٍ لا حكمٌ بعدمِ الوجود.</div>`;
  return hadithCards((c.matches ?? []).map((x) => ({ hadithId: x.hadithId, matn: x.taraf, book: x.book, noInBook: x.noInBook, hukm: x.hukm, kind: "مرفوع" })));
}

// ── binding ──────────────────────────────────────────────────────────────────
function bindHero() {
  document.querySelectorAll(".nib-ex").forEach((b) => (b.onclick = () => send(b.dataset.ex)));
}

document.addEventListener("page:rendered", () => {
  const form = document.getElementById("nib-form");
  if (!form) { unsub?.(); unsub = null; return; }   // left the page
  renderList();
  renderThread();

  const q = document.getElementById("nib-q");
  q.oninput = () => { q.style.height = "auto"; q.style.height = Math.min(160, q.scrollHeight) + "px"; };
  q.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q.value); } };
  form.onsubmit = (e) => { e.preventDefault(); send(q.value); };

  document.getElementById("nib-list").onclick = (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); if (confirm("حذف هذه المحادثة؟")) { store.deleteChat(del.dataset.del); if (currentId === del.dataset.del) currentId = store.getChats()[0]?.id ?? null; renderList(); renderThread(); } return; }
    if (e.target.closest("#nib-new")) { currentId = store.createChat(); renderList(); renderThread(); q.focus(); return; }
    const row = e.target.closest(".nib-chat");
    if (row) { currentId = row.dataset.id; renderList(); renderThread(); }
  };

  unsub?.();
  unsub = store.subscribe(() => renderList());   // keep the list live; thread is managed by the turn
});
