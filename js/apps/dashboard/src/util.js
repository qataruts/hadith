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

/** rawi rank text → badge class */
export function rankClass(rank = "") {
  if (/صحابي/.test(rank)) return "rank-sahabi";
  if (/متروك|كذاب|وضاع|يضع/.test(rank)) return "rank-matruk";
  if (/ضعيف|لين|منكر/.test(rank)) return "rank-daif";
  if (/ثقة|حافظ|إمام|حجة/.test(rank)) return "rank-thiqa";
  if (/مجهول|مقبول|مستور/.test(rank)) return "rank-majhul";
  if (/صدوق|حسن/.test(rank)) return "rank-saduq";
  return "";
}

export const gradeBadge = (hukm) =>
  hukm ? `<span class="badge ${gradeClass(hukm)}">${esc(hukm)}</span>` : "";

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
