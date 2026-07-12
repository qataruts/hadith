/** Shared helpers: escaping, formatting, grade/rank classification. */

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmt = (n) => Number(n ?? 0).toLocaleString("ar-EG");

/** hukm text → badge class (text is ALWAYS shown alongside — never color alone) */
export function gradeClass(hukm = "") {
  if (/صحيح/.test(hukm)) return "grade-sahih";
  if (/حسن/.test(hukm)) return "grade-hasan";
  if (/موضوع|شديد الضعف|منكر/.test(hukm)) return "grade-mawdu";
  if (/ضعيف|لين/.test(hukm)) return "grade-daif";
  return "";
}

/**
 * Single source of truth for narrator reliability. Tiers are ordered
 * strictly worst-first after the sahabi exception, so a hedged rank like
 * "ثقة صدوق" resolves to the more cautious صدوق, and the badge class and the
 * isnad color can never disagree.
 */
const RANK_TIERS = [
  { key: "sahabi", sev: 0, re: /صحابي/ },
  { key: "matruk", sev: 5, re: /متروك|كذاب|وضاع|يضع|متهم|دجال/ },
  { key: "daif",   sev: 4, re: /ضعيف|منكر|واه|ساقط/ },
  { key: "majhul", sev: 3, re: /مجهول|مستور|مقبول|لين|لا يعرف/ },
  { key: "saduq",  sev: 2, re: /صدوق|لا بأس|حسن/ },
  { key: "thiqa",  sev: 1, re: /ثقة|حافظ|إمام|حجة|متقن|ثبت|جبل/ },
];
export function rankSev(rank = "") {
  for (const t of RANK_TIERS) if (t.re.test(rank)) return { sev: t.sev, cls: `rk-${t.key}` };
  return { sev: 3, cls: "rk-unknown" };   // ungraded → treated as caution
}
export const rankVar = (rank) => `var(--${rankSev(rank).cls})`;
/** rawi rank text → badge class, derived from the same tiers. */
export function rankClass(rank = "") {
  const { cls } = rankSev(rank);
  return cls === "rk-unknown" ? "" : `rank-${cls.slice(3)}`;
}

export const gradeBadge = (hukm) =>
  hukm ? `<span class="badge ${gradeClass(hukm)}" title="الحكم كما ورد في قاعدة البيانات المصدرية — راجع حكم كل إسناد في صفحة الحديث">${esc(hukm)}</span>` : "";

/** Edge color = the WEAKER of its two endpoints (a chain is as strong as its weakest link). */
export function edgeVar(rankA, rankB) {
  const a = rankSev(rankA), b = rankSev(rankB);
  return `var(--${(a.sev >= b.sev ? a : b).cls})`;
}

/** Color legend for the isnad graph (shown once above it). Labels are
 *  glossary terms (data-term) so a beginner can tap any rank for a definition. */
export function isnadLegend() {
  const items = [
    ["rk-sahabi", "صحابي", "sahabi"], ["rk-thiqa", "ثقة", "thiqa"],
    ["rk-saduq", "صدوق", "saduq"], ["rk-majhul", "مجهول/مقبول", "majhul"],
    ["rk-daif", "ضعيف", "daif"], ["rk-matruk", "متروك", "matruk"],
    ["rk-unknown", "غير محدد", null],
  ];
  return `<div class="isnad-legend">${items
    .map(([c, l, term]) => `<span class="lg"><i style="background:var(--${c})"></i>${
      term ? `<span class="term" data-term="${term}" tabindex="0" role="button">${l}</span>` : l}</span>`)
    .join("")}<span class="lg"><i style="background:transparent;border:1.5px dashed var(--critical)"></i><span class="term" data-term="inqita" tabindex="0" role="button">انقطاع</span></span>` +
    `<span class="lg muted">لون الخط = أضعف راوٍ فيه · سماكته = عدد الطرق</span></div>`;
}

export const rankBadge = (rank) =>
  rank ? `<span class="badge ${rankClass(rank)}">${esc(rank)}</span>` : "";

/** Chain pseudo-narrator markers (source data uses these as flags, not people). */
export const isBreakMarker = (name = "") =>
  /موضع (انقطاع|إرسال|تعليق|إعضال)|مبهم|غير معرف/.test(name);

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** Tiny hijri-year formatter for death years. */
export const hijri = (y, raw) => (y ? `${fmt(y)}هـ` : raw ? `${esc(raw)}هـ` : "");

/** Friendly Arabic message for missing-Gemini-key errors (semantic/chat). */
export function keyErrorHtml(err = "") {
  if (!/GEMINI|gemini|embed|400/.test(String(err))) return null;
  return `البحث الدلالي والمحادثة يحتاجان مفتاح Gemini مجانياً.<br/>
    <span class="muted">في تطبيق سطح المكتب: قائمة «ملف ← الإعدادات» وألصق المفتاح.
    على الخادم: ضع GEMINI_API_KEY في ملف .env.
    احصل على مفتاح من aistudio.google.com/apikey — بقية التطبيق يعمل بدونه.</span>`;
}

/** Strip tashkeel for display toggling (view-only). */
export const stripTashkeel = (s) => s.replace(/[ً-ْٰۖ-ۭؐ-ؚ]/g, "");
