/**
 * Convert the canonical relational HKG (hadith-kg.db) into an app-shaped
 * monlite database (hadith-app.db): document/structured collections + FTS,
 * ready for the API server, monlite studio, and any monlite consumer.
 *
 * This DB is SERVER-side (too large for browser wasm). Dashboard-critical
 * aggregations are precomputed here:
 *   groups  — per meaning: hadith/book/sahabi/tabaqat breakdowns  (FTS on nass)
 *   hadiths — full doc incl. chains with narrator names            (FTS on matn)
 *   rawis   — dossier: chain/hadith counts + jarh wa ta'dil embedded
 *
 * Usage:  node --max-old-space-size=6144 scripts/convert-to-app-db.mjs [src.db] [dest.db]
 * Run on a LOCAL SSD — /Volumes/data collapses under SQLite random I/O.
 */
import { DatabaseSync } from "node:sqlite";
import { createDb } from "@monlite/core";
import { fts } from "@monlite/fts";
import { SCHEMAS, normalizeArabic } from "../shared/monlite-schemas.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? path.resolve(HERE, "../../hadith-kg.db");
const DEST = process.argv[3] ?? path.resolve(HERE, "../../hadith-app.db");
const BATCH = 5000;

if (fs.existsSync(DEST)) fs.unlinkSync(DEST);
const src = new DatabaseSync(SRC, { readOnly: true });
const db = createDb(DEST, {
  plugins: [fts({ hadiths: ["matnClean"], groups: ["nassClean"] })],
});

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const all = (sql) => src.prepare(sql).all();
const iter = (sql) => src.prepare(sql).iterate();

// --- books, alems -----------------------------------------------------------
const books = db.collection("books", { schema: SCHEMAS.books });
await books.createMany({
  data: all("SELECT * FROM books ORDER BY id").map((r) => ({
    bookId: r.id, name: r.name, authorNo: r.author_no, authorName: r.author_name,
    authorDeathYear: r.author_death_year, tasnifNo: r.tasnif_no, tasnif: r.tasnif,
    hadithQty: r.hadith_qty, city: r.city, dar: r.dar, tabaa: r.tabaa,
  })),
});
log("books: 425");

const alems = db.collection("alems", { schema: SCHEMAS.alems });
const aqwalActual = new Map(
  all("SELECT alem_id, COUNT(*) c FROM aqwal GROUP BY alem_id").map((r) => [r.alem_id, r.c]),
);
await alems.createMany({
  data: all("SELECT * FROM alems ORDER BY id").map((r) => ({
    alemId: r.id, name: r.name, nickname: r.nickname, shuhra: r.shuhra,
    laqab: r.laqab, tabaka: r.tabaka, deathYear: r.death_year,
    rankNo: r.rank_no, rank: r.rank, aqwalQty: aqwalActual.get(r.id) ?? 0,
    notes: r.notes,
  })),
});
log("alems: 1,015");

// --- rawis (dossier: computed counts + aqwal embedded) ------------------------
const chainCount = new Map(
  all("SELECT rawi_id, COUNT(*) c FROM sanad_rawis WHERE pos > 0 GROUP BY rawi_id")
    .map((r) => [r.rawi_id, r.c]),
);
const hadithCount = new Map(
  all(`SELECT sr.rawi_id, COUNT(DISTINCT s.hadith_id) c FROM sanad_rawis sr
       JOIN sanads s ON s.id = sr.sanad_id WHERE sr.pos > 0 GROUP BY sr.rawi_id`)
    .map((r) => [r.rawi_id, r.c]),
);
const aqwalByRawi = new Map();
for (const r of iter(`SELECT q.rawi_id, q.alem_id, a.shuhra, q.qawl
                      FROM aqwal q JOIN alems a ON a.id = q.alem_id ORDER BY q.rawi_id, q.id`)) {
  const list = aqwalByRawi.get(r.rawi_id) ?? [];
  list.push({ alemId: r.alem_id, alem: r.shuhra, qawl: r.qawl });
  aqwalByRawi.set(r.rawi_id, list);
}
log("rawi aggregates ready");

