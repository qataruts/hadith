/**
 * مقارنة الألفاظ — word-level diff of a meaning's narration wordings against a
 * chosen base. Additions (زيادات) in a variant glow; words missing from it are
 * shown struck in the base row. Tashkeel is ignored when matching, kept when
 * displayed. Pure client (LCS over words); base is switchable.
 */
import { esc, fmt, gradeBadge } from "../util.js";
import { stripTashkeel } from "../util.js";

const norm = (w) => stripTashkeel(w).replace(/[^؀-ۿ]/g, "");
export const words = (s) => s.trim().split(/\s+/).filter(Boolean);

/** LCS over normalized words → ops: {type:'same'|'add'|'del', w} against base. */
export function diff(baseW, varW) {
  const a = baseW.map(norm), b = varW.map(norm);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: "same", w: varW[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: "del", w: baseW[i] }); i++; }
    else { ops.push({ t: "add", w: varW[j] }); j++; }
  }
  while (i < n) ops.push({ t: "del", w: baseW[i++] });
  while (j < m) ops.push({ t: "add", w: varW[j++] });
  return ops;
}

export const renderOps = (ops) => ops.map((o) =>
  o.t === "same" ? esc(o.w)
  : o.t === "add" ? `<span class="d-add">${esc(o.w)}</span>`
  : `<span class="d-del">${esc(o.w)}</span>`).join(" ");

export function renderMatnDiff(data, baseIdx = 0) {
  const V = data.variants;
  if (!V || V.length < 2)
    return `<div class="muted" style="padding:8px">لا تتوفّر ألفاظ كافية للمقارنة.</div>`;
  const base = V[baseIdx];
  const baseW = words(base.matn);

  const opts = V.map((v, i) =>
    `<option value="${i}" ${i === baseIdx ? "selected" : ""}>${esc(v.book)}${v.noInBook ? " · " + fmt(v.noInBook) : ""}</option>`).join("");

  const rows = V.map((v, i) => {
    if (i === baseIdx)
      return `<div class="d-row d-base">
        <div class="d-head"><span class="badge">الأصل</span> <a href="#/hadith/${v.hadithId}">${esc(v.book)}${v.noInBook ? " · " + fmt(v.noInBook) : ""}</a> ${gradeBadge(v.hukm)}</div>
        <div class="d-matn nass nass-sm">${esc(v.matn)}</div>
      </div>`;
    const ops = diff(baseW, words(v.matn));
    const adds = ops.filter((o) => o.t === "add").length, dels = ops.filter((o) => o.t === "del").length;
    return `<div class="d-row">
      <div class="d-head">
        <a href="#/hadith/${v.hadithId}">${esc(v.book)}${v.noInBook ? " · " + fmt(v.noInBook) : ""}</a> ${gradeBadge(v.hukm)}
        <span class="tag-count">${adds ? `+${fmt(adds)} زيادة` : ""}${adds && dels ? " · " : ""}${dels ? `−${fmt(dels)} نقص` : ""}${!adds && !dels ? "مطابق" : ""}</span>
      </div>
      <div class="d-matn nass nass-sm">${renderOps(ops)}</div>
    </div>`;
  }).join("");

  return `
    <div class="row" style="gap:8px;margin-bottom:6px">
      <span class="muted">قارن على أساس:</span>
      <select id="diff-base" style="padding:6px 10px;border:1px solid var(--hairline);border-radius:8px;background:var(--surface);color:var(--ink);font-family:inherit">${opts}</select>
      <span class="muted" style="font-size:12px">الزيادات <span class="d-add">مُظلَّلة أخضر</span> والنقص <span class="d-del">مشطوب أحمر</span></span>
    </div>
    <div class="d-list">${rows}</div>
    ${data.total > V.length ? `<div class="muted" style="margin-top:6px">عُرِض ${fmt(V.length)} من ${fmt(data.total)} لفظاً متمايزاً.</div>` : ""}`;
}
