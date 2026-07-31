/**
 * معجمُ ألفاظ الجرح والتعديل — a rule-based classifier for a critic's qawl.
 * Returns { cls, score, term } where cls ∈ tadil | jarh | jahala | none and
 * score is a signed strength (+ = تعديل, − = جرح, 0 = جهالة/غير حكم).
 *
 * The science is delicate, so: (1) multi-word phrases match before single words
 * (so «ليس به بأس» ≠ «ليس بشيء»); (2) strongest magnitude wins; (3) pure
 * biography («ذكره في تاريخ بغداد», «روى عنه فلان») → none, but book-verdicts
 * («ذكره في الثقات/الضعفاء») are classified.
 *
 * BOTH the qawl AND every lexicon term are run through the SAME normalization
 * (strip tashkīl, unify hamza/ة→ه/ى→ي, drop non-Arabic, space-bound) — because
 * \b is ASCII-only in JS and, more subtly, a term typed «ليس بحجة» would never
 * match a haystack where ة already became ه.
 */
const N = (s) => (s ?? "")
  .replace(/[ً-ْٰـ]/g, "").replace(/[أإآ]/g, "ا").replace(/[ؤئء]/g, "").replace(/ى/g, "ي").replace(/ة/g, "ه");
export const jNorm = (s) => " " + N(s).replace(/[^؀-ۿ]/g, " ").replace(/\s+/g, " ").trim() + " ";

// Tiers scanned by |score| desc; phrase-specificity handled by listing longer
// «ليس ب…» variants in their correct tier. Written naturally — normalized below.
const RAW_RULES = [
  [-4, [" وضاع ", " يضع الحديث ", " وضع الحديث ", " كذاب ", " يكذب ", " كذبه ", " دجال ", " متهم بالكذب ", " متهم بالوضع ", " ممن يضع "]],
  [-3, [" متروك ", " متروك الحديث ", " تركه ", " تركوه ", " ذاهب الحديث ", " ذاهب ", " ليس بشيء ", " هالك ", " ساقط ", " لا يكتب حديثه ", " لا تحل الرواية عنه "]],
  [-2.5, [" منكر الحديث ", " واه ", " واهي ", " ليس بثقة ", " غير ثقة ", " لا يحتج به ", " سكتوا عنه ", " ضعيف جدا ", " ضعفه جدا "]],
  [-2, [" ضعيف ", " ضعفه ", " ضعفوه ", " مضطرب الحديث ", " ليس بالقوي ", " ليس بذاك ", " ليس بحجة ", " فيه نظر ", " في الضعفاء ", " في المجروحين "]],
  [-1, [" فيه ضعف ", " فيه لين ", " لين الحديث ", " لين ", " سيء الحفظ ", " في حديثه شيء ", " فيه مقال ", " تكلم فيه ", " فيه كلام ", " يخطئ ", " يهم ", " له مناكير ", " في الكامل ", " ليس بالمتقن "]],
  [0, [" مجهول ", " لا يعرف ", " لا يعرف حاله ", " مستور ", " مجهول الحال ", " مجهول العين ", " لم اعرفه ", " لا يدري من هو "], "jahala"],
  [3, [" ثقة ثبت ", " ثقة حافظ ", " ثقة ثقة ", " ثقة متقن ", " إمام ", " حجة ", " أحد الأعلام ", " ثبت حافظ "]],
  [2, [" ثقة ", " وثقه ", " ثبت ", " متقن ", " في الثقات ", " ذكره في الثقات "]],
  [1.5, [" صدوق ", " صالح الحديث "]],
  [1, [" لا بأس به ", " ليس به بأس ", " صالح ", " شيخ ", " مقبول ", " يعتبر به ", " صويلح ", " وسط ", " حسن الحديث "]],
];
// normalize every term so it matches the normalized haystack
const RULES = RAW_RULES.map(([score, terms, cls]) => [score, terms.map(N), cls]);

/** Classify one qawl → { cls, score, term }. */
export function classifyQawl(qawl) {
  const t = jNorm(qawl);
  if (t.length < 4) return { cls: "none", score: 0, term: null };
  let best = null;
  for (const [score, terms, forceCls] of RULES) {
    for (const term of terms) {
      if (t.includes(term) && (!best || Math.abs(score) > Math.abs(best.score))) {
        best = { score, term: term.trim(),
          cls: forceCls ?? (score > 0 ? "tadil" : score < 0 ? "jarh" : "jahala") };
      }
    }
  }
  return best ?? { cls: "none", score: 0, term: null };
}

/** Aggregate a rawi's aqwal → leaning + مختلف فيه detection. */
export function aggregateRawi(qawls) {
  let tadil = 0, jarh = 0, jahala = 0, sumT = 0, sumJ = 0;
  for (const q of qawls) {
    const c = classifyQawl(q);
    if (c.cls === "tadil") { tadil++; sumT += c.score; }
    else if (c.cls === "jarh") { jarh++; sumJ += -c.score; }
    else if (c.cls === "jahala") jahala++;
  }
  const verdicts = tadil + jarh;
  const minor = Math.min(tadil, jarh);
  // مختلف فيه: real weight on BOTH sides — at least two dissenting verdicts and
  // ≥15% of the classified verdicts (so a lone stray word doesn't trigger it).
  const mukhtalaf = minor >= 2 && minor / verdicts >= 0.15;
  const lean = verdicts === 0 ? (jahala ? "jahala" : "none")
    : sumT >= sumJ * 1.5 ? "tadil" : sumJ >= sumT * 1.5 ? "jarh" : "mixed";
  return { tadil, jarh, jahala, mukhtalaf, lean, verdicts };
}
