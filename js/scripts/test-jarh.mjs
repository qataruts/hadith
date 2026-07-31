/**
 * Regression harness for the jarh/ta'dil lexicon (shared/jarh-lexicon.mjs).
 * The science is delicate — a term typed with ة/ى or a phrase-order slip silently
 * mis-grades a narrator — so these known cases must stay green.
 * Usage: node scripts/test-jarh.mjs   (exit 0 = pass, 1 = regression)
 */
import { classifyQawl, aggregateRawi } from "../shared/jarh-lexicon.mjs";

const CASES = [
  // تعديل
  ["ثقة", "tadil"], ["ثقة ثبت", "tadil"], ["صدوق", "tadil"], ["لا بأس به", "tadil"],
  ["وثقه ابن معين", "tadil"], ["ذكره في الثقات وقال كان عابدًا", "tadil"], ["مقبول", "tadil"],
  // جرح (incl. the ة-normalization + verb forms that were bugs)
  ["ضعيف", "jarh"], ["ضعفه أبو حاتم", "jarh"], ["تركه النسائي", "jarh"], ["متروك الحديث", "jarh"],
  ["ليس بثقة", "jarh"], ["ليس بحجة", "jarh"], ["كذبه يحيى", "jarh"], ["منكر الحديث", "jarh"],
  ["فيه ضعف", "jarh"], ["سيّئ الحفظ", "jarh"], ["في الضعفاء والمتروكين", "jarh"],
  // جهالة
  ["مجهول", "jahala"], ["لا يعرف حاله", "jahala"], ["مستور", "jahala"],
  // NON-verdict → none (must NOT be misgraded)
  ["ذكره في تاريخ بغداد", "none"], ["روى عن سليمان وروى عنه محمد", "none"],
  ["له صحبة", "none"], ["مختلف في صحبته", "none"], ["قليل الحديث", "none"],
  // phrase-order traps: «ليس به بأس» (تعديل) must NOT read as «ليس بشيء» (جرح)
  ["ليس به بأس", "tadil"],
];

let pass = 0, fail = 0;
for (const [qawl, want] of CASES) {
  const got = classifyQawl(qawl).cls;
  if (got === want) { pass++; }
  else { fail++; console.log(`  ✘ «${qawl}»  expected=${want} got=${got}`); }
}
console.log(`تصنيفُ الأقوال: ${pass}/${CASES.length}`);

// aggregation: عكرمة / سماك must read مختلف فيه; a pure-thiqa run must not.
const AGG = [
  ["مختلف فيه (توثيق غالب + جرح معتبر)", ["ثقة", "ثقة", "ثقة", "صدوق", "لا بأس به", "لا بأس به", "ذكره في الضعفاء", "ضعفه فلان"], true],
  ["مجمَعٌ على توثيقه (لا اختلاف)", ["ثقة", "ثقة ثبت", "ثقة", "حجة", "إمام"], false],
  ["stray lone jarh (لا يكفي للاختلاف)", ["ثقة", "ثقة", "ثقة", "ثقة", "ثقة", "فيه لين"], false],
];
let ap = 0, af = 0;
for (const [name, qs, wantMukh] of AGG) {
  const got = aggregateRawi(qs).mukhtalaf;
  if (got === wantMukh) ap++;
  else { af++; console.log(`  ✘ ${name}: مختلف فيه expected=${wantMukh} got=${got}`); }
}
console.log(`تجميعُ الرواة: ${ap}/${AGG.length}`);

const total = fail + af;
console.log(total ? `\n✘ ${total} فاشل` : "\n✔ الكلُّ ناجح");
process.exit(total ? 1 : 0);
