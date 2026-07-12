/**
 * Hadith KG API server (zero-dependency node:http).
 *
 * Opens BOTH databases:
 *   hadith-app.db (monlite) — documents + Arabic FTS (hadiths.matnClean, groups.nassClean)
 *   hadith-kg.db  (SQLite)  — graph traversals (rawi↔hadith, teacher/student edges)
 *
 * Usage:  node server/server.mjs [--app hadith-app.db] [--kg hadith-kg.db] [--port 8077]
 * Both DB files must be on local SSD storage (not /Volumes/data).
 */
import http from "node:http";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createDb } from "@monlite/core";
import { fts } from "@monlite/fts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coll, normalizeArabic } from "../shared/monlite-schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const APP_DB = arg("app", path.resolve(HERE, "../../hadith-app.db"));
const KG_DB = arg("kg", path.resolve(HERE, "../../hadith-kg.db"));
const PORT = Number(arg("port", 8077));
// loopback by default: no LAN exposure, no OS firewall prompt. Pass
// --host 0.0.0.0 explicitly when deploying behind a reverse proxy.
const HOST = arg("host", "127.0.0.1");
const STATIC_DIR = arg("static", path.resolve(HERE, "../apps/dashboard/dist"));
const CHAT_MODEL = arg("chat-model", "gemini-2.5-flash");

const db = createDb(APP_DB, {
  plugins: [fts({ hadiths: ["matnClean"], groups: ["nassClean"] })],
});
const kg = new DatabaseSync(KG_DB, { readOnly: true });

const hadiths = db.collection("hadiths");
const groups = db.collection("groups");
const rawis = coll(db, "rawis");
const alems = coll(db, "alems");
const topics = coll(db, "topics");
const books = coll(db, "books");
const meta = coll(db, "meta");

// small in-memory caches
const bookName = new Map(
  (await books.findMany({})).map((b) => [b.bookId, b.name]),
);
const trim = (h) => ({
  hadithId: h.hadithId, bookId: h.bookId, bookName: bookName.get(h.bookId),
  noInBook: h.noInBook, taraf: h.taraf, hukm: h.hukm, type: h.type,
  groupId: h.groupId, sanadCount: h.sanads?.length ?? 0,
});

// KG prepared statements (graph side)
const q = {
  rawiHadiths: kg.prepare(
    `SELECT DISTINCT s.hadith_id FROM sanad_rawis sr JOIN sanads s ON s.id = sr.sanad_id
     WHERE sr.rawi_id = ? AND sr.pos > 0 ORDER BY s.hadith_id LIMIT ? OFFSET ?`),
  teachers: kg.prepare(
    `SELECT b.rawi_id id, r.nickname name, r.rank, r.tabaka, COUNT(*) n
     FROM sanad_rawis a JOIN sanad_rawis b ON b.sanad_id = a.sanad_id AND b.pos = a.pos + 1
     JOIN rawis r ON r.id = b.rawi_id
     WHERE a.rawi_id = ? AND a.pos > 0 GROUP BY b.rawi_id ORDER BY n DESC LIMIT ?`),
  students: kg.prepare(
    `SELECT b.rawi_id id, r.nickname name, r.rank, r.tabaka, COUNT(*) n
     FROM sanad_rawis a JOIN sanad_rawis b ON b.sanad_id = a.sanad_id AND b.pos = a.pos - 1
     JOIN rawis r ON r.id = b.rawi_id
     WHERE a.rawi_id = ? AND b.pos > 0 GROUP BY b.rawi_id ORDER BY n DESC LIMIT ?`),
  groupHadiths: kg.prepare(
    `SELECT id FROM hadiths WHERE group_id = ? ORDER BY book_id, no_inbook LIMIT ? OFFSET ?`),
  groupChains: kg.prepare(
    `SELECT s.id sanad_id, s.matn grade, s.hadith_id, sr.pos, sr.rawi_id,
            r.nickname, r.rank, r.rank_no, r.tabaka, r.has_tadlis, r.has_ikhtilat,
            h.book_id
     FROM sanads s
     JOIN sanad_rawis sr ON sr.sanad_id = s.id
     JOIN rawis r ON r.id = sr.rawi_id
     LEFT JOIN hadiths h ON h.id = s.hadith_id
     WHERE s.group_id = ? ORDER BY s.id, sr.pos`),
  bookHadiths: kg.prepare(
    `SELECT id FROM hadiths WHERE book_id = ? ORDER BY no_inbook LIMIT ? OFFSET ?`),
  alemAqwal: kg.prepare(
    `SELECT q.rawi_id rawiId, r.nickname rawi, q.qawl FROM aqwal q
     JOIN rawis r ON r.id = q.rawi_id WHERE q.alem_id = ? ORDER BY q.id LIMIT ? OFFSET ?`),
  topicHadiths: kg.prepare(
    `SELECT id FROM hadiths WHERE group_id = ? ORDER BY book_id, no_inbook LIMIT ?`),
  whyRows: kg.prepare(
    `SELECT s.id sanad_id, s.matn grade, s.hukum, s.length, sr.pos,
            r.id rawi_id, r.nickname, r.rank, r.tabaka,
            r.has_tadlis, r.has_ikhtilat, r.is_stub
     FROM sanads s
     JOIN sanad_rawis sr ON sr.sanad_id = s.id
     JOIN rawis r ON r.id = sr.rawi_id
     WHERE s.hadith_id = ? ORDER BY s.id, sr.pos`),
  geoRows: kg.prepare(
    `SELECT s.id sanad_id, sr.pos, r.death_place, r.iqama, h.book_id
     FROM sanads s
     JOIN sanad_rawis sr ON sr.sanad_id = s.id
     JOIN rawis r ON r.id = sr.rawi_id
     JOIN hadiths h ON h.id = s.hadith_id
     WHERE s.group_id = ? ORDER BY s.id, sr.pos`),
  contactRows: kg.prepare(
    `SELECT s.id sanad_id, sr.pos, r.id rawi_id, r.nickname, r.rank,
            r.tabaka, r.death_year, r.death_year_raw, r.birth_year
     FROM sanads s
     JOIN sanad_rawis sr ON sr.sanad_id = s.id
     JOIN rawis r ON r.id = sr.rawi_id
     WHERE s.hadith_id = ? ORDER BY s.id, sr.pos`),
};

/** Clamp a query param to [0, max]; NaN/negative/garbage → the default. */
const clamp = (v, dflt, max) => {
  const n = Number(v ?? dflt);
  return Number.isFinite(n) ? Math.min(Math.max(0, Math.trunc(n)), max) : dflt;
};

const byIds = async (ids) =>
  ids.length
    ? (await hadiths.findMany({ where: { _id: { in: ids.map((i) => `h${i}`) } } }))
        .sort((a, b) => ids.indexOf(a.hadithId) - ids.indexOf(b.hadithId))
    : [];

// ---- semantic layer (Gemini query embedding + in-RAM cosine over groups) -----
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const EMB_MODEL = "gemini-embedding-001";
const EMB_DIM = 768;
let emb = null; // { ids: Int32Array, mat: Float32Array (normalized, row-major) }

function loadEmbeddings() {
  if (emb) return emb;
  const has = kg.prepare(
    "SELECT COUNT(*) n FROM sqlite_master WHERE name = 'group_embedding'").get().n;
  if (!has) return null;
  const rows = kg.prepare(
    "SELECT group_id, vector FROM group_embedding WHERE model = ? AND dim = ? ORDER BY group_id")
    .all(EMB_MODEL, EMB_DIM);
  if (!rows.length) return null;
  const ids = new Int32Array(rows.length);
  const mat = new Float32Array(rows.length * EMB_DIM);
  rows.forEach((r, i) => {
    ids[i] = r.group_id;
    const v = new Float32Array(r.vector.buffer, r.vector.byteOffset, EMB_DIM);
    let norm = 0;
    for (let d = 0; d < EMB_DIM; d++) norm += v[d] * v[d];
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < EMB_DIM; d++) mat[i * EMB_DIM + d] = v[d] / norm;
  });
  emb = { ids, mat };
  console.log(`semantic: loaded ${rows.length} group vectors (${EMB_MODEL}/${EMB_DIM})`);
  return emb;
}

async function embedQuery(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMB_MODEL}:embedContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMB_MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMB_DIM,
      }),
    });
  if (!res.ok) throw new Error(`gemini embed: HTTP ${res.status}`);
  const v = Float32Array.from((await res.json()).embedding.values);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

