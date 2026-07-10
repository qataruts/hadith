/**
 * Collection schemas for hadith-app.db (monlite).
 *
 * monlite structured collections must be opened with the same schema
 * everywhere — the converter that creates them and every consumer (Node,
 * studio, API server). Import from here; never inline.
 *
 * `hadiths` and `groups` are intentionally NOT here: they are document-mode
 * collections (the fts() plugin opens them at init, which fixes their mode).
 */
export const SCHEMAS = {
  books: {
    bookId: { type: "INTEGER", unique: true },
    name: "TEXT",
    authorNo: { type: "INTEGER", index: true },
    authorName: "TEXT",
    authorDeathYear: "INTEGER",
    tasnifNo: { type: "INTEGER", index: true },
    tasnif: "TEXT",
    hadithQty: "INTEGER",
    city: "TEXT",
    dar: "TEXT",
    tabaa: "TEXT",
  },
  rawis: {
    rawiId: { type: "INTEGER", unique: true },
    name: { type: "TEXT", index: true },
    nickname: { type: "TEXT", index: true },
    rankNo: { type: "INTEGER", index: true },
    rank: "TEXT",
    tabaka: { type: "INTEGER", index: true },
    isBukhari: "BOOLEAN",
    isMuslim: "BOOLEAN",
    hasIkhtilat: "BOOLEAN",
    hasTadlis: "BOOLEAN",
    isStub: "BOOLEAN",
    riwayaQtyDeclared: "INTEGER",
    chainCount: { type: "INTEGER", index: true },
    hadithCount: "INTEGER",
    birthYear: "INTEGER",
    birthYearRaw: "TEXT",
    deathYear: "INTEGER",
    deathYearRaw: "TEXT",
    ageRaw: "TEXT",
    profession: "TEXT",
    nasab: "TEXT",
    iqama: "TEXT",
    deathPlace: "TEXT",
    aqwal: { type: "JSON" },
  },
  alems: {
    alemId: { type: "INTEGER", unique: true },
    name: "TEXT",
    nickname: "TEXT",
    shuhra: { type: "TEXT", index: true },
    laqab: "TEXT",
    tabaka: { type: "INTEGER", index: true },
    deathYear: "INTEGER",
    rankNo: "INTEGER",
    rank: "TEXT",
    aqwalQty: "INTEGER",
    notes: "TEXT",
  },
  topics: {
    topicId: { type: "INTEGER", unique: true },
    name: "TEXT",
    parentId: { type: "INTEGER", index: true },
    level: { type: "INTEGER", index: true },
    lft: { type: "INTEGER", index: true },
    rgt: "INTEGER",
    groupId: { type: "INTEGER", index: true },
    childCount: "INTEGER",
  },
  meta: {
    key: { type: "TEXT", unique: true },
  },
};

/** Open a collection with its canonical schema. */
export function coll(db, name) {
  return db.collection(name, SCHEMAS[name] ? { schema: SCHEMAS[name] } : undefined);
}

/**
 * Normalize Arabic for search indexing: strip tashkeel/tatweel/Quranic marks,
 * unify alef variants, alef-maqsura → ya, ta-marbuta → ha.
 */
const STRIP = /[ً-ْٰـۖ-ۭؐ-ؚ]/g;
export function normalizeArabic(s) {
  return s
    .replace(STRIP, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}
