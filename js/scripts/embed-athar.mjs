/**
 * Āthār semantic tier — embed every DISTINCT موقوف/مقطوع taraf (~292K) with
 * gemini-embedding-001 (the same model + vector space as the marfū' group
 * embeddings, so one query searches both tiers). Vectors are int8-quantized
 * (unit-normalized → ×127) so the store is ~224 MB instead of ~900 MB.
 *
 * Writes to a SEPARATE db (athar-embedding.db) so this multi-hour writer never
 * contends with the live hadith-kg.db the server reads. Resumable — safe to
 * re-run; picks up where it stopped.
 *
 * Usage: GEMINI_API_KEY=... node scripts/embed-athar.mjs [--limit N]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const HOME = process.env.HOME;
const KG = opt("kg", path.join(HOME, ".hadith-kg/hadith-kg.db"));
const OUT = opt("out", path.join(HOME, ".hadith-kg/athar-embedding.db"));
const LIMIT = Number(opt("limit", "0")) || 0;
const MODEL = "gemini-embedding-001", DIM = 768, BATCH = 100;
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY not set"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kg = new DatabaseSync(KG, { readOnly: true });
const out = new DatabaseSync(OUT);
out.exec("PRAGMA journal_mode=WAL");
out.exec("CREATE TABLE IF NOT EXISTS athar_embedding (hid INTEGER PRIMARY KEY, vec BLOB NOT NULL)");

const src = kg.prepare(
  `SELECT MIN(id) hid, taraf_nass taraf FROM hadiths
   WHERE type_no IN (2,3) AND taraf_nass IS NOT NULL AND LENGTH(taraf_nass) >= 12
   GROUP BY taraf_nass ORDER BY hid`).all();
const done = new Set(out.prepare("SELECT hid FROM athar_embedding").all().map((r) => r.hid));
let todo = src.filter((r) => !done.has(r.hid));
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`${src.length} distinct athar taraf · ${done.size} already embedded · ${todo.length} to do${LIMIT ? " (limited)" : ""}`);

const insert = out.prepare("INSERT OR REPLACE INTO athar_embedding VALUES (?,?)");
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${KEY}`;
const toInt8 = (values) => {
  let n = 0; for (const v of values) n += v * v;
  n = Math.sqrt(n) || 1;
  const a = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) a[i] = Math.max(-127, Math.min(127, Math.round((values[i] / n) * 127)));
  return a;
};

const t0 = Date.now();
let embedded = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const body = { requests: batch.map((r) => ({
    model: `models/${MODEL}`, content: { parts: [{ text: r.taraf }] },
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
    insert.run(batch[j].hid, Buffer.from(toInt8(embeddings[j].values).buffer));
  out.exec("COMMIT");
  embedded += batch.length;
  if (i % 2000 === 0 || i + BATCH >= todo.length) {
    const rate = embedded / ((Date.now() - t0) / 1000);
    const eta = rate ? Math.round((todo.length - embedded) / rate / 60) : 0;
    console.log(`  ${embedded}/${todo.length}  (${rate.toFixed(0)}/s · ~${eta}m left)`);
  }
  await sleep(150);   // gentle pacing
}
const total = out.prepare("SELECT COUNT(*) n FROM athar_embedding").get().n;
console.log(`done — ${total} athar embeddings stored in ${OUT}`);
out.close();