async function semanticGroups(query, limit) {
  const e = loadEmbeddings();
  if (!e) return { error: "no embeddings — run embed-groups.mjs", hits: null };
  if (!GEMINI_KEY) return { error: "GEMINI_API_KEY not set on server", hits: null };
  const qv = await embedQuery(query);
  const scores = new Float32Array(e.ids.length);
  for (let i = 0; i < e.ids.length; i++) {
    let s = 0;
    const off = i * EMB_DIM;
    for (let d = 0; d < EMB_DIM; d++) s += e.mat[off + d] * qv[d];
    scores[i] = s;
  }
  const order = [...e.ids.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, limit);
  return { hits: order.map((i) => ({ groupId: e.ids[i], score: scores[i] })) };
}

const matnOf = (h) =>
  h.matnStart != null ? h.nass.slice(h.matnStart, h.matnEnd) : h.nass;

// narrator reliability → severity (0 best … 5 worst), mirrors the client's util.js
const RANK_TIERS = [
  [/صحابي/, 0, "صحابي"], [/متروك|كذاب|وضاع|يضع|متهم|دجال/, 5, "متروك"],
  [/ضعيف|منكر|واه|ساقط/, 4, "ضعيف"], [/مجهول|مستور|مقبول|لين|لا يعرف/, 3, "مجهول"],
  [/صدوق|لا بأس|حسن/, 2, "صدوق"], [/ثقة|حافظ|إمام|حجة|متقن|ثبت|جبل/, 1, "ثقة"],
];
const rankSevServer = (rank = "") => {
  for (const [re, sev, label] of RANK_TIERS) if (re.test(rank)) return { sev, label };
  return { sev: 3, label: "غير محدد" };
};
const isBreakName = (name = "") =>
  /موضع (انقطاع|ارسال|إرسال|تعليق|إعضال)|مبهم|غير معرف/.test(name);

// isnad-graph filter helpers (shared by /tree and /edge so results always agree)
const gradeKey = (m = "") =>
  /صحيح/.test(m) ? "sahih" : /حسن/.test(m) ? "hasan"
  : /موضوع|شديد الضعف|منكر/.test(m) ? "mawdu" : /ضعيف|لين/.test(m) ? "daif" : "other";
const isMudallisWeak = (r) =>
  r.has_tadlis || r.has_ikhtilat || /متروك|كذاب|وضاع|يضع|متهم|ضعيف|منكر/.test(r.rank ?? "");

/** Group the flat groupChains rows into per-sanad chains with grade/book/problem. */
function buildChains(rows) {
  const chains = new Map();
  for (const r of rows) {
    const c = chains.get(r.sanad_id)
      ?? { sanadId: r.sanad_id, grade: r.grade, bookId: r.book_id,
           hadithId: r.hadith_id, rawis: [], problem: false };
    c.rawis.push(r);
    if (isMudallisWeak(r)) c.problem = true;
    chains.set(r.sanad_id, c);
  }
  return chains;
}
/** Does a filter set admit this chain? (rawis are pos-ascending: 0=author…last=sahabi) */
function chainPasses(c, f) {
  if (f.books && !f.books.has(c.bookId)) return false;   // corpus scope
  if (f.sahabi && c.rawis[c.rawis.length - 1].rawi_id !== f.sahabi) return false;
  if (f.grade && gradeKey(c.grade) !== f.grade) return false;
  if (f.book && c.bookId !== f.book) return false;
  if (f.problems && !c.problem) return false;
  return true;
}

/** Parse ?books=1,2,3 (corpus scope) → Set<int> or null (whole corpus). */
function parseBookScope(u) {
  const raw = u.searchParams.get("books");
  if (!raw) return null;
  const s = new Set(raw.split(",").map(Number).filter(Boolean));
  return s.size ? s : null;
}

// Scoped stats are expensive (a distinct-narrator triple-join runs ~1.5s over a
// 30-book scope) but the corpus is read-only, so a given book-set always yields
// the same answer. Cache by the normalized book-set; the default scope is warmed
// at startup so the home page never pays the cost interactively.
const scopedStatsCache = new Map();
function scopedStats(base, list) {
  const key = list.slice().sort((a, b) => a - b).join(",");
  const hit = scopedStatsCache.get(key);
  if (hit) return hit;
  const ph = list.map(() => "?").join(",");
  const one = (sql) => Object.values(kg.prepare(sql).get(...list))[0];
  const counts = {
    books: list.length,
    hadiths: one(`SELECT COUNT(*) n FROM hadiths WHERE book_id IN (${ph})`),
    sanads: one(`SELECT COUNT(*) n FROM sanads s JOIN hadiths h ON h.id = s.hadith_id WHERE h.book_id IN (${ph})`),
    groups: one(`SELECT COUNT(DISTINCT group_id) n FROM hadiths WHERE book_id IN (${ph}) AND group_id IS NOT NULL`),
    rawis: one(`SELECT COUNT(DISTINCT sr.rawi_id) n FROM sanad_rawis sr
                JOIN sanads s ON s.id = sr.sanad_id JOIN hadiths h ON h.id = s.hadith_id
                WHERE h.book_id IN (${ph})`),
    alems: base.counts.alems, aqwal: base.counts.aqwal, topics: base.counts.topics,
  };
  const topGroups = kg.prepare(
    `SELECT group_id groupId, COUNT(*) narrations FROM hadiths
     WHERE book_id IN (${ph}) AND group_id IS NOT NULL
     GROUP BY group_id ORDER BY narrations DESC LIMIT 30`).all(...list);
  const result = { ...base, counts, topGroups, scopedBooks: list.length };
  scopedStatsCache.set(key, result);
  return result;
}

