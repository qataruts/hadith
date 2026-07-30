/**
 * Regression harness for حارسُ القاعدةِ الذهبيّة (server.mjs → unbackedClaim).
 *
 * The guard is what turns نبراس from "citation-hopeful" into "citation-proved":
 * after the model finishes, every «…» matn quote must appear in the retrieved
 * material verbatim, and every significant number must be traceable to it.
 * Fabricating a matn or a route-count in hadith work is graver than a stylistic
 * slip, so this file must stay green.
 *
 * Usage: node scripts/test-guard.mjs
 * Exit 0 = all pass, 1 = a regression.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "../server/server.mjs"), "utf8");

// Pull the guard out of the server source so the test always exercises the
// SHIPPING implementation (the server opens 4.5 GB of DBs; importing it here
// would be absurd for a pure-function test).
function extract(name, kind) {
  const start = SRC.indexOf(kind === "fn" ? `function ${name}(` : `const ${name} =`);
  if (start < 0) throw new Error(`could not find ${name} in server.mjs`);
  let i = SRC.indexOf(kind === "fn" ? "{" : "=", start);
  if (kind !== "fn") {                        // arrow const: read to the terminating ";\n"
    const end = SRC.indexOf(";\n", i);
    return SRC.slice(start, end + 1);
  }
  let depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const mod = await import("data:text/javascript," + encodeURIComponent(`
${extract("ARABIC_DIGITS", "const")}
${extract("guardNorm", "const")}
${extract("unbackedClaim", "fn")}
export { unbackedClaim, guardNorm };
`));
const { unbackedClaim } = mod;

const MATERIAL = `• «مَنْ بَنَى لِلَّهِ مَسْجِدًا بَنَى اللَّهُ لَهُ بَيْتًا فِي الْجَنَّةِ» [صحيح البخاري ٤٥٠ · صحيح · مرفوع]
• «الملائكة تصلي على أحدكم ما دام في مصلاه الذي صلى فيه» [صحيح البخاري ٤٤٥ · صحيح · مرفوع]
• «من غشنا فليس منا» [صحيح مسلم ١٠١ · صحيح · مرفوع]
ورد المعنى من ٥٩ طريقاً، توزيع درجاتها: صحيح ١٣٦، حسن ٨٣.`;

const CASES = [
  // ── must PASS (null = clean) ──
  ["اقتباسٌ حرفيٌّ كما في المادّة", "قال ﷺ: «مَنْ بَنَى لِلَّهِ مَسْجِدًا بَنَى اللَّهُ لَهُ بَيْتًا فِي الْجَنَّةِ» رواه البخاري.", null],
  ["اقتباسٌ باختصارِ الوسط", "«مَنْ بَنَى لِلَّهِ مَسْجِدًا … بَيْتًا فِي الْجَنَّةِ»", null],
  ["اقتباسٌ بتشكيلٍ مختلف", "«من بنى لله مسجدا بنى الله له بيتا في الجنة»", null],
  ["اقتباسٌ بهمزةٍ وتاءٍ مختلفتين", "«مَنْ بَنَى للّه مَسْجِدًا بَنَى اللّه لَهُ بَيْتاً فِي الْجَنَّةِ»", null],
  ["رقمٌ مسنَدٌ (عددُ الطرق)", "ورد المعنى من ٥٩ طريقاً.", null],
  ["رقمُ كتابٍ مسنَد", "أخرجه البخاري (٤٥٠) ومسلم (١٠١).", null],
  ["توزيعُ درجاتٍ مسنَد", "توزيع الدرجات: صحيح ١٣٦، حسن ٨٣.", null],
  ["جوابٌ بلا اقتباسٍ ولا رقم", "الحكمُ المسجَّلُ صحيحٌ، والمدارُ غيرُ متفرِّد، وهذه قراءةٌ من الموسوعة لا فتوى.", null],
  ["اقتباسٌ قصيرٌ (تحت الحدّ)", "«من غشنا»", null],

  // ── must TRIP (a violation sentence) ──
  ["متنٌ مختلقٌ بالكامل", "وجاء أيضاً: «من بنى مسجداً في الأرض بنى الله له سبعين قصراً في الفردوس الأعلى»", "quote"],
  ["اختصارٌ أحدُ شقَّيه مختلق", "«مَنْ بَنَى لِلَّهِ مَسْجِدًا … سبعين قصرا في الفردوس الأعلى»", "quote"],
  ["زيادةٌ مدسوسةٌ في متنٍ صحيح", "«مَنْ بَنَى لِلَّهِ مَسْجِدًا صغيرا أو كبيرا بَنَى اللَّهُ لَهُ سبعين بَيْتًا فِي الْجَنَّةِ»", "quote"],
  ["عددُ طرقٍ مختلق", "ورد المعنى من ٣٤٧ طريقاً في الكتب التسعة.", "number"],
  ["إحصاءٌ مختلق", "وقد رواه ١٢٥٠ راوياً عن الصحابة.", "number"],
];

let pass = 0, fail = 0;
for (const [name, text, expect] of CASES) {
  const got = unbackedClaim(text, MATERIAL);
  const ok = expect === null
    ? got === null
    : got !== null && (expect === "quote" ? got.includes("اقتبستَ") : got.includes("رقمًا"));
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}\n      expected=${expect ?? "clean"}  got=${got ?? "clean"}`); }
}

// the guard must never fire when there is no material to check against
if (unbackedClaim("«أيُّ متنٍ كان» و٩٩٩٩", "") !== null) {
  fail++; console.log("  ✘ بلا مادّةٍ: يجبُ ألّا يعملَ الحارس");
} else { pass++; console.log("  ✔ بلا مادّةٍ: الحارسُ ساكن"); }

console.log(`\n${pass} ناجح · ${fail} فاشل`);
process.exit(fail ? 1 : 0);
