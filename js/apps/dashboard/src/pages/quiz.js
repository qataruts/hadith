/** «احكم على السند» — grade-the-chain quiz. Shows a random hadith's isnad with
 * the narrators' grades; the student judges the ruling, then the answer and the
 * weakest link are revealed. Score is kept for the session. */
import { api } from "../api.js";
import { esc, rankBadge, rankVar, isBreakMarker } from "../util.js";

const OPTIONS = [
  ["sahih", "صحيح", "grade-sahih"], ["hasan", "حسن", "grade-hasan"],
  ["daif", "ضعيف", "grade-daif"], ["mawdu", "موضوع/منكر", "grade-mawdu"],
];
const score = { right: 0, total: 0 };

export async function quiz() {
  document.title = "احكم على السند — الجامع";
  return `
    <div class="wrap-narrow" style="margin:0 auto">
      <div class="spread" style="margin-bottom:4px">
        <h1 style="margin:0;font-size:26px">احكم على السند</h1>
        <span class="badge" id="quiz-score">${score.total ? `${score.right} / ${score.total}` : "ابدأ"}</span>
      </div>
      <p class="muted" style="margin:0 0 16px">تأمّل رواة الإسناد ودرجاتهم، ثم احكم على الحديث — والإسناد لا يقوى إلا بأضعف رجاله.</p>
      <div id="quiz-card"><div class="skeleton" style="height:280px"></div></div>
    </div>`;
}

async function loadQuestion() {
  const card = document.getElementById("quiz-card");
  if (!card) return;
  card.innerHTML = `<div class="skeleton" style="height:280px"></div>`;
  let q;
  try { q = await api.quiz(); } catch { card.innerHTML = `<div class="empty">تعذّر جلب سؤال</div>`; return; }
  if (!q) { card.innerHTML = `<div class="empty">تعذّر جلب سؤال — أعد المحاولة</div>`; return; }

  const chainHtml = q.chain.map((c) => {
    const brk = isBreakMarker(c.name);
    return `<div class="chain-node" style="--rk:${brk ? "var(--critical)" : rankVar(c.rank ?? "")}">
      <span class="chain-dot"></span><span class="chain-line"></span>
      <span class="chain-name">${brk ? `<span class="muted">⌁ ${esc(c.name)}</span>`
        : `<a href="#/rawi/${c.rawiId}">${esc(c.name)}</a>`}</span>
      ${brk ? "" : rankBadge(c.rank)}
    </div>`;
  }).join("");

  card.innerHTML = `
    <div class="card">
      <div class="nass nass-sm" style="margin-bottom:10px">${esc(q.taraf ?? "")}</div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">النوع: ${esc(q.type ?? "")} · السلسلة من الصحابي نزولاً إلى المصنّف:</div>
      <div class="chain">${chainHtml}</div>
    </div>
    <div class="quiz-options" id="quiz-options">
      ${OPTIONS.map(([k, l, cls]) => `<button class="btn quiz-opt" data-k="${k}"><span class="badge ${cls}">${l}</span></button>`).join("")}
    </div>
    <div id="quiz-reveal"></div>`;

  const opts = document.getElementById("quiz-options");
  opts.querySelectorAll(".quiz-opt").forEach((b) => (b.onclick = () => answer(q, b.dataset.k, opts)));
}

function answer(q, picked, opts) {
  opts.querySelectorAll(".quiz-opt").forEach((b) => {
    b.disabled = true;
    if (b.dataset.k === q.answer) b.classList.add("correct");
    else if (b.dataset.k === picked) b.classList.add("wrong");
  });
  const ok = picked === q.answer;
  score.total++; if (ok) score.right++;
  const sc = document.getElementById("quiz-score");
  if (sc) sc.textContent = `${score.right} / ${score.total}`;

  document.getElementById("quiz-reveal").innerHTML = `
    <div class="why-box" style="margin-top:12px">
      <div class="why-verdict ${ok ? "ok" : "warn"}">${ok ? "أصبت ✓" : "الصواب:"} الحكم «${esc(q.hukm)}»</div>
      ${q.weakest ? `<div style="font-size:14px;margin-top:4px">أضعف رجاله <a href="#/rawi/${q.weakest.rawiId}">${esc(q.weakest.name)}</a> ${rankBadge(q.weakest.rank)} — وعليه مدار الحكم غالباً.</div>` : ""}
      <div class="row" style="margin-top:12px;gap:8px">
        <a class="chip" href="#/hadith/${q.hadithId}">افتح الحديث كاملاً ←</a>
        <button class="btn primary" id="quiz-next">سؤال جديد</button>
      </div>
    </div>`;
  document.getElementById("quiz-next").onclick = loadQuestion;
}

document.addEventListener("page:rendered", () => {
  if (document.getElementById("quiz-card") && !document.getElementById("quiz-options"))
    loadQuestion();
});
