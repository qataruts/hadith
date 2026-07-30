/**
 * Variant-matn semantic tier (الطبقة الثالثة) — embed every DISTINCT marfūʿ/qudsī
 * matn whose content meaningfully diverges from its group's canonical طرف, with
 * gemini-embedding-001 (same model + vector space as the group and āthār tiers,
 * so ONE query embedding ranks all three).
 *
 * Why: the group tier embeds meaning_groups.nass — the طرف (opening ~110 chars).
 * Full matns average ~285 chars, and a measured 73% of distinct matns have ≥50%
 * of their words absent from their طرف (stories, ziyādāt, rulings) — invisible
 * to meaning-search today. This tier closes that gap for search AND نبراس.
 *
 * Selection (measured on a 400-group sample, findings/TAHQIQ-DIRECTION.md):
 *   - dedupe across the whole corpus by NORMALIZED matn (strip diacritics,
 *     unify hamza/tāʾ marbūṭa/yāʾ) — identical wording in 6 books = 1 vector
 *   - skip matns with <25% novel tokens vs their group's طرف (the group vector
 *     already represents them; embedding them would only add near-dup noise)
 *   - skip tiny matns (<40 chars normalized) — fragments the طرف covers
 *
 * Vectors int8-quantized (unit-norm ×127). Writes to a SEPARATE db
 * (matn-embedding.db) so this multi-hour writer never contends with the live
 * hadith-kg.db the server reads. Resumable — safe to re-run.
 *
 * Usage: GEMINI_API_KEY=... node scripts/embed-matns.mjs [--limit N]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const HOME = process.env.HOME;
const KG = opt("kg", path.join(HOME, ".hadith-kg/hadith-kg.db"));
const OUT = opt("out", path.join(HOME, ".hadith-kg/matn-embedding.db"));
const LIMIT = Number(opt("limit", "0")) || 0;
const MODEL = "gemini-embedding-001", DIM = 768, BATCH = 100;
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY not set"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Arabic normalize for dedup/novelty: strip tashkīl + tatweel, unify letters. */
const norm = (s) => (s ?? "")
  .replace(/[ً-ْٰـ]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/[^؀-ۿ ]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter((w) => w.length > 2);

const kg = new DatabaseSync(KG, { readOnly: true });
const out = new DatabaseSync(OUT);
out.exec("PRAGMA journal_mode=WAL");
out.exec(`CREATE TABLE IF NOT EXISTS matn_embedding (
  hid INTEGER PRIMARY KEY,   -- representative hadith id of the dup-set
  group_id INTEGER NOT NULL, -- its طرف, for fold-under-taraf display
  vec BLOB NOT NULL)`);

// ---- selection pass (in-memory: ~405K rows) --------------------------------
console.log("selecting distinct novel matns…");
const t0 = Date.now();
const tarafToks = new Map(); // group_id → Set(tokens of طرف)
for (const r of kg.prepare("SELECT id, nass FROM meaning_groups WHERE id > 0").all())
  tarafToks.set(r.id, new Set(tokens(r.nass)));

const rows = kg.prepare(
  `SELECT id, group_id, substr(nass, matn_start + 1) AS matn FROM hadiths
   WHERE type_no NOT IN (2,3) AND group_id IS NOT NULL AND matn_start IS NOT NULL
   ORDER BY id`).all();

const seen = new Map(); // normalized matn → rep hid
let skippedTiny = 0, skippedNear = 0, dups = 0;
const selected = [];
for (const r of rows) {
  const nm = norm(r.matn);
  if (nm.length < 40) { skippedTiny++; continue; }
  if (seen.has(nm)) { dups++; continue; }
  seen.set(nm, r.id);
  const T = tarafToks.get(r.group_id);
  const M = tokens(r.matn);
  if (T && M.length) {
    const inT = M.reduce((a, w) => a + (T.has(w) ? 1 : 0), 0);
    if (1 - inT / M.length < 0.25) { skippedNear++; continue; } // طرف covers it
  }
  selected.push({ hid: r.id, group_id: r.group_id, text: r.matn.slice(0, 1500) });
}
console.log(
  `${rows.length} grouped marfūʿ/qudsī matns → ${selected.length} to embed ` +
  `(${dups} exact dups, ${skippedNear} taraf-covered, ${skippedTiny} tiny) ` +
  `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const done = new Set(out.prepare("SELECT hid FROM matn_embedding").all().map((r) => r.hid));
let todo = selected.filter((r) => !done.has(r.hid));
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`${done.size} already embedded · ${todo.length} to do${LIMIT ? " (limited)" : ""}`);

// ---- embed pass (identical mechanics to embed-athar.mjs) -------------------
const insert = out.prepare("INSERT OR REPLACE INTO matn_embedding VALUES (?,?,?)");
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${KEY}`;
const toInt8 = (values) => {
  let n = 0; for (const v of values) n += v * v;
  n = Math.sqrt(n) || 1;
  const a = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) a[i] = Math.max(-127, Math.min(127, Math.round((values[i] / n) * 127)));
  return a;
};

const t1 = Date.now();
let embedded = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const body = { requests: batch.map((r) => ({
    model: `models/${MODEL}`, content: { parts: [{ text: r.text }] },
    taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: DIM })) };
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { if (attempt <= 10) { await sleep(Math.min(60000, attempt * 6000)); continue; } throw e; }
    if (res.ok) break;
    if ((res.status === 429 || res.status >= 500) && attempt <= 10) {
      const w = Math.min(90000, attempt * 8000);
      console.log(`  HTTP ${res.status} — waiting ${w / 1000}s (attempt ${attempt})`);
      await sleep(w); continue;
    }
    console.error(`request failed HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const { embeddings } = await res.json();
  if (!embeddings || embeddings.length !== batch.length) {
    console.error(`batch size mismatch: got ${embeddings?.length} for ${batch.length}`); process.exit(1);
  }
  out.exec("BEGIN");
  for (let j = 0; j < batch.length; j++)
    insert.run(batch[j].hid, batch[j].group_id, Buffer.from(toInt8(embeddings[j].values).buffer));
  out.exec("COMMIT");
  embedded += batch.length;
  if (i % 2000 === 0 || i + BATCH >= todo.length) {
    const rate = embedded / ((Date.now() - t1) / 1000);
    const eta = rate ? Math.round((todo.length - embedded) / rate / 60) : 0;
    console.log(`  ${embedded}/${todo.length}  (${rate.toFixed(0)}/s · ~${eta}m left)`);
  }
  await sleep(150);   // gentle pacing
}
const total = out.prepare("SELECT COUNT(*) n FROM matn_embedding").get().n;
console.log(`done — ${total} matn embeddings stored in ${OUT}`);
out.close();