// Semantic hits → group docs: drop empty groups (no narrations in corpus),
// lightly boost well-attested meanings so famous hadith outrank obscure
// near-duplicates at similar cosine distance.
async function semanticGroupDocs(query, limit) {
  const r = await semanticGroups(query, limit * 3);
  if (r.hits == null) return r;
  const docs = await groups.findMany({
    where: { groupId: { in: r.hits.map((h) => h.groupId) } },
  });
  const byId = new Map(docs.map((g) => [g.groupId, g]));
  const scored = r.hits
    .map((h) => ({ ...h, doc: byId.get(h.groupId) }))
    .filter((h) => h.doc && h.doc.hadithCount > 0)
    .map((h) => ({ ...h, rank: h.score + 0.03 * Math.log10(1 + h.doc.hadithCount) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
  return { hits: scored };
}

async function ragContext(qs, nGroups, perGroup, scope) {
  const ranked = new Map(); // groupId -> {via, score}
  const sem = await semanticGroupDocs(qs, nGroups);
  for (const h of sem.hits ?? [])
    ranked.set(h.groupId, { via: "semantic", score: h.score });
  for (const g of await groups.search(normalizeArabic(qs), { limit: nGroups }))
    if (!ranked.has(g.groupId)) ranked.set(g.groupId, { via: "fts" });

  // when scoped, pull each group's narrations only from the active books
  const scopeList = scope ? [...scope] : null;
  const scopePh = scopeList ? scopeList.map(() => "?").join(",") : "";
  const groupIds = (gid) => scopeList
    ? kg.prepare(`SELECT id FROM hadiths WHERE group_id = ? AND book_id IN (${scopePh})
                  ORDER BY book_id, no_inbook LIMIT ?`).all(gid, ...scopeList, perGroup).map((r) => r.id)
    : q.groupHadiths.all(gid, perGroup, 0).map((r) => r.id);

  const out = [];
  for (const [gid, how] of [...ranked.entries()]) {
    if (out.length >= nGroups) break;
    const g = await groups.findFirst({ where: { groupId: gid } });
    if (!g) continue;
    const ids = groupIds(gid);
    if (!ids.length) continue;                 // group has nothing in the active books
    out.push({
      groupId: gid, via: how.via, score: how.score,
      meaning: g.nass, hadithCount: g.hadithCount,
      sahabis: g.sahabis.map((s) => s.name),
      narrations: (await byIds(ids)).map((h) => ({
        hadithId: h.hadithId, book: bookName.get(h.bookId),
        noInBook: h.noInBook, hukm: h.hukm, type: h.type,
        matn: matnOf(h),
      })),
    });
  }
  let direct = await hadiths.search(normalizeArabic(qs), { limit: scope ? 20 : 5 });
  if (scope) direct = direct.filter((h) => scope.has(h.bookId)).slice(0, 5);
  return {
    query: qs,
    groups: out,
    hadithHits: direct.map((h) => ({
      hadithId: h.hadithId, book: bookName.get(h.bookId), noInBook: h.noInBook,
      hukm: h.hukm, matn: matnOf(h).slice(0, 500),
    })),
    semanticAvailable: sem.hits != null,
    scoped: scope ? scope.size : null,
  };
}

// ---- RAG chat: retrieval + Gemini generation, streamed as SSE ------------------
const CHAT_SYSTEM = `أنت مساعد بحثي متخصص في علم الحديث الشريف، تجيب اعتماداً حصرياً على المصادر المرفقة من قاعدة بيانات تضم ٧١٥ ألف حديث من ٤٢٥ كتاباً.
القواعد:
- أجب من المصادر المرفقة فقط، ولا تخترع أحاديث أو أسانيد من عندك.
- استشهد بعد كل معلومة برقم المصدر بين قوسين هكذا: 【1】.
- اذكر درجة الحديث (صحيح/حسن/ضعيف) عند الاستشهاد به، ونبّه إذا كان الدليل ضعيفاً.
- إذا لم تكفِ المصادر للإجابة قل ذلك صراحة واقترح صياغة أدق للسؤال.
- رتّب الجواب: خلاصة موجزة، ثم التفصيل بالأدلة، ثم فوائد إسنادية إن وجدت.`;

async function chatHandler(req, res, body) {
  const { question, history = [], books } = body;
  if (!question?.trim()) throw new Error("question is required");
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set on server");

  const scope = Array.isArray(books) && books.length ? new Set(books.map(Number)) : null;
  const ctx = await ragContext(question.trim(), 6, 3, scope);
  const sources = [];
  for (const g of ctx.groups)
    for (const n of g.narrations)
      sources.push({ ...n, groupId: g.groupId, meaning: g.meaning,
                     sahabis: g.sahabis, hadithCount: g.hadithCount });
  for (const h of ctx.hadithHits)
    if (!sources.some((s) => s.hadithId === h.hadithId))
      sources.push({ ...h, groupId: null });
  const sourceBlock = sources
    .map((s, i) => `【${i + 1}】 ${s.book}${s.noInBook ? ` (${s.noInBook})` : ""} — الحكم: ${s.hukm}\n${s.matn.slice(0, 800)}`)
    .join("\n\n");

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    Connection: "keep-alive",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({ type: "sources", sources: sources.map((s, i) => ({
    n: i + 1, hadithId: s.hadithId, book: s.book, noInBook: s.noInBook,
    hukm: s.hukm, groupId: s.groupId, matn: s.matn.slice(0, 200),
  })) });

  const contents = [
    ...history.slice(-6).map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    })),
    { role: "user", parts: [{ text: `المصادر:\n\n${sourceBlock}\n\nالسؤال: ${question}` }] },
  ];
  const ac = new AbortController();
  res.on("close", () => ac.abort());     // stop paying for tokens into a dead socket
  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CHAT_SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      });
  } catch (e) {
    if (ac.signal.aborted) return;
    throw e;
  }
  if (!upstream.ok) {
    send({ type: "error", error: `gemini: HTTP ${upstream.status}` });
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let carry = "";
  const emit = (line) => {
    if (!line.startsWith("data: ")) return;
    try {
      const chunk = JSON.parse(line.slice(6));
      const text = (chunk.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "").join("");
      if (text) send({ type: "delta", text });
    } catch { /* keepalive or partial */ }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop();
      for (const line of lines) emit(line);
    }
    carry += dec.decode();               // flush the decoder + any final line
    if (carry) emit(carry);
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  }
  if (ac.signal.aborted) return;
  send({ type: "done" });
  res.end();
}

