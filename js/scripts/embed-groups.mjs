/**
 * Semantic layer: embed every meaning group (the "one meaning of a hadith"
 * unit — 20,745 texts) with the Gemini embedding API and store vectors in
 * hadith-kg.db (table group_embedding). The API server loads them into RAM
 * for brute-force cosine search (~64 MB, ~ms per query).
 *
 * Embedding GROUPS instead of 715K narrations: retrieval happens at the
 * meaning level (dedup for free), then expands to narrations relationally.
 * Same model family as the Quran project so tests are apples-to-apples.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/embed-groups.mjs [--db path] [--model gemini-embedding-001] [--dim 768]
 * Resumes automatically; safe to re-run.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const DB = opt("db", path.resolve(HERE, "../../hadith-kg.db"));
const MODEL = opt("model", "gemini-embedding-001");
const DIM = Number(opt("dim", "768"));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec(`
  CREATE TABLE IF NOT EXISTS group_embedding (
    group_id INTEGER NOT NULL,
    model    TEXT NOT NULL,
    dim      INTEGER NOT NULL,
    vector   BLOB NOT NULL,          -- float32 array, little-endian
    PRIMARY KEY (group_id, model, dim)
  );
`);

const rows = db
  .prepare(
    `SELECT g.id, g.nass FROM meaning_groups g
     WHERE g.id > 0 AND LENGTH(TRIM(g.nass)) > 0
       AND NOT EXISTS (SELECT 1 FROM group_embedding e
                       WHERE e.group_id = g.id AND e.model = ? AND e.dim = ?)
     ORDER BY g.id`,
  )
  .all(MODEL, DIM);
console.log(`${rows.length} meaning groups to embed with ${MODEL} (dim ${DIM})`);

const insert = db.prepare("INSERT OR REPLACE INTO group_embedding VALUES (?,?,?,?)");
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;

const BATCH = 100;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const body = {
    requests: batch.map((r) => ({
      model: `models/${MODEL}`,
      content: { parts: [{ text: r.nass }] },
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: DIM,
    })),
  };
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(`${URL_}?key=${KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    if ((res.status === 429 || res.status >= 500) && attempt <= 6) {
      const wait = attempt * 5000;
      console.log(`  HTTP ${res.status}, retrying in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    console.error(`embedding request failed: HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const { embeddings } = await res.json();
  db.exec("BEGIN");
  for (let j = 0; j < batch.length; j++) {
    const vec = Float32Array.from(embeddings[j].values);
    insert.run(batch[j].id, MODEL, DIM, Buffer.from(vec.buffer));
  }
  db.exec("COMMIT");
  console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
}

const n = db.prepare("SELECT COUNT(*) n FROM group_embedding WHERE model=? AND dim=?").get(MODEL, DIM).n;
console.log(`done — ${n} group embeddings stored (${MODEL}, dim ${DIM})`);
db.close();