const rawis = db.collection("rawis", { schema: SCHEMAS.rawis });
const rawiRows = all("SELECT * FROM rawis ORDER BY id");
const rawiInfo = new Map();  // for embedding into chains
for (const r of rawiRows)
  rawiInfo.set(r.id, { name: r.nickname, rank: r.rank, rankNo: r.rank_no, tabaka: r.tabaka });
for (let i = 0; i < rawiRows.length; i += BATCH) {
  await rawis.createMany({
    data: rawiRows.slice(i, i + BATCH).map((r) => ({
      rawiId: r.id, name: r.name, nickname: r.nickname, rankNo: r.rank_no,
      rank: r.rank, tabaka: r.tabaka, isBukhari: !!r.is_bukhari,
      isMuslim: !!r.is_muslim, hasIkhtilat: !!r.has_ikhtilat,
      hasTadlis: !!r.has_tadlis, isStub: !!r.is_stub,
      riwayaQtyDeclared: r.riwaya_qty,
      chainCount: chainCount.get(r.id) ?? 0,
      hadithCount: hadithCount.get(r.id) ?? 0,
      birthYear: r.birth_year, birthYearRaw: r.birth_year_raw,
      deathYear: r.death_year, deathYearRaw: r.death_year_raw,
      ageRaw: r.age_raw, profession: r.profession, nasab: r.nasab,
      iqama: r.iqama, deathPlace: r.death_place,
      aqwal: aqwalByRawi.get(r.id) ?? [],
    })),
  });
}
log(`rawis: ${rawiRows.length}`);
aqwalByRawi.clear();

// --- topics -------------------------------------------------------------------
const childCount = new Map(
  all("SELECT parent_id, COUNT(*) c FROM topics WHERE parent_id IS NOT NULL GROUP BY parent_id")
    .map((r) => [r.parent_id, r.c]),
);
const topics = db.collection("topics", { schema: SCHEMAS.topics });
const topicRows = all("SELECT * FROM topics ORDER BY id");
for (let i = 0; i < topicRows.length; i += BATCH) {
  await topics.createMany({
    data: topicRows.slice(i, i + BATCH).map((r) => ({
      topicId: r.id, name: r.name, parentId: r.parent_id, level: r.level,
      lft: r.lft, rgt: r.rgt, groupId: r.group_id,
      childCount: childCount.get(r.id) ?? 0,
    })),
  });
}
log(`topics: ${topicRows.length}`);

// --- groups (document mode, FTS on nassClean) ----------------------------------
// Precomputed per-meaning dashboards: the project's core feature.
const gHadiths = new Map(), gBooks = new Map(), gSahabis = new Map(),
      gTabaqat = new Map(), gTakhrij = new Map();
for (const r of iter(`SELECT group_id g, COUNT(*) c, COUNT(DISTINCT takhrij) t
                      FROM hadiths WHERE group_id IS NOT NULL GROUP BY group_id`)) {
  gHadiths.set(r.g, r.c);
  gTakhrij.set(r.g, r.t);
}
for (const r of iter(`SELECT h.group_id g, h.book_id b, MIN(bk.name) name, COUNT(*) c
                      FROM hadiths h JOIN books bk ON bk.id = h.book_id
                      WHERE h.group_id IS NOT NULL GROUP BY h.group_id, h.book_id`)) {
  const list = gBooks.get(r.g) ?? [];
  list.push({ bookId: r.b, name: r.name, count: r.c });
  gBooks.set(r.g, list);
}
log("group hadith/book aggregates ready");
for (const r of iter(`
    SELECT s.group_id g, sr.rawi_id rid, COUNT(*) c
    FROM sanads s
    JOIN sanad_rawis sr ON sr.sanad_id = s.id
    JOIN (SELECT sanad_id, MAX(pos) mp FROM sanad_rawis GROUP BY sanad_id) e
      ON e.sanad_id = sr.sanad_id AND e.mp = sr.pos
    JOIN rawis r ON r.id = sr.rawi_id AND r.rank = 'صحابي'
    WHERE s.group_id IS NOT NULL GROUP BY s.group_id, sr.rawi_id`)) {
  const list = gSahabis.get(r.g) ?? [];
  list.push({ rawiId: r.rid, name: rawiInfo.get(r.rid)?.name, count: r.c });
  gSahabis.set(r.g, list);
}
log("group sahabi aggregates ready");
for (const r of iter(`
    SELECT s.group_id g, r.tabaka t, COUNT(DISTINCT sr.rawi_id) c
    FROM sanads s
    JOIN sanad_rawis sr ON sr.sanad_id = s.id AND sr.pos > 0
    JOIN rawis r ON r.id = sr.rawi_id
    WHERE s.group_id IS NOT NULL GROUP BY s.group_id, r.tabaka`)) {
  const m = gTabaqat.get(r.g) ?? {};
  m[r.t] = r.c;
  gTabaqat.set(r.g, m);
}
log("group tabaqat aggregates ready");