// ---- static dashboard (production build) ----------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json" };
function serveStatic(u, res) {
  if (!fs.existsSync(STATIC_DIR)) return false;
  let p = path.normalize(path.join(STATIC_DIR, u.pathname));
  if (!p.startsWith(STATIC_DIR)) return false;
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(STATIC_DIR, "index.html");
  if (!fs.existsSync(p)) return false;
  res.writeHead(200, { "Content-Type": MIME[path.extname(p)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(p));
  return true;
}

// ---- routes -----------------------------------------------------------------
const routes = {
  "GET /api/stats": async (u) => {
    const base = await meta.findFirst({ where: { key: "stats" } });
    const scope = parseBookScope(u);
    if (!scope) return base;
    return scopedStats(base, [...scope].map(Number).filter(Number.isFinite));
  },

  "GET /api/search/hadiths": async (u) => {
    const qs = normalizeArabic(u.searchParams.get("q") ?? "");
    const limit = clamp(u.searchParams.get("limit"), 20, 100);
    if (!qs) return { hits: [] };
    const scope = parseBookScope(u);
    // over-fetch when scoped so the post-filter still fills the page
    const hits = await hadiths.search(qs, { limit: scope ? limit * 6 : limit });
    const kept = scope ? hits.filter((h) => scope.has(h.bookId)) : hits;
    return { hits: kept.slice(0, limit).map(trim) };
  },

  "GET /api/search/groups": async (u) => {
    const qs = normalizeArabic(u.searchParams.get("q") ?? "");
    const limit = clamp(u.searchParams.get("limit"), 20, 100);
    if (!qs) return { hits: [] };
    const scope = parseBookScope(u);
    const hits = await groups.search(qs, { limit: scope ? limit * 4 : limit });
    // a group is in-scope if any of its books is active
    const kept = scope
      ? hits.filter((g) => (g.books ?? []).some((b) => scope.has(b.bookId)))
      : hits;
    return { hits: kept.slice(0, limit).map((g) => ({
      groupId: g.groupId, nass: g.nass, hadithCount: g.hadithCount,
      sahabiCount: g.sahabis.length, bookCount: g.books.length,
    })) };
  },

  "GET /api/search/rawis": async (u) => {
    const qs = u.searchParams.get("q") ?? "";
    const limit = clamp(u.searchParams.get("limit"), 20, 100);
    if (!qs) return { hits: [] };
    const hits = await rawis.findMany({
      where: { OR: [{ name: { contains: qs } }, { nickname: { contains: qs } }] },
      orderBy: { chainCount: "desc" },
      take: limit,
    });
    return { hits: hits.map((r) => ({
      rawiId: r.rawiId, nickname: r.nickname, rank: r.rank, tabaka: r.tabaka,
      chainCount: r.chainCount, deathYear: r.deathYear ?? r.deathYearRaw,
    })) };
  },

  "GET /api/hadith/:id": async (_u, id) =>
    (await hadiths.findFirst({ where: { hadithId: Number(id) } })),

  // الاعتبار — classify every route of this hadith's meaning, relative to a
  // studied narrator R: متابعة تامة (someone else shares R's own shaykh),
  // متابعة قاصرة (agreement only higher up), شاهد (different Companion).
  "GET /api/hadith/:id/itibar": async (u, id) => {
    const grp = kg.prepare("SELECT group_id FROM hadiths WHERE id = ?").get(Number(id));
    if (!grp?.group_id) return { available: false };
    const groupId = grp.group_id;

    // reference chain (first sanad of this hadith), transmission order (0 = Companion)
    const refRows = q.whyRows.all(Number(id));
    if (!refRows.length) return { available: false };
    const refBySanad = new Map();
    for (const r of refRows) (refBySanad.get(r.sanad_id) ?? refBySanad.set(r.sanad_id, []).get(r.sanad_id)).push(r);
    const refChain = [...refBySanad.values()][0];               // pos-ascending (0 = author)
    const refSanadId = refChain[0].sanad_id;
    const refSeq = [...refChain].reverse();                     // transmission order, [0] = Companion
    if (refSeq.length < 2) return { available: false };
    const S = refSeq[0].rawi_id;                                // Companion

    // studied narrator R (?rawi=) — default: the narrator just below the Companion
    const rParam = Number(u.searchParams.get("rawi") || 0);
    let rIdx = rParam ? refSeq.findIndex((x) => x.rawi_id === rParam) : -1;
    if (rIdx < 1) rIdx = 1;
    const R = refSeq[rIdx];
    const Sh = refSeq[rIdx - 1];                                // R's shaykh (toward Companion)
    const aboveSh = new Set(refSeq.slice(0, rIdx - 1).map((x) => x.rawi_id));  // strictly above Sh

    // every route of the meaning
    const chains = new Map();
    for (const r of q.groupChains.all(groupId)) {
      const c = chains.get(r.sanad_id)
        ?? { hadithId: r.hadith_id, grade: r.grade, bookId: r.book_id, rows: [] };
      c.rows.push(r);
      chains.set(r.sanad_id, c);
    }

    const tamma = [], qasira = [], shawahid = [];
    for (const [sid, c] of chains) {
      if (sid === refSanadId) continue;
      const seq = [...c.rows].reverse();                        // [0] = Companion
      const comp = seq[0]?.rawi_id;
      const base = { hadithId: c.hadithId, bookId: c.bookId, grade: c.grade };
      if (comp !== S) { shawahid.push(base); continue; }        // different Companion → witness
      const shPos = seq.findIndex((x) => x.rawi_id === Sh.rawi_id);
      if (shPos >= 0) {
        const below = seq[shPos + 1];                           // this route's student of Sh
        if (below && below.rawi_id !== R.rawi_id) {
          tamma.push({ ...base, via: below.nickname, viaId: below.rawi_id });
          continue;
        }
        if (below && below.rawi_id === R.rawi_id) continue;     // passes through R itself
      }
      if (seq.some((x) => aboveSh.has(x.rawi_id)))              // shares an ancestor of Sh
        qasira.push(base);
      else
        qasira.push({ ...base, note: "يلتقيان عند الصحابي" });
    }

    // enrich with book / number / taraf, dedupe by hadith
    const ids = [...new Set([...tamma, ...qasira, ...shawahid].map((x) => x.hadithId))];
    const byH = new Map((await byIds(ids)).map((d) => [d.hadithId, d]));
    const enrich = (arr) => {
      const seen = new Set(), out = [];
      for (const x of arr) {
        if (seen.has(x.hadithId)) continue;
        seen.add(x.hadithId);
        const d = byH.get(x.hadithId);
        out.push({ hadithId: x.hadithId, book: bookName.get(x.bookId), noInBook: d?.noInBook,
                   taraf: d?.taraf, hukm: d?.hukm ?? x.grade, via: x.via, note: x.note });
      }
      return out.slice(0, 60);
    };
    return {
      available: true, groupId,
      companion: { rawiId: S, name: refSeq[0].nickname },
      focus: { rawiId: R.rawi_id, name: R.nickname, rank: R.rank },
      shaykh: { rawiId: Sh.rawi_id, name: Sh.nickname },
      chain: refSeq.map((x, i) => ({ rawiId: x.rawi_id, name: x.nickname, rank: x.rank,
        isFocus: i === rIdx, isCompanion: i === 0 })),
      tamma: enrich(tamma), qasira: enrich(qasira), shawahid: enrich(shawahid),
      counts: { tamma: tamma.length, qasira: qasira.length, shawahid: shawahid.length },
    };
  },

  // لوحة الاعتبار — group-level i'tibar workbench. Corpus-wide by design:
  // corroboration must weigh ALL routes, not just the selected books. Picks a
  // subject narrator (default: the madār) and buckets every OTHER route into
  // متابعة تامة / قاصرة / شاهد relative to him, then issues a verdict.
  "GET /api/group/:id/board": async (u, id) => {
    const groupId = Number(id);
    const rows = q.groupChains.all(groupId);
    if (!rows.length) return { available: false };

    // reconstruct each route in transmission order ([0] = Companion)
    const byS = new Map();
    for (const r of rows) {
      const c = byS.get(r.sanad_id)
        ?? { hadithId: r.hadith_id, grade: r.grade, bookId: r.book_id, rows: [] };
      c.rows.push(r); byS.set(r.sanad_id, c);
    }
    const seqs = [...byS.entries()].map(([sid, c]) => ({ sid, ...c, seq: [...c.rows].reverse() }))
      .filter((s) => s.seq.length >= 2);
    if (!seqs.length) return { available: false };

    // dominant Companion, then the madār among his routes (the pivot most routes
    // pass through, preferring the one closest to the Companion)
    const compCount = new Map();
    for (const s of seqs) compCount.set(s.seq[0].rawi_id, (compCount.get(s.seq[0].rawi_id) ?? 0) + 1);
    const domComp = [...compCount].sort((a, b) => b[1] - a[1])[0][0];
    // madār = the common link: the highest-traffic narrator who actually BRANCHES
    // (fans out to ≥2 students). Route-count alone would pick a single-thread
    // narrator nearer the Companion; the classical madār is the fan-out point.
    const fan = new Map();      // rawiId → { students:Map(id→routes), routes, minI }
    for (const s of seqs) {
      if (s.seq[0].rawi_id !== domComp) continue;
      s.seq.forEach((x, i) => {
        if (i === 0) return;
        const f = fan.get(x.rawi_id) ?? { students: new Map(), routes: 0, minI: 99 };
        f.routes++; f.minI = Math.min(f.minI, i);
        const nx = s.seq[i + 1];
        if (nx) f.students.set(nx.rawi_id, (f.students.get(nx.rawi_id) ?? 0) + 1);
        fan.set(x.rawi_id, f);
      });
    }
    // Juynboll's common link: the narrator CLOSEST to the Companion whose traffic
    // genuinely SPLITS. "Substantial" fan = ≥3 transmitters AND a real share of
    // routes going off the single main student (≥15%), so an abbreviated single
    // strand with a stray variant (e.g. محمد بن إبراهيم → يحيى, 11/334) is not
    // mistaken for the fan-out — the real madār (يحيى, 271/324) is.
    const split = (f) => f.routes - Math.max(0, ...f.students.values());
    const substantial = ([, f]) => f.students.size >= 3 && split(f) >= Math.max(3, f.routes * 0.15);
    const madarId = ([...fan].filter(substantial).sort((a, b) => a[1].minI - b[1].minI || split(b[1]) - split(a[1]))[0]
      || [...fan].filter(([, f]) => f.students.size >= 2).sort((a, b) => a[1].minI - b[1].minI)[0]
      || [...fan].sort((a, b) => a[1].minI - b[1].minI)[0])?.[0];
    const S = domComp;
    const R = Number(u.searchParams.get("rawi")) || madarId;

    // reference route: the longest route of the dominant Companion that passes
    // through R — it fixes R's shaykh and the ancestors above him
    const refSeq = seqs.filter((s) => s.seq[0].rawi_id === S && s.seq.some((x) => x.rawi_id === R))
      .sort((a, b) => b.seq.length - a.seq.length)[0]?.seq;
    if (!refSeq) return { available: false };
    const rIdx = Math.max(1, refSeq.findIndex((x) => x.rawi_id === R));
    const Rn = refSeq[rIdx];
    const Sh = refSeq[rIdx - 1];                               // R's shaykh (toward the Companion)
    const aboveSh = new Set(refSeq.slice(0, rIdx - 1).map((x) => x.rawi_id));

    const tamma = [], qasira = [], shawahid = [];
    for (const s of seqs) {
      if (s.seq.some((x) => x.rawi_id === R) && s.seq[0].rawi_id === S) {
        // a route through R itself is not a "follow-up"; skip unless it diverges below Sh
        const shPos = s.seq.findIndex((x) => x.rawi_id === Sh.rawi_id);
        const below = shPos >= 0 ? s.seq[shPos + 1] : null;
        if (!below || below.rawi_id === R) continue;
      }
      const comp = s.seq[0].rawi_id;
      const base = { hadithId: s.hadithId, bookId: s.bookId, grade: s.grade };
      if (comp !== S) { shawahid.push(base); continue; }        // another Companion → witness
      const shPos = s.seq.findIndex((x) => x.rawi_id === Sh.rawi_id);
      if (shPos >= 0) {
        const below = s.seq[shPos + 1];
        if (below && below.rawi_id !== R) { tamma.push({ ...base, via: below.nickname, viaId: below.rawi_id }); continue; }
        if (below && below.rawi_id === R) continue;
      }
      if (s.seq.some((x) => aboveSh.has(x.rawi_id))) qasira.push(base);
      else qasira.push({ ...base, note: "يلتقيان عند الصحابي" });
    }

    const ids = [...new Set([...tamma, ...qasira, ...shawahid].map((x) => x.hadithId))];
    const byH = new Map((await byIds(ids)).map((d) => [d.hadithId, d]));
    const enrich = (arr) => {
      const seen = new Set(), out = [];
      for (const x of arr) {
        if (seen.has(x.hadithId)) continue;
        seen.add(x.hadithId);
        const d = byH.get(x.hadithId);
        out.push({ hadithId: x.hadithId, book: bookName.get(x.bookId), noInBook: d?.noInBook,
                   taraf: d?.taraf, hukm: d?.hukm ?? x.grade, via: x.via, note: x.note });
      }
      return out.slice(0, 80);
    };
    const c = { tamma: tamma.length, qasira: qasira.length, shawahid: shawahid.length };
    const verdict = c.tamma > 0
      ? { level: "strong", text: `تُوبِع ${Rn.nickname} متابعةً تامّةً (${c.tamma}) — روى عن شيخه غيرُه، فالمدار غيرُ متفرِّد.` }
      : (c.qasira + c.shawahid > 0)
        ? { level: "medium", text: `لم يُتابَع ${Rn.nickname} متابعةً تامّة، لكن يعضده ${c.qasira} متابعة قاصرة و${c.shawahid} شاهد.` }
        : { level: "alone", text: `تفرَّد ${Rn.nickname} بهذا الوجه عن شيخه — لا متابِع ولا شاهد في الكتب.` };

    return {
      available: true, groupId,
      companion: { rawiId: S, name: refSeq[0].nickname },
      focus: { rawiId: Rn.rawi_id, name: Rn.nickname, rank: Rn.rank },
      shaykh: { rawiId: Sh.rawi_id, name: Sh.nickname },
      madarId,
      totalRoutes: seqs.length,
      // offer only the elite narrators as subjects (Companion → madār → a level
      // below), not the deep book-collectors that fill out a single route
      candidates: refSeq.slice(0, Math.max(5, Math.max(
        refSeq.findIndex((x) => x.rawi_id === madarId), rIdx) + 2))
        .map((x, i) => ({ rawiId: x.rawi_id, name: x.nickname, rank: x.rank,
          isFocus: x.rawi_id === R, isCompanion: i === 0, isMadar: x.rawi_id === madarId })),
      tamma: enrich(tamma), qasira: enrich(qasira), shawahid: enrich(shawahid),
      counts: c, verdict,
    };
  },

  // فحص الاتصال الزمني — audit each adjacent link of the chain for a hidden
  // break: a large generation (tabaqa) jump means narrators were likely dropped;
  // a death-year gap corroborates. Every narrator has a tabaqa, so coverage is full.
  "GET /api/hadith/:id/contact": async (_u, id) => {
    const rows = q.contactRows.all(Number(id));
    if (!rows.length) return { sanads: [] };
    const bySanad = new Map();
    for (const r of rows) (bySanad.get(r.sanad_id) ?? bySanad.set(r.sanad_id, []).get(r.sanad_id)).push(r);

    const sanads = [...bySanad.values()].map((chain) => {
      const seq = [...chain].reverse();          // transmission order, [0] = Companion
      const links = [];
      for (let i = 0; i < seq.length - 1; i++) {
        const U = seq[i], L = seq[i + 1];        // L narrates from U (U closer to the Prophet)
        const tGap = (L.tabaka ?? 0) - (U.tabaka ?? 0);
        const dGap = (U.death_year && L.death_year) ? L.death_year - U.death_year : null;
        // Conservative: only student-born-after-teacher-died (or an explicit
        // marker) is a CONFIRMED break. Large tabaqa jumps are advisory only —
        // long-lived narrators legitimately span several generations (e.g. Mālik
        // ← Nāfiʿ spans 4), so a gap ≤4 is never flagged. Never mislabel a sound
        // narration as broken.
        let verdict = "ok", note = "";
        if (isBreakName(U.nickname) || isBreakName(L.nickname)) {
          verdict = "break"; note = "موضع انقطاع مُثبَت في المصدر";
        } else if (L.birth_year && U.death_year && L.birth_year > U.death_year) {
          verdict = "break"; note = `وُلد التلميذ سنة ${L.birth_year}هـ بعد وفاة شيخه سنة ${U.death_year}هـ — انقطاع مؤكَّد`;
        } else if (tGap >= 6) {
          verdict = "suspect"; note = `قفزة ${tGap} طبقات — يُنظر في احتمال سقوط راوٍ (ليس حكماً)`;
        } else if (dGap != null && dGap > 150) {
          verdict = "suspect"; note = `تباعد وفاة كبير جداً (${dGap} سنة) — يُتحقَّق من السماع`;
        } else if (tGap === 5 || (dGap != null && dGap > 110)) {
          verdict = "note"; note = tGap === 5 ? "قفزة ٥ طبقات — يُستأنس بالتحقق" : `فارق وفاة ملحوظ (${dGap} سنة)`;
        } else if (tGap <= -2) {
          verdict = "note"; note = "الطبقة معكوسة — الراوي أقدم من شيخه";
        }
        links.push({
          upper: { rawiId: U.rawi_id, name: U.nickname, tabaka: U.tabaka, death: U.death_year, deathRaw: U.death_year_raw },
          lower: { rawiId: L.rawi_id, name: L.nickname, tabaka: L.tabaka, death: L.death_year, deathRaw: L.death_year_raw },
          tGap, dGap, verdict, note,
        });
      }
      const flags = links.filter((l) => l.verdict === "suspect" || l.verdict === "break").length;
      return {
        sanadId: chain[0].sanad_id, links, flags,
        timeline: seq.map((x) => ({ rawiId: x.rawi_id, name: x.nickname, tabaka: x.tabaka,
          death: x.death_year, deathRaw: x.death_year_raw })),
      };
    });
    return { sanads };
  },

  // «لماذا هذا الحكم؟» — per-sanad plain-language analysis of chain health
  "GET /api/hadith/:id/why": async (_u, id) => {
    const rows = q.whyRows.all(Number(id));
    if (!rows.length) return { sanads: [] };
    const bySanad = new Map();
    for (const r of rows) {
      const s = bySanad.get(r.sanad_id)
        ?? { sanadId: r.sanad_id, grade: r.grade, hukm: r.hukum, narrators: [] };
      s.narrators.push(r);
      bySanad.set(r.sanad_id, s);
    }
    const sanads = [...bySanad.values()].map((s) => {
      const observations = [];   // neutral isnad notes (framed by grade on the client)
      let weakest = null;
      for (const r of s.narrators) {
        if (isBreakName(r.nickname)) {
          observations.push({ type: "inqita", name: r.nickname });
          continue;
        }
        if (r.has_tadlis) observations.push({ type: "tadlis", rawiId: r.rawi_id, name: r.nickname });
        if (r.has_ikhtilat) observations.push({ type: "ikhtilat", rawiId: r.rawi_id, name: r.nickname });
        const sv = rankSevServer(r.rank ?? "");
        if (!weakest || sv.sev > weakest.sev)
          weakest = { rawiId: r.rawi_id, name: r.nickname, rank: r.rank, ...sv };
      }
      const gc = gradeKey(s.grade ?? "");   // sahih | hasan | daif | mawdu | other
      // the weakest narrator is only presented as a DEFECT when the source ruling
      // is itself weak; for authenticated hadith it's shown as a neutral note.
      if (weakest && weakest.sev >= 3)
        observations.push({ type: "weak", rawiId: weakest.rawiId, name: weakest.name,
                            rank: weakest.rank, label: weakest.label, sev: weakest.sev });
      return {
        sanadId: s.sanadId, grade: s.grade, gradeClass: gc, hukm: s.hukm,
        weakest: weakest && weakest.sev >= 3
          ? { name: weakest.name, rank: weakest.rank, rawiId: weakest.rawiId } : null,
        observations,
      };
    });
    return { sanads };
  },

  // previous/next hadith within the same book (by in-book numbering)
  "GET /api/hadith/:id/nav": async (_u, id) => {
    const cur = kg.prepare("SELECT book_id, no_inbook FROM hadiths WHERE id = ?").get(Number(id));
    if (!cur) return null;
    const prev = kg.prepare(
      `SELECT id, no_inbook FROM hadiths WHERE book_id = ? AND no_inbook < ?
       ORDER BY no_inbook DESC LIMIT 1`).get(cur.book_id, cur.no_inbook);
    const next = kg.prepare(
      `SELECT id, no_inbook FROM hadiths WHERE book_id = ? AND no_inbook > ?
       ORDER BY no_inbook ASC LIMIT 1`).get(cur.book_id, cur.no_inbook);
    return { prev: prev ?? null, next: next ?? null };
  },

  // resolve a hadith by book + in-book number (jump-to-number)
  "GET /api/book/:id/no/:no": async (_u, id, no) => {
    const row = kg.prepare(
      "SELECT id FROM hadiths WHERE book_id = ? AND no_inbook = ? LIMIT 1")
      .get(Number(id), Number(no));
    return row ?? null;
  },

  "GET /api/group/:id": async (u, id) => {
    const g = await groups.findFirst({ where: { groupId: Number(id) } });
    if (!g) return null;
    const limit = clamp(u.searchParams.get("limit"), 30, 200);
    const offset = clamp(u.searchParams.get("offset"), 0, 100000000);
    const scope = parseBookScope(u);
    if (!scope) {
      const ids = q.groupHadiths.all(g.groupId, limit, offset).map((r) => r.id);
      return { ...g, narrations: (await byIds(ids)).map(trim) };
    }
    // scoped: recompute the whole per-meaning dashboard within the active books
    const list = [...scope].map(Number).filter(Number.isFinite);
    const ph = list.map(() => "?").join(",");
    const gid = g.groupId;
    const ids = kg.prepare(
      `SELECT id FROM hadiths WHERE group_id = ? AND book_id IN (${ph})
       ORDER BY book_id, no_inbook LIMIT ? OFFSET ?`)
      .all(gid, ...list, limit, offset).map((r) => r.id);
    const hc = kg.prepare(
      `SELECT COUNT(*) n, COUNT(DISTINCT takhrij) t FROM hadiths
       WHERE group_id = ? AND book_id IN (${ph})`).get(gid, ...list);
    const books = kg.prepare(
      `SELECT book_id bookId, COUNT(*) count FROM hadiths
       WHERE group_id = ? AND book_id IN (${ph}) GROUP BY book_id ORDER BY count DESC`)
      .all(gid, ...list).map((r) => ({ bookId: r.bookId, name: bookName.get(r.bookId), count: r.count }));
    const sahabis = kg.prepare(
      `SELECT r.id rawiId, MIN(r.nickname) name, COUNT(*) count
       FROM sanads s
       JOIN hadiths h ON h.id = s.hadith_id AND h.book_id IN (${ph})
       JOIN sanad_rawis sr ON sr.sanad_id = s.id
       JOIN rawis r ON r.id = sr.rawi_id AND r.rank = 'صحابي'
       WHERE s.group_id = ? AND sr.pos = (SELECT MAX(pos) FROM sanad_rawis WHERE sanad_id = s.id)
       GROUP BY r.id ORDER BY count DESC`).all(...list, gid);
    const tabRows = kg.prepare(
      `SELECT r.tabaka t, COUNT(DISTINCT sr.rawi_id) c
       FROM sanads s
       JOIN hadiths h ON h.id = s.hadith_id AND h.book_id IN (${ph})
       JOIN sanad_rawis sr ON sr.sanad_id = s.id AND sr.pos > 0
       JOIN rawis r ON r.id = sr.rawi_id
       WHERE s.group_id = ? GROUP BY r.tabaka`).all(...list, gid);
    const tabaqat = {};
    for (const r of tabRows) tabaqat[r.t] = r.c;
    return {
      ...g, hadithCount: hc.n, takhrijCount: hc.t, books, sahabis, tabaqat,
      scopedBooks: list.length,
      narrations: (await byIds(ids)).map(trim),
    };
  },

  // Isnad tree of a meaning group: all chains merged into one weighted DAG.
  // Edges follow transmission direction (Prophet ﷺ → sahabi → … → author).
  // ?sahabi=rawiId filters to chains passing through that companion.
  "GET /api/group/:id/tree": async (u, id) => {
    const rows = q.groupChains.all(Number(id));
    if (!rows.length) return null;
    const sahabiFilter = Number(u.searchParams.get("sahabi") || 0);
    const gradeFilter = u.searchParams.get("grade") || "";      // grade class key
    const bookFilter = Number(u.searchParams.get("book") || 0);
    const problemsOnly = u.searchParams.get("problems") === "1";
    const bookScope = parseBookScope(u);

    const chains = new Map();
    for (const r of rows) {
      if (bookScope && r.book_id != null && !bookScope.has(r.book_id)) continue;  // corpus scope
      const c = chains.get(r.sanad_id)
        ?? { grade: r.grade, bookId: r.book_id, rawis: [], problem: false };
      c.rawis.push(r);           // pos ascending: 0 = author … last = sahabi
      if (isMudallisWeak(r)) c.problem = true;
      chains.set(r.sanad_id, c);
    }

    // facet counts over the sahabi-filtered set (for the filter UI)
    const gradeCounts = {}, bookCounts = {};
    for (const c of chains.values()) {
      if (sahabiFilter && c.rawis[c.rawis.length - 1].rawi_id !== sahabiFilter) continue;
      const gk = gradeKey(c.grade);
      gradeCounts[gk] = (gradeCounts[gk] ?? 0) + 1;
      if (c.bookId) bookCounts[c.bookId] = (bookCounts[c.bookId] ?? 0) + 1;
    }

    const PROPHET = 0;           // virtual root
    const nodes = new Map([[PROPHET, {
      rawiId: PROPHET, name: "النبي ﷺ", role: "prophet", count: 0, depthSum: 0,
    }]]);
    const edges = new Map();     // "from>to" -> {from, to, count}
    let used = 0;
    for (const c of chains.values()) {
      const rw = c.rawis;
      const last = rw[rw.length - 1];
      if (sahabiFilter && last.rawi_id !== sahabiFilter) continue;
      if (gradeFilter && gradeKey(c.grade) !== gradeFilter) continue;
      if (bookFilter && c.bookId !== bookFilter) continue;
      if (problemsOnly && !c.problem) continue;
      used++;
      // transmission order: prophet → sahabi (last) → … → author (pos 0)
      const seq = [
        { rawi_id: PROPHET },
        ...[...rw].reverse(),
      ];
      for (let i = 0; i < seq.length; i++) {
        const r = seq[i];
        let n = nodes.get(r.rawi_id);
        if (!n) {
          n = { rawiId: r.rawi_id, name: r.nickname, rank: r.rank ?? null,
                tabaka: r.tabaka ?? null, role: "rawi", count: 0, depthSum: 0 };
          nodes.set(r.rawi_id, n);
        }
        n.count++;
        n.depthSum += i;
        // order-independent position tallies: a narrator can be book author in
        // one chain AND the common link in others (the classic madar case)
        if (i === 1) n.sahabiCount = (n.sahabiCount ?? 0) + 1;
        else if (i === seq.length - 1) n.authorCount = (n.authorCount ?? 0) + 1;
        else if (i > 1) n.middleCount = (n.middleCount ?? 0) + 1;
        if (i > 0) {
          const key = `${seq[i - 1].rawi_id}>${r.rawi_id}`;
          const e = edges.get(key) ?? { from: seq[i - 1].rawi_id, to: r.rawi_id, count: 0 };
          e.count++;
          edges.set(key, e);
        }
      }
    }
    const isMarker = (name = "") =>
      /موضع (انقطاع|ارسال|إرسال|تعليق|إعضال)|مبهم|غير معرف/.test(name);
    const nodeList = [...nodes.values()].map((n) => ({
      ...n,
      role: n.role === "prophet" ? "prophet"
        : isMarker(n.name) ? "break"
        : (n.sahabiCount ?? 0) > 0 ? "sahabi"
        : (n.middleCount ?? 0) > 0 ? "rawi"
        : "author",
      depth: n.count ? n.depthSum / n.count : 0, depthSum: undefined,
    }));
    // madar: the pivot the routes converge through — ranked by how often the
    // narrator sits in the MIDDLE of a chain, so being a book author too
    // doesn't disqualify him
    const madar = nodeList
      .filter((n) => !["prophet", "break", "sahabi"].includes(n.role)
                     && (n.middleCount ?? 0) > 1)
      .sort((a, b) => (b.middleCount ?? 0) - (a.middleCount ?? 0))[0] ?? null;
    const sahabis = nodeList.filter((n) => n.role === "sahabi")
      .sort((a, b) => b.count - a.count)
      .map((n) => ({ rawiId: n.rawiId, name: n.name, count: n.count }));
    const gradeLabels = { sahih: "صحيح", hasan: "حسن", daif: "ضعيف", mawdu: "موضوع/منكر", other: "غير محدد" };
    const grades = Object.entries(gradeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, count]) => ({ key: k, label: gradeLabels[k] ?? k, count }));
    const books = Object.entries(bookCounts)
      .map(([bid, count]) => ({ bookId: Number(bid), name: bookName.get(Number(bid)), count }))
      .sort((a, b) => b.count - a.count).slice(0, 12);
    return {
      groupId: Number(id), chains: used, totalChains: chains.size,
      nodes: nodeList, edges: [...edges.values()],
      madar: madar ? { rawiId: madar.rawiId, name: madar.name, count: madar.middleCount } : null,
      sahabis, grades, books,
      filters: { sahabi: sahabiFilter || null, grade: gradeFilter || null,
                 book: bookFilter || null, problems: problemsOnly },
    };
  },

  // geographic transmission of a meaning: city→city hops aggregated from the
  // narrators' death_place (fallback: first iqama city) along every chain.
  "GET /api/group/:id/geo": async (u, id) => {
    const scope = parseBookScope(u);
    const bySanad = new Map();
    for (const r of q.geoRows.all(Number(id))) {
      if (scope && r.book_id != null && !scope.has(r.book_id)) continue;
      (bySanad.get(r.sanad_id) ?? bySanad.set(r.sanad_id, []).get(r.sanad_id)).push(r);
    }
    const cityOf = (r) =>
      (r.death_place && r.death_place.trim())
      || (r.iqama ? r.iqama.split(/[،,]/)[0].trim() : "") || "";
    const cityCounts = {}, flows = new Map();
    let chainsUsed = 0;
    for (const chain of bySanad.values()) {
      chainsUsed++;
      const seq = [...chain].reverse();     // transmission order (Companion → author)
      let prev = null;
      for (const r of seq) {
        const c = cityOf(r);
        if (!c) continue;
        cityCounts[c] = (cityCounts[c] ?? 0) + 1;
        if (prev && prev !== c) {           // the hadith moved prev → c
          const k = `${prev}>${c}`;
          flows.set(k, (flows.get(k) ?? 0) + 1);
        }
        prev = c;
      }
    }
    return {
      groupId: Number(id), chains: chainsUsed,
      cityCounts,
      flows: [...flows].map(([k, count]) => {
        const [from, to] = k.split(">");
        return { from, to, count };
      }).sort((a, b) => b.count - a.count),
    };
  },

  // matn texts of a meaning's narrations, for word-level variant comparison.
  // Deduped by matn (representative kept), longest first, ≤ 24 variants.
  "GET /api/group/:id/matns": async (u, id) => {
    const scope = parseBookScope(u);
    const list = scope ? [...scope] : null;
    const rows = list
      ? kg.prepare(`SELECT id FROM hadiths WHERE group_id = ? AND book_id IN (${list.map(() => "?").join(",")}) ORDER BY no_inbook`).all(Number(id), ...list)
      : kg.prepare(`SELECT id FROM hadiths WHERE group_id = ? ORDER BY book_id, no_inbook LIMIT 400`).all(Number(id));
    const docs = await byIds(rows.map((r) => r.id));
    const seen = new Set(), out = [];
    for (const h of docs) {
      const matn = matnOf(h).trim();
      if (!matn) continue;
      const key = normalizeArabic(matn).replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hadithId: h.hadithId, book: bookName.get(h.bookId), noInBook: h.noInBook,
                 hukm: h.hukm, matn });
    }
    out.sort((a, b) => b.matn.length - a.matn.length);   // richest wording first (natural base)
    return { groupId: Number(id), variants: out.slice(0, 24), total: out.length };
  },

  // narrations passing through one edge of the isnad graph (from → to in
  // transmission order; from=0 is the Prophet ﷺ → its sahabi). Respects the
  // same filters as /tree so the results are always a subset of what's drawn.
  "GET /api/group/:id/edge": async (u, id) => {
    const from = Number(u.searchParams.get("from"));
    const to = Number(u.searchParams.get("to"));
    if (!to) return { narrations: [] };
    const f = {
      sahabi: Number(u.searchParams.get("sahabi") || 0),
      grade: u.searchParams.get("grade") || "",
      book: Number(u.searchParams.get("book") || 0),
      problems: u.searchParams.get("problems") === "1",
      books: parseBookScope(u),
    };
    const chains = buildChains(q.groupChains.all(Number(id)));
    const ids = new Set();
    for (const c of chains.values()) {
      if (!chainPasses(c, f)) continue;
      // transmission order: [Prophet(0), sahabi(last pos)…author(pos 0)]
      const seq = [0, ...c.rawis.map((r) => r.rawi_id).reverse()];
      for (let i = 1; i < seq.length; i++)
        if (seq[i - 1] === from && seq[i] === to) {
          if (c.hadithId != null) ids.add(c.hadithId);
          break;
        }
      if (ids.size >= 60) break;   // cap on DISTINCT narrations
    }
    return { narrations: (await byIds([...ids])).map(trim) };
  },

  "GET /api/rawi/:id": async (_u, id) => {
    const r = await rawis.findFirst({ where: { rawiId: Number(id) } });
    if (!r) return null;
    return {
      ...r,
      teachers: q.teachers.all(r.rawiId, 15),
      students: q.students.all(r.rawiId, 15),
    };
  },

  "GET /api/rawi/:id/hadiths": async (u, id) => {
    const limit = clamp(u.searchParams.get("limit"), 20, 100);
    const offset = clamp(u.searchParams.get("offset"), 0, 100000000);
    const ids = q.rawiHadiths.all(Number(id), limit, offset).map((r) => r.hadith_id);
    return { hadiths: (await byIds(ids)).map(trim) };
  },

  "GET /api/alem/:id": async (u, id) => {
    const a = await alems.findFirst({ where: { alemId: Number(id) } });
    if (!a) return null;
    const limit = clamp(u.searchParams.get("limit"), 50, 500);
    const offset = clamp(u.searchParams.get("offset"), 0, 100000000);
    return { ...a, aqwal: q.alemAqwal.all(a.alemId, limit, offset) };
  },

  "GET /api/alems": async () =>
    ({ alems: await alems.findMany({ orderBy: { aqwalQty: "desc" } }) }),

  "GET /api/books": async () =>
    ({ books: await books.findMany({ orderBy: { bookId: "asc" } }) }),

  "GET /api/book/:id": async (u, id) => {
    const b = await books.findFirst({ where: { bookId: Number(id) } });
    if (!b) return null;
    const limit = clamp(u.searchParams.get("limit"), 30, 200);
    const offset = clamp(u.searchParams.get("offset"), 0, 100000000);
    const ids = q.bookHadiths.all(b.bookId, limit, offset).map((r) => r.id);
    return { ...b, hadiths: (await byIds(ids)).map(trim) };
  },

  "GET /api/semantic/groups": async (u) => {
    const qs = (u.searchParams.get("q") ?? "").trim();
    const limit = clamp(u.searchParams.get("limit"), 10, 50);
    if (!qs) return { hits: [] };
    const r = await semanticGroupDocs(qs, limit);
    if (r.hits == null) return r;
    return { hits: r.hits.map((h) => ({
      groupId: h.groupId, score: Math.round(h.score * 1000) / 1000,
      nass: h.doc.nass, hadithCount: h.doc.hadithCount,
      sahabiCount: h.doc.sahabis.length, bookCount: h.doc.books.length,
    })) };
  },

  // Retrieval context for a RAG chat: semantic + FTS merged at the meaning
  // level, each group expanded with its best narrations.
  "GET /api/rag/context": async (u) => {
    const qs = (u.searchParams.get("q") ?? "").trim();
    if (!qs) return { query: qs, groups: [], hadithHits: [] };
    const nGroups = clamp(u.searchParams.get("groups"), 5, 20);
    const perGroup = clamp(u.searchParams.get("perGroup"), 3, 10);
    return ragContext(qs, nGroups, perGroup, parseBookScope(u));
  },

  // «احكم على السند» — a random hadith's chain (narrators + grades) for the
  // grade-the-chain learning quiz; returns the answer + weakest link for reveal.
  "GET /api/quiz": async () => {
    const maxId = kg.prepare("SELECT MAX(id) m FROM hadiths").get().m;
    let h = null;
    for (let t = 0; t < 20; t++) {
      const rid = 1 + Math.floor(Math.random() * maxId);
      const cand = kg.prepare(
        `SELECT id, matn, taraf_nass, type FROM hadiths
         WHERE id >= ? AND type_no IN (0,1) AND group_id IS NOT NULL AND matn != '' LIMIT 1`).get(rid);
      if (cand && gradeKey(cand.matn) !== "other") { h = cand; break; }  // only clearly-gradable
    }
    if (!h) return null;
    const rows = q.whyRows.all(h.id);
    if (!rows.length) return null;
    const bySanad = new Map();
    for (const r of rows) (bySanad.get(r.sanad_id) ?? bySanad.set(r.sanad_id, []).get(r.sanad_id)).push(r);
    const chain = [...bySanad.values()][0].reverse();   // transmission order (Companion → author)
    let weakest = null;
    for (const r of chain) {
      if (isBreakName(r.nickname)) continue;
      const sv = rankSevServer(r.rank ?? "");
      if (!weakest || sv.sev > weakest.sev) weakest = { rawiId: r.rawi_id, name: r.nickname, rank: r.rank, ...sv };
    }
    return {
      hadithId: h.id, taraf: h.taraf_nass, type: h.type,
      chain: chain.map((r) => ({ rawiId: r.rawi_id, name: r.nickname, rank: r.rank, tabaka: r.tabaka })),
      answer: gradeKey(h.matn), hukm: h.matn,
      weakest: weakest ? { rawiId: weakest.rawiId, name: weakest.name, rank: weakest.rank } : null,
    };
  },

  // الأفراد والغرائب — meanings that exist in a SINGLE chain (فرد مطلق), each
  // with the weakest narrator carrying it. Filter by that narrator's grade to
  // surface suspect singular narrations (أفراد الضعفاء والمتروكين = مظنة النكارة).
  "GET /api/tafarrud": async (u) => {
    const limit = clamp(u.searchParams.get("limit"), 30, 100);
    const offset = clamp(u.searchParams.get("offset"), 0, 100000000);
    const gk = u.searchParams.get("grade") || "";        // weakest-narrator grade class
    const scope = parseBookScope(u);
    const GRADE_LIKE = {
      matruk: `(weak.rank LIKE '%متروك%' OR weak.rank LIKE '%كذاب%' OR weak.rank LIKE '%وضاع%' OR weak.rank LIKE '%يضع%')`,
      daif: `(weak.rank LIKE '%ضعيف%' OR weak.rank LIKE '%منكر%')`,
      majhul: `(weak.rank LIKE '%مجهول%' OR weak.rank LIKE '%مقبول%' OR weak.rank LIKE '%مستور%' OR weak.rank LIKE '%لين%')`,
      saduq: `(weak.rank LIKE '%صدوق%' OR weak.rank LIKE '%حسن%' OR weak.rank LIKE '%لا بأس%')`,
      thiqa: `(weak.rank LIKE '%ثقة%' OR weak.rank LIKE '%حافظ%' OR weak.rank LIKE '%إمام%' OR weak.rank LIKE '%حجة%')`,
    };
    const where = [];
    const params = [];
    if (GRADE_LIKE[gk]) where.push(GRADE_LIKE[gk]);
    if (scope) { where.push(`h.book_id IN (${[...scope].map(() => "?").join(",")})`); params.push(...scope); }
    const sql = `
      WITH single AS (
        SELECT group_id gid, MIN(id) sid FROM sanads WHERE group_id IS NOT NULL
        GROUP BY group_id HAVING COUNT(*) = 1)
      SELECT g.id groupId, g.nass, g.matn_no,
             h.book_id bookId, h.id hadithId,
             weak.id weakId, weak.nickname weakName, weak.rank weakRank, weak.tabaka weakTabaka,
             comp.id sahabiId, comp.nickname sahabi
      FROM single
      JOIN meaning_groups g ON g.id = single.gid
      JOIN sanads s ON s.id = single.sid
      JOIN hadiths h ON h.id = s.hadith_id
      JOIN sanad_rawis wsr ON wsr.sanad_id = single.sid AND wsr.pos > 0
      JOIN rawis weak ON weak.id = wsr.rawi_id
             AND weak.rank_no = (SELECT MAX(r2.rank_no) FROM sanad_rawis sr2
                                 JOIN rawis r2 ON r2.id = sr2.rawi_id
                                 WHERE sr2.sanad_id = single.sid AND sr2.pos > 0)
      JOIN sanad_rawis csr ON csr.sanad_id = single.sid
             AND csr.pos = (SELECT MAX(pos) FROM sanad_rawis WHERE sanad_id = single.sid)
      JOIN rawis comp ON comp.id = csr.rawi_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY g.id ORDER BY g.id LIMIT ? OFFSET ?`;
    const rows = kg.prepare(sql).all(...params, limit + 1, offset);
    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit).map((r) => ({
        groupId: r.groupId, hadithId: r.hadithId, nass: r.nass, hukmNo: r.matn_no,
        book: bookName.get(r.bookId),
        weakest: { rawiId: r.weakId, name: r.weakName, rank: r.weakRank, tabaka: r.weakTabaka },
        sahabi: { rawiId: r.sahabiId, name: r.sahabi },
      })),
      hasMore, offset,
    };
  },

  "GET /api/topics": async (u) => {
    const parent = u.searchParams.get("parent");
    const where = parent ? { parentId: Number(parent) } : { level: 0 };
    return { topics: await topics.findMany({ where, orderBy: { lft: "asc" } }) };
  },

  "GET /api/topic/:id": async (_u, id) => {
    const t = await topics.findFirst({ where: { topicId: Number(id) } });
    if (!t) return null;
    const children = await topics.findMany({
      where: { parentId: t.topicId }, orderBy: { lft: "asc" },
    });
    let group = null, narrations = [];
    if (t.groupId != null) {
      group = await groups.findFirst({ where: { groupId: t.groupId } });
      const ids = q.topicHadiths.all(t.groupId, 30).map((r) => r.id);
      narrations = (await byIds(ids)).map(trim);
    }
    return { ...t, children, group, narrations };
  },
};

