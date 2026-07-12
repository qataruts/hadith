/** تحليل الإسناد والمتن (ICMA) — correlate wording with the isnad. For each
 * distinct matn carried by ≥2 routes, the engine finds the deepest narrator
 * common to all of them (where the wording was fixed) and how "pure" that
 * wording is to his routes. Descriptive aid only — it never overrides the
 * recorded grade; low purity = a shared ancestor, not necessarily the origin. */
import { api } from "../api.js";
import { esc, fmt, rankBadge } from "../util.js";
import { diff, words, renderOps } from "../components/matndiff.js";

const eraTag = { companion: "عند الصحابي", early: "طبقة مبكّرة", late: "طبقة متأخّرة" };

function attribution(f) {
  const who = f.atCompanion
    ? `الصحابيّ <b>${esc(f.narrator.name)}</b>`
    : `<a href="#/rawi/${f.narrator.rawiId}">${esc(f.narrator.name)}</a>`;
  const late = f.era === "late";
  if (f.purity >= 65)
    return late
      ? `هذا لفظُ طريق ${who} المتأخّر، تفرّدت به عمّا سواها — تنوّعٌ في التدوين لا في أصل الرواية.`
      : `تنفرد بهذا اللفظ طرقٌ يجمعها ${who} — والغالب أنه ثبت عنده ثم تفرّع عنه.`;
  if (f.purity >= 40)
    return `يتردّد هذا اللفظ في طرقٍ يلتقي أكثرها عند ${who} مع طرقٍ أخرى تخالفه — فنسبته إليه محتملة لا قاطعة.`;
  return `لفظٌ متفرّق لا يتركّز عند راوٍ بعينه؛ أقرب سلفٍ مشترك لطرقه ${who}، لكنّ أكثر مَن دونه رواه بغير هذا اللفظ.`;
}

export async function icma({ args: [id] }) {
  const [g, d] = await Promise.all([api.group(id, 0), api.groupIcma(id)]);
  if (!g || !d?.available)
    return `<div class="empty">لا يمكن إجراء التحليل لهذا المعنى (لا ألفاظ كافية).</div>`;
  document.title = `تحليل الإسناد والمتن — ${g.nass.slice(0, 28)}… — الجامع`;

  const head = `
    <div class="crumbs"><a href="#/group/${id}">معنى ${fmt(g.groupId)}</a> ‹ تحليل الإسناد والمتن</div>
    <div class="card"><div class="nass nass-sm">${esc(g.nass)}</div></div>
    <div class="card muted" style="margin-top:14px;line-height:1.9">
      <strong style="color:var(--ink-2)">ما هذا التحليل؟</strong> نقارن ألفاظ المتن عبر الطرق، ثم نردّ كل لفظٍ
      إلى أعمق راوٍ تشترك فيه كل طرقه — أي الموضع الذي ثبت عنده اللفظ وتفرّع عمّا دونه. «نقاء اللفظ» =
      نسبة طرق ذلك الراوي التي تحمل هذا اللفظ؛ فكلّما ارتفع قوِيَت النسبة إليه.
      <br/><span style="color:var(--gold)">تنبيه:</span> هذا وصفٌ لمواضع اختلاف اللفظ يعين على تحليل الإسناد والمتن،
      ولا يُغيّر حكم الحديث المثبت، ولا يعني ضعفاً؛ واللفظ الأصلي قد يعتريه شيءٌ من تعليقات النسّاخ.
    </div>`;

  if (d.uniform)
    return head + `
      <div class="card" style="margin-top:14px">
        <div class="verdict-text" style="font-family:var(--font-head);font-size:20px;font-weight:700">
          متن الحديث ثابتٌ لا يكاد يختلف بين طرقه.
        </div>
        <div class="muted" style="margin-top:6px">${fmt(d.totalRoutes ?? 0)} طريقاً بلفظٍ واحدٍ متقارب — لا زيادات مؤثِّرة تُنسب إلى راوٍ بعينه.</div>
        ${d.base?.matn ? `<div class="nass nass-sm" style="margin-top:12px">${esc(d.base.matn)}</div>` : ""}
      </div>`;

  const baseW = words(d.base.matn);

  const cards = d.findings.map((f) => {
    const ops = diff(baseW, words(f.matn));
    const adds = ops.filter((o) => o.t === "add").length, dels = ops.filter((o) => o.t === "del").length;
    const pClass = f.purity >= 65 ? "p-strong" : f.purity >= 40 ? "p-mid" : "p-weak";
    return `
      <div class="card icma-find">
        <div class="spread" style="align-items:flex-start;gap:10px">
          <div class="icma-attr">${attribution(f)}</div>
          <span class="badge icma-era">${eraTag[f.era] ?? ""}</span>
        </div>
        <div class="d-matn nass nass-sm" style="margin:10px 0">${renderOps(ops)}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
          <span class="tag-count">${fmt(f.routes)} طريقاً${adds ? ` · +${fmt(adds)} زيادة` : ""}${dels ? ` · −${fmt(dels)} نقص` : ""}</span>
          <span class="icma-purity ${pClass}" title="نسبة طرق ${esc(f.narrator.name)} التي تحمل هذا اللفظ">
            <span class="icma-bar"><span style="width:${f.purity}%"></span></span> نقاء اللفظ ${f.purity}%
          </span>
          ${f.narrator.tabaka ? `<span class="muted" style="font-size:12px">ط${f.narrator.tabaka}</span>` : ""}
        </div>
        <div class="muted" style="font-size:12.5px;margin-top:8px">
          في: ${f.books.map((b) => esc(b)).join(" · ")}
          · <a href="#/hadith/${f.sample}">افتح طريقاً ←</a>
        </div>
      </div>`;
  }).join("");

  return head + `
    <div class="card" style="margin-top:14px;border-inline-start:5px solid var(--accent)">
      <div class="muted" style="font-size:12px;margin-bottom:4px">اللفظ الأكثر طرقاً (الأصل في المقارنة)</div>
      <div class="nass nass-sm">${esc(d.base.matn)}</div>
      <div class="muted" style="margin-top:6px;font-size:12.5px">
        ${fmt(d.base.routes)} طريقاً بهذا اللفظ · ${fmt(d.distinctWordings)} لفظاً متمايزاً في ${fmt(d.totalRoutes)} طريقاً.
        الزيادات <span class="d-add">مظلَّلة</span> والنقص <span class="d-del">مشطوب</span>.
      </div>
    </div>
    <h3 style="margin:18px 0 10px">مواضع اختلاف اللفظ ومظانّها من الإسناد</h3>
    ${cards || `<div class="muted">لا زيادات مؤثِّرة تُنسب إلى راوٍ بعينه.</div>`}`;
}
