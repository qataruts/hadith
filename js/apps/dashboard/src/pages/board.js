/** لوحة الاعتبار — the i'tibar workbench. One screen combining the merged isnad
 * network with a group-level i'tibar: pick the studied narrator (default: the
 * madār), and every other route is bucketed into متابعة تامة / قاصرة / شاهد,
 * with a plain-language verdict. Corpus-wide by design — corroboration weighs
 * all evidence, not the selected books. */
import { api } from "../api.js";
import { esc, fmt, gradeBadge, rankBadge, rankVar } from "../util.js";
import { mountIsnadTree } from "../components/tree.js";
import { termLink } from "../components/glossary.js";
import { getScopeIds } from "../components/scope.js";

const routeList = (arr, empty) => arr.length
  ? `<div class="itibar-list">${arr.map((h) => `
      <a class="edge-item" href="#/hadith/${h.hadithId}">
        <div class="edge-item-head">
          <span class="muted">${esc(h.book ?? "")}${h.noInBook ? ` · ${fmt(h.noInBook)}` : ""}${h.via ? ` — عن طريق ${esc(h.via)}` : ""}${h.note ? ` — ${esc(h.note)}` : ""}</span>
          ${gradeBadge(h.hukm)}
        </div>
        ${h.taraf ? `<div class="edge-item-matn">${esc(h.taraf)}</div>` : ""}
      </a>`).join("")}</div>`
  : `<div class="muted" style="padding:6px 2px">${empty}</div>`;

export async function board({ args: [id], params }) {
  const rawi = Number(params.get("rawi")) || 0;
  const [g, b] = await Promise.all([api.group(id, 0), api.groupBoard(id, rawi)]);
  if (!g || !b?.available)
    return `<div class="empty">لا يمكن فتح لوحة الاعتبار لهذا المعنى (لا أسانيد كافية).</div>`;
  document.title = `لوحة الاعتبار — ${g.nass.slice(0, 30)}… — الجامع`;

  const scopeN = getScopeIds()?.length;
  const scopeNote = scopeN
    ? `يعمل ضمن كتبك المختارة (${fmt(scopeN)} كتاباً) — وسّع النطاق إلى «كل الكتب» لرؤية كل الطرق والمتابعات.`
    : `يشمل كل الكتب.`;

  if (b.empty)
    return `
      <div class="crumbs"><a href="#/group/${id}">معنى ${fmt(g.groupId)}</a> ‹ لوحة الاعتبار</div>
      <div class="card"><div class="nass nass-sm">${esc(g.nass)}</div></div>
      <div class="card" style="margin-top:14px">
        <div class="muted">لا طرق لهذا المعنى ضمن نطاقك المختار من الكتب. ${scopeNote}</div>
      </div>`;

  const subjectChip = (n) => `<a class="chip itibar-rawi ${n.isFocus ? "active" : ""}"
      href="#/board/${id}?rawi=${n.rawiId}"
      style="border-inline-start:4px solid ${rankVar(n.rank ?? "")}">
      ${n.isMadar ? "★ " : ""}${esc(n.name)}${n.isCompanion ? " (صحابي)" : ""}</a>`;

  const vClass = { strong: "v-strong", medium: "v-medium", alone: "v-alone" }[b.verdict.level];

  return `
  <div class="crumbs"><a href="#/group/${id}">معنى ${fmt(g.groupId)}</a> ‹ لوحة الاعتبار</div>

  <div class="card">
    <div class="nass nass-sm">${esc(g.nass)}</div>
    <div class="muted" style="margin-top:8px;font-size:12.5px">
      تنظر اللوحة في ${fmt(b.totalRoutes)} طريقاً — ${scopeNote}
    </div>
  </div>

  <div class="card verdict-card ${vClass}" style="margin-top:14px">
    <div class="spread" style="align-items:flex-start;gap:10px">
      <div>
        <div class="muted" style="font-size:12px;margin-bottom:4px">خلاصة الاعتبار</div>
        <div class="verdict-text">${esc(b.verdict.text)}</div>
      </div>
      <a class="btn" href="#/icma/${id}" style="flex:none">تحليل الإسناد والمتن ←</a>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3 style="margin:0 0 6px">الراوي المدروس</h3>
    <div class="muted" style="font-size:12.5px;margin-bottom:8px">
      اختر مَن تدرس اعتباره من سلسلة المدار (★ = مدار الحديث)، فتُعاد القسمة على أساسه:
    </div>
    <div class="row" style="gap:6px;flex-wrap:wrap">${b.candidates.map(subjectChip).join("")}</div>
    <div class="muted" style="margin-top:10px;font-size:12.5px">
      المدروس: <b>${esc(b.focus.name)}</b> ${rankBadge(b.focus.rank)} ·
      شيخه: <b>${esc(b.shaykh.name)}</b> · الصحابي: <b>${esc(b.companion.name)}</b>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3 style="margin:0 0 6px">شبكة الطرق <span class="tag-count">المدار مكلَّل · لون الخط = أضعف حلقة</span></h3>
    <div id="board-tree" data-group="${id}" data-sahabi="${b.companion.rawiId}">
      <div class="skeleton" style="height:300px"></div>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h3 style="margin:0 0 10px">المتابعات والشواهد</h3>
    <div class="itibar-grid">
      <div class="itibar-col">
        <h4>${termLink("mutabaa", "متابعة تامة")} <span class="tag-count">${fmt(b.counts.tamma)}</span></h4>
        <div class="muted" style="font-size:12px;margin-bottom:6px">شاركه غيرُه في الرواية عن شيخه نفسه.</div>
        ${routeList(b.tamma, "لا متابعة تامة — قد يكون متفرِّداً عن شيخه.")}
      </div>
      <div class="itibar-col">
        <h4>متابعة قاصرة <span class="tag-count">${fmt(b.counts.qasira)}</span></h4>
        <div class="muted" style="font-size:12px;margin-bottom:6px">التقى معه الطريق أعلى من شيخه المباشر.</div>
        ${routeList(b.qasira, "لا متابعة قاصرة.")}
      </div>
      <div class="itibar-col">
        <h4>${termLink("shahid", "شواهد")} <span class="tag-count">${fmt(b.counts.shawahid)}</span></h4>
        <div class="muted" style="font-size:12px;margin-bottom:6px">رواه صحابيٌّ آخر بمعناه.</div>
        ${routeList(b.shawahid, "لا شواهد من صحابةٍ آخرين.")}
      </div>
    </div>
  </div>`;
}

// Mount the merged network after the page renders. Corpus-wide (books:0) so the
// graph matches the (scope-aware) ledger above it.
document.addEventListener("page:rendered", async () => {
  const holder = document.getElementById("board-tree");
  if (!holder || holder.dataset.mounted) return;
  holder.dataset.mounted = "1";
  const gid = holder.dataset.group, sahabi = Number(holder.dataset.sahabi) || undefined;
  try {
    const tree = await api.groupTree(gid, { sahabi });   // respects the active book scope
    if (!holder.isConnected) return;
    if (!tree || tree.chains === 0) { holder.innerHTML = `<div class="empty">لا شبكة لعرضها ضمن النطاق</div>`; return; }
    mountIsnadTree(holder, tree, {
      budget: 60,
      fetchRawi: (rid) => api.rawi(rid),
      onEdge: (from, to) => api.groupEdge(gid, from, to, { sahabi }).then((r) => r.narrations),
    });
  } catch { holder.innerHTML = `<div class="empty">تعذّر رسم الشبكة</div>`; }
});