const groups = db.collection("groups");
const groupRows = all("SELECT * FROM meaning_groups ORDER BY id");
for (let i = 0; i < groupRows.length; i += BATCH) {
  await groups.createMany({
    data: groupRows.slice(i, i + BATCH).map((r) => ({
      _id: `g${r.id}`,
      groupId: r.id,
      nass: r.nass,
      nassClean: normalizeArabic(r.nass),
      hukmNo: r.matn_no,
      isQudsi: !!r.is_qudsi,
      tarafId: r.taraf_id,
      declaredSahaba: r.sahaba_qty,
      declaredRepeat: r.repeat_qty,
      hadithCount: gHadiths.get(r.id) ?? 0,
      takhrijCount: gTakhrij.get(r.id) ?? 0,
      books: (gBooks.get(r.id) ?? []).sort((a, b) => b.count - a.count),
      sahabis: (gSahabis.get(r.id) ?? []).sort((a, b) => b.count - a.count),
      tabaqat: gTabaqat.get(r.id) ?? {},
    })),
  });
}
log(`groups: ${groupRows.length}`);
for (const m of [gHadiths, gBooks, gSahabis, gTabaqat, gTakhrij]) m.clear();

// --- hadiths (document mode, FTS on matnClean) ----------------------------------
// Chains embedded with narrator names so a hadith page renders in one read.
const chains = new Map();  // sanad_id -> [rawi_id, ...]  (pos ascending, 0 = author)
for (const r of iter("SELECT sanad_id, pos, rawi_id FROM sanad_rawis ORDER BY sanad_id, pos")) {
  const list = chains.get(r.sanad_id) ?? [];
  list.push(r.rawi_id);
  chains.set(r.sanad_id, list);
}
log(`chains loaded: ${chains.size}`);
const sanadsByHadith = new Map();
for (const r of iter("SELECT * FROM sanads ORDER BY hadith_id, id")) {
  const list = sanadsByHadith.get(r.hadith_id) ?? [];
  list.push(r);
  sanadsByHadith.set(r.hadith_id, list);
}
log(`sanads grouped: ${sanadsByHadith.size} hadith with chains`);

const mentionStmt = src.prepare(
  "SELECT seq, rawi_id, start, end FROM hadith_rawis WHERE hadith_id = ? ORDER BY seq");
const ayaStmt = src.prepare(
  "SELECT start, end FROM hadith_ayas WHERE hadith_id = ? ORDER BY seq");

const hadiths = db.collection("hadiths");
let n = 0;
let buf = [];
for (const r of iter("SELECT * FROM hadiths ORDER BY id")) {
  const matn = r.matn_start != null ? r.nass.slice(r.matn_start, r.matn_end) : r.nass;
  buf.push({
    _id: `h${r.id}`,
    hadithId: r.id,
    bookId: r.book_id,
    noInBook: r.no_inbook,
    page: r.page_no,
    type: r.type,
    typeNo: r.type_no,
    hukm: r.matn,
    hukmNo: r.matn_no,
    groupId: r.group_id,
    takhrij: r.takhrij,
    taraf: r.taraf_nass,
    nass: r.nass,
    matnStart: r.matn_start,
    matnEnd: r.matn_end,
    matnClean: normalizeArabic(matn),
    mentions: mentionStmt.all(r.id).map((m) => [m.rawi_id, m.start, m.end]),
    ayas: ayaStmt.all(r.id).map((a) => [a.start, a.end]),
    sanads: (sanadsByHadith.get(r.id) ?? []).map((s) => ({
      sanadId: s.id,
      hukm: s.hukum,
      grade: s.matn,
      maxRank: s.max_rank,
      length: s.length,
      chain: (chains.get(s.id) ?? []).map((rid, pos) => {
        const info = rawiInfo.get(rid) ?? {};
        return { rawiId: rid, pos, name: info.name, rank: info.rank, tabaka: info.tabaka };
      }),
    })),
  });
  if (buf.length >= BATCH) {
    await hadiths.createMany({ data: buf });
    buf = [];
    if (++n % 20 === 0) log(`  ${(n * BATCH).toLocaleString()} hadiths`);
  }
}
if (buf.length) await hadiths.createMany({ data: buf });
log("hadiths: 715,790");

