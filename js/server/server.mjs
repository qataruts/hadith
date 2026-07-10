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
    `SELECT s.id sanad_id, s.matn grade, sr.pos, sr.rawi_id, r.nickname, r.rank, r.tabaka
     FROM sanads s
     JOIN sanad_rawis sr ON sr.sanad_id = s.id
     JOIN rawis r ON r.id = sr.rawi_id
     WHERE s.group_id = ? ORDER BY s.id, sr.pos`),
  bookHadiths: kg.prepare(
    `SELECT id FROM hadiths WHERE book_id = ? ORDER BY no_inbook LIMIT ? OFFSET ?`),
  alemAqwal: kg.prepare(
    `SELECT q.rawi_id rawiId, r.nickname rawi, q.qawl FROM aqwal q
     JOIN rawis r ON r.id = q.rawi_id WHERE q.alem_id = ? ORDER BY q.id LIMIT ? OFFSET ?`),
  topicHadiths: kg.prepare(
    `SELECT id FROM hadiths WHERE group_id = ? ORDER BY book_id, no_inbook LIMIT ?`),
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

async function ragContext(qs, nGroups, perGroup) {
  const ranked = new Map(); // groupId -> {via, score}
  const sem = await semanticGroupDocs(qs, nGroups);
  for (const h of sem.hits ?? [])
    ranked.set(h.groupId, { via: "semantic", score: h.score });
  for (const g of await groups.search(normalizeArabic(qs), { limit: nGroups }))
    if (!ranked.has(g.groupId)) ranked.set(g.groupId, { via: "fts" });

  const out = [];
  for (const [gid, how] of [...ranked.entries()].slice(0, nGroups)) {
    const g = await groups.findFirst({ where: { groupId: gid } });
    if (!g) continue;
    const ids = q.groupHadiths.all(gid, perGroup, 0).map((r) => r.id);
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
  const direct = await hadiths.search(normalizeArabic(qs), { limit: 5 });
  return {
    query: qs,
    groups: out,
    hadithHits: direct.map((h) => ({
      hadithId: h.hadithId, book: bookName.get(h.bookId), noInBook: h.noInBook,
      hukm: h.hukm, matn: matnOf(h).slice(0, 500),
    })),
    semanticAvailable: sem.hits != null,
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
  const { question, history = [] } = body;
  if (!question?.trim()) throw new Error("question is required");
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set on server");

  const ctx = await ragContext(question.trim(), 6, 3);
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
  "GET /api/stats": async () => (await meta.findFirst({ where: { key: "stats" } })),

  "GET /api/search/hadiths": async (u) => {
    const qs = normalizeArabic(u.searchParams.get("q") ?? "");
    const limit = clamp(u.searchParams.get("limit"), 20, 100);
    if (!qs) return { hits: [] };
    const hits = await hadiths.search(qs, { limit });
    return { hits: hits.map(trim) };
  },

  "GET /api/search/groups": async (u) => {
    const qs = normalizeArabic(u.searchParams.get("q") ?? "");
    const limit = clamp(u.searchParams.get("limit"), 20, 100);
    if (!qs) return { hits: [] };
    const hits = await groups.search(qs, { limit });
    return { hits: hits.map((g) => ({
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

  "GET /api/group/:id": async (u, id) => {
    const g = await groups.findFirst({ where: { groupId: Number(id) } });
    if (!g) return null;
    const limit = clamp(u.searchParams.get("limit"), 30, 200);
    const offset = clamp(u.searchParams.get("offset"), 0, 100000000);
    const ids = q.groupHadiths.all(g.groupId, limit, offset).map((r) => r.id);
    return { ...g, narrations: (await byIds(ids)).map(trim) };
  },

  // Isnad tree of a meaning group: all chains merged into one weighted DAG.
  // Edges follow transmission direction (Prophet ﷺ → sahabi → … → author).
  // ?sahabi=rawiId filters to chains passing through that companion.
  "GET /api/group/:id/tree": async (u, id) => {
    const rows = q.groupChains.all(Number(id));
    if (!rows.length) return null;
    const sahabiFilter = Number(u.searchParams.get("sahabi") || 0);

    const chains = new Map();
    for (const r of rows) {
      const c = chains.get(r.sanad_id) ?? { grade: r.grade, rawis: [] };
      c.rawis.push(r);           // pos ascending: 0 = author … last = sahabi
      chains.set(r.sanad_id, c);
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
    return {
      groupId: Number(id), chains: used, totalChains: chains.size,
      nodes: nodeList, edges: [...edges.values()],
      madar: madar ? { rawiId: madar.rawiId, name: madar.name, count: madar.middleCount } : null,
      sahabis,
    };
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
    return ragContext(qs, nGroups, perGroup);
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

server.listen(PORT, () =>
  console.log(`hadith-kg api on http://localhost:${PORT}  app=${APP_DB}  kg=${KG_DB}`),
);