// ---- http ---------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
  // constant base: the Host header is never used, and a malformed one must not throw
  const u = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end();
    return;
  }
  if (req.method === "POST" && u.pathname === "/api/chat") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        await chatHandler(req, res, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        console.error(e);
        if (res.headersSent) {
          // already an SSE stream: surface the failure as a typed event
          res.write(`data: ${JSON.stringify({ type: "error", error: String(e.message ?? e) })}\n\n`);
          res.end();
        } else {
          res.writeHead(400, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ error: String(e.message ?? e) }));
        }
      }
    });
    return;
  }
  if (!u.pathname.startsWith("/api/") && req.method === "GET" && serveStatic(u, res)) return;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
    for (const [key, handler] of Object.entries(routes)) {
      const [method, pattern] = key.split(" ");
      if (req.method !== method) continue;
      const re = new RegExp(
        "^" + pattern.replace(/:(\w+)/g, "([^/]+)") + "$",
      );
      const m = u.pathname.match(re);
      if (!m) continue;
      const out = await handler(u, ...m.slice(1));
      if (out == null) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      } else {
        res.end(JSON.stringify(out));
      }
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: "no such route" }));
  } catch (e) {
    console.error(e);
    try {
      if (!res.headersSent)
        res.writeHead(500, { "Content-Type": "application/json",
                             "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: String(e.message ?? e) }));
    } catch { /* socket gone */ }
  }
});

server.listen(PORT, HOST, () =>
  console.log(`hadith-kg api on http://localhost:${PORT}  app=${APP_DB}  kg=${KG_DB}`),
);

// Warm the default-scope stats (top-30 books by hadith count — the client's
// first-load default) so the home page never pays the ~2.5s scoped recompute.
(async () => {
  try {
    const base = await meta.findFirst({ where: { key: "stats" } });
    const bs = await books.findMany({});
    const top30 = bs.slice().sort((a, b) => (b.hadithQty ?? 0) - (a.hadithQty ?? 0))
      .slice(0, 30).map((b) => b.bookId);
    if (base && top30.length) { scopedStats(base, top30); console.log("warmed default scope stats"); }
  } catch (e) { console.warn("scope warm skipped:", e.message); }
})();