// --- meta/stats singleton --------------------------------------------------------
const meta = db.collection("meta", { schema: SCHEMAS.meta });
const one = (sql) => Object.values(src.prepare(sql).get())[0];
await meta.create({
  data: {
    key: "stats",
    counts: {
      books: one("SELECT COUNT(*) FROM books"),
      hadiths: one("SELECT COUNT(*) FROM hadiths"),
      sanads: one("SELECT COUNT(*) FROM sanads"),
      chainLinks: one("SELECT COUNT(*) FROM sanad_rawis"),
      rawis: one("SELECT COUNT(*) FROM rawis WHERE is_stub = 0"),
      alems: one("SELECT COUNT(*) FROM alems"),
      aqwal: one("SELECT COUNT(*) FROM aqwal"),
      groups: one("SELECT COUNT(*) FROM meaning_groups WHERE id > 0"),
      topics: one("SELECT COUNT(*) FROM topics"),
    },
    types: all("SELECT type, COUNT(*) c FROM hadiths GROUP BY type ORDER BY c DESC"),
    grades: all("SELECT matn AS grade, COUNT(*) c FROM hadiths GROUP BY matn ORDER BY c DESC LIMIT 12"),
    tasnifs: all("SELECT tasnif, COUNT(*) books, SUM(hadith_qty) hadiths FROM books GROUP BY tasnif ORDER BY hadiths DESC"),
    tabaqat: all("SELECT tabaka, COUNT(*) c FROM rawis WHERE is_stub = 0 GROUP BY tabaka ORDER BY tabaka"),
    ranks: all("SELECT rank, COUNT(*) c FROM rawis WHERE is_stub = 0 AND rank IS NOT NULL GROUP BY rank ORDER BY c DESC LIMIT 15"),
    topRawis: all(`SELECT sr.rawi_id rawiId, MIN(r.nickname) name, COUNT(*) chains
                   FROM sanad_rawis sr JOIN rawis r ON r.id = sr.rawi_id
                   WHERE sr.pos > 0 GROUP BY sr.rawi_id ORDER BY chains DESC LIMIT 30`),
    topGroups: all(`SELECT group_id groupId, COUNT(*) narrations FROM hadiths
                    WHERE group_id IS NOT NULL GROUP BY group_id ORDER BY narrations DESC LIMIT 30`),
  },
});
log("meta/stats written");

// --- smoke checks ------------------------------------------------------------------
const nH = await hadiths.count();
const nG = await groups.count();
const hits = await hadiths.search(normalizeArabic("إنما الأعمال بالنيات"));
const g319 = await groups.findFirst({ where: { groupId: 319 } });
const h1 = await hadiths.findFirst({ where: { hadithId: 1 } });
console.log(`\nchecks: hadiths=${nH} groups=${nG} fts-hits=${hits.length}`);
console.log(`group 319: ${g319.hadithCount} narrations, ${g319.sahabis.length} sahabis, books=${g319.books.length}`);
console.log(`hadith 1: ${h1.sanads.length} sanad, chain=${h1.sanads[0].chain.map((c) => c.name).join(" ← ")}`);
if (nH !== 715790 || nG !== 20745) throw new Error("count mismatch!");
if (!hits.some((h) => h.hadithId === 1)) throw new Error("FTS smoke test failed!");

await db.$disconnect();
src.close();
log(`done -> ${DEST} (${(fs.statSync(DEST).size / 1e6).toFixed(1)} MB)`);
