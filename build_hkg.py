#!/usr/bin/env python3
"""Build the canonical Hadith Knowledge Graph SQLite database (hadith-kg.db)
from the MongoDB dump at hadithdb/hadith/ (BSON, mongodump Oct 2017) plus the
meaning-groups table (rawa_cat.csv) from hadithData/data/.

Sources of truth
  hadithdb/hadith/*.bson       all collections (final form of the 2017 project)
  hadithData/data/rawa_cat.csv meaning groups (the `cat` table was never migrated
                               to Mongo; hadith.shawahid / mawadee.takhrij / taraf.shawahid
                               all reference this cat_id space — verified 2026-07-09)

Key semantics
  meaning group (cat/shawahid) one "meaning" of a hadith; clusters all narrations
                               of that meaning across all books
  takhrij                      narration-route cluster *within* a meaning group
  sanad_rawis.pos              0 = book author (musannif), ascending toward the sahabi
  hadiths.nass                 plain text (HTML stripped); the matn, Quran quotes and
                               inline narrator mentions are stored as [start,end)
                               character offsets into this plain text

Run:  python3 build_hkg.py [output.db]     (~25 min)
Requires pymongo (for its C-accelerated `bson`); everything else is stdlib.

IMPORTANT: /Volumes/data streams sequentially fine but collapses on random I/O
(SQLite's access pattern). Build to a LOCAL SSD path and copy the file back:
  python3 build_hkg.py /tmp/hadith-kg.db && mv /tmp/hadith-kg.db .
After building, run clean_hkg.py (stub narrators + semantics meta), then
audit_hkg.py (regenerates DATA_REPORT.md).
"""
import csv
import html
import os
import re
import sqlite3
import sys
import time

import bson

ROOT = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(ROOT, 'archive', 'hadithdb', 'hadith')
CAT_CSV = os.path.join(ROOT, 'archive', 'hadithData', 'data', 'rawa_cat.csv')
DB_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'hadith-kg.db')
BATCH = 10_000

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  author_no INTEGER NOT NULL,          -- author id in the alem/author numbering of the source
  author_name TEXT NOT NULL,
  author_death_year INTEGER,
  city TEXT, dar TEXT, tabaa TEXT,     -- edition info
  tasnif_no INTEGER NOT NULL,          -- book category (1=صحاح ومستخرجات ...)
  tasnif TEXT NOT NULL,
  hadith_qty INTEGER NOT NULL
);

CREATE TABLE rawis (                   -- narrators
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL,
  rank_no INTEGER NOT NULL,
  rank TEXT,                           -- ثقة / صدوق / ضعيف / صحابي ...
  tabaka INTEGER NOT NULL,             -- generation layer
  is_bukhari INTEGER NOT NULL,         -- narrated in Sahih al-Bukhari
  is_muslim INTEGER NOT NULL,
  has_ikhtilat INTEGER NOT NULL,
  has_tadlis INTEGER NOT NULL,
  riwaya_qty INTEGER NOT NULL,
  birth_year INTEGER,                  -- parsed when unambiguous, else NULL
  birth_year_raw TEXT,                 -- source string (may be a range like "40 - 20")
  death_year INTEGER,
  death_year_raw TEXT,
  age_raw TEXT,
  profession TEXT, nasab TEXT, iqama TEXT, death_place TEXT
);

CREATE TABLE alems (                   -- hadith critics (أئمة الجرح والتعديل)
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  shuhra TEXT NOT NULL,
  laqab TEXT,
  tabaka INTEGER NOT NULL,
  death_year INTEGER NOT NULL,
  rank_no INTEGER NOT NULL,
  rank TEXT,
  aqwal_qty INTEGER NOT NULL,
  notes TEXT
);

CREATE TABLE aqwal (                   -- jarh wa ta'dil statements: alem on rawi
  id INTEGER PRIMARY KEY,
  alem_id INTEGER NOT NULL REFERENCES alems(id),
  rawi_id INTEGER NOT NULL REFERENCES rawis(id),
  qawl TEXT NOT NULL
);

CREATE TABLE meaning_groups (          -- one row = one hadith "meaning" (source: cat table)
  id INTEGER PRIMARY KEY,
  taraf_id INTEGER,                    -- representative taraf
  is_qudsi INTEGER NOT NULL,
  matn_no INTEGER NOT NULL,            -- overall hukm (0=صحيح 1=حسن 2=ضعيف 3=شديد الضعف ...)
  sahaba_qty INTEGER NOT NULL,         -- distinct companions narrating this meaning (source-computed)
  repeat_qty INTEGER NOT NULL,         -- total occurrences across books (source-computed)
  nass TEXT NOT NULL                   -- normalized taraf text of the meaning
);

CREATE TABLE tarafs (                  -- أطراف: canonical opening phrases
  id INTEGER PRIMARY KEY,
  nass TEXT NOT NULL,
  matn_no INTEGER NOT NULL,
  matn TEXT NOT NULL,                  -- hukm label
  is_qudsi INTEGER NOT NULL,
  group_id INTEGER                     -- REFERENCES meaning_groups(id); NULL if unlinked
);

CREATE TABLE hadiths (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  no_inbook INTEGER NOT NULL,
  page_no INTEGER NOT NULL,
  type_no INTEGER NOT NULL,            -- 0=قدسي 1=مرفوع 2=موقوف 3=مقطوع
  type TEXT NOT NULL,
  matn_no INTEGER NOT NULL,            -- hukm code
  matn TEXT NOT NULL,                  -- hukm label (صحيح / حسن / ضعيف ...)
  group_id INTEGER,                    -- meaning group; NULL for موقوف/مقطوع
  takhrij INTEGER,                     -- narration-route cluster within the group
  taraf_nass TEXT,                     -- missing for 3 source rows
  nass TEXT NOT NULL,                  -- PLAIN text of the full hadith (sanad + matn)
  matn_start INTEGER, matn_end INTEGER -- offsets of the matn (span.nass) in nass
);

CREATE TABLE hadith_rawis (            -- inline narrator mentions, in text order
  hadith_id INTEGER NOT NULL REFERENCES hadiths(id),
  seq INTEGER NOT NULL,                -- 0-based order of appearance
  rawi_id INTEGER,                     -- NULL = malformed source href that could not be
                                       -- repaired from the sanad chain; a few ids also
                                       -- have no rawis row (source quirk, kept as-is)
  start INTEGER NOT NULL, end INTEGER NOT NULL,
  PRIMARY KEY (hadith_id, seq)
) WITHOUT ROWID;

CREATE TABLE hadith_ayas (             -- Quran quotes inside the hadith text
  hadith_id INTEGER NOT NULL REFERENCES hadiths(id),
  seq INTEGER NOT NULL,
  start INTEGER NOT NULL, end INTEGER NOT NULL,
  PRIMARY KEY (hadith_id, seq)
) WITHOUT ROWID;

CREATE TABLE sanads (                  -- one isnad (chain) of one hadith
  id INTEGER PRIMARY KEY,
  hadith_id INTEGER NOT NULL REFERENCES hadiths(id),
  matn_no INTEGER NOT NULL,
  matn TEXT NOT NULL,                  -- hukm label for this chain
  hukum TEXT NOT NULL,                 -- full hukm sentence on the isnad
  group_id INTEGER,                    -- meaning group (= hadith's)
  takhrij INTEGER,
  max_rank INTEGER,                    -- weakest narrator's rank_no in the chain (from source)
  length INTEGER                       -- chain length incl. author
);

CREATE TABLE sanad_rawis (             -- the chain itself
  sanad_id INTEGER NOT NULL REFERENCES sanads(id),
  pos INTEGER NOT NULL,                -- 0 = book author, ascending toward the sahabi
  rawi_id INTEGER NOT NULL REFERENCES rawis(id),
  PRIMARY KEY (sanad_id, pos)
) WITHOUT ROWID;

CREATE TABLE topics (                  -- موضوعات tree (nested set + parent)
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER,                   -- NULL for root
  level INTEGER NOT NULL,
  lft INTEGER NOT NULL, rgt INTEGER NOT NULL,
  tree_id INTEGER NOT NULL,
  group_id INTEGER                     -- leaf link to meaning_groups (source field: takhrij)
);
"""

INDEXES = """
CREATE INDEX idx_hadiths_book ON hadiths(book_id, no_inbook);
CREATE INDEX idx_hadiths_group ON hadiths(group_id);
CREATE INDEX idx_hadiths_takhrij ON hadiths(takhrij);
CREATE INDEX idx_sanads_hadith ON sanads(hadith_id);
CREATE INDEX idx_sanads_group ON sanads(group_id);
CREATE INDEX idx_sanad_rawis_rawi ON sanad_rawis(rawi_id);
CREATE INDEX idx_hadith_rawis_rawi ON hadith_rawis(rawi_id);
CREATE INDEX idx_aqwal_rawi ON aqwal(rawi_id);
CREATE INDEX idx_aqwal_alem ON aqwal(alem_id);
CREATE INDEX idx_tarafs_group ON tarafs(group_id);
CREATE INDEX idx_topics_parent ON topics(parent_id);
CREATE INDEX idx_topics_group ON topics(group_id);
CREATE INDEX idx_topics_lft ON topics(tree_id, lft);
CREATE INDEX idx_mg_taraf ON meaning_groups(taraf_id);
"""


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def stream(name):
    with open(os.path.join(DUMP, name + '.bson'), 'rb') as f:
        yield from bson.decode_file_iter(f)


def as_bool(v):
    if isinstance(v, bool):
        return int(v)
    return 1 if str(v).strip().lower() in ('t', 'true', '1') else 0


def parse_year(raw):
    """Return (int_or_None, raw_or_None). Only unambiguous integers are parsed."""
    if raw is None:
        return None, None
    s = str(raw).strip()
    if not s:
        return None, None
    return (int(s), s) if s.isdigit() else (None, s)


TAG_RE = re.compile(r'<a href="([^"]*)">|</a>|<span class="(nass|aya)">|</span>')
HREF_RE = re.compile(r'/rawi/(\d+)$')
WS_RE = re.compile(r'\s+')


def parse_nass(raw):
    """Strip markup, collapse whitespace; return (plain, mentions, matn_span, ayas).

    mentions: [(rawi_id, start, end)] in text order
    matn_span: (start, end) of span.nass or None
    ayas: [(start, end)] of span.aya
    Offsets are [start, end) into the returned plain string.
    """
    out = []          # plain text chunks
    length = 0        # current plain length
    pending_ws = False
    mentions, ayas = [], []
    matn_span = None
    stack = []        # open marks: [kind, payload, start]; start resolves lazily
                      # to the position of the next emitted character

    def emit(text):
        nonlocal length, pending_ws
        text = html.unescape(text)
        for i, piece in enumerate(WS_RE.split(text)):
            if i > 0 and length > 0:
                pending_ws = True
            if not piece:
                continue
            if pending_ws:
                out.append(' ')
                length += 1
                pending_ws = False
            for entry in stack:
                if entry[2] is None:
                    entry[2] = length
            out.append(piece)
            length += len(piece)

    pos = 0
    for m in TAG_RE.finditer(raw):
        emit(raw[pos:m.start()])
        pos = m.end()
        tok = m.group(0)
        if tok.startswith('<a '):
            href = HREF_RE.search(m.group(1))
            stack.append(['a', int(href.group(1)) if href else None, None])
        elif tok == '</a>':
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][0] == 'a':
                    _, rid, start = stack.pop(i)
                    if start is not None and length > start:
                        mentions.append((rid, start, length))
                    break
        elif tok.startswith('<span'):
            stack.append([m.group(2), None, None])
        else:  # </span>
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][0] in ('nass', 'aya'):
                    kind, _, start = stack.pop(i)
                    if start is None or length <= start:
                        break
                    if kind == 'nass':
                        matn_span = (start, length)
                    else:
                        ayas.append((start, length))
                    break
    emit(raw[pos:])
    return ''.join(out), mentions, matn_span, ayas


def main():
    t0 = time.time()
    if os.path.exists(DB_PATH):
        os.rename(DB_PATH, DB_PATH + '.bak')
        log(f"existing DB moved to {os.path.basename(DB_PATH)}.bak")
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
        PRAGMA cache_size=-524288; PRAGMA temp_store=MEMORY;
    """)
    db.executescript(SCHEMA)
    report = {}

    # ---- books, rawis, alems, aqwal, tarafs -------------------------------
    log('books ...')
    db.executemany(
        'INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [(d['id'], d['book_name'], d['author_no'], d['author_name'], d.get('death_year'),
          d.get('city'), d.get('dar'), d.get('tabaa'), d['tasnif_no'], d['tasnif'],
          d['hadith_qty']) for d in stream('book')])

    log('rawis ...')
    rawi_rows = []
    for d in stream('rawi'):
        by, byr = parse_year(d.get('birth_year'))
        dy, dyr = parse_year(d.get('death_year'))
        rawi_rows.append((
            d['id'], d['rawi_name'], d['rawi_nickname'], d['rank_no'], d.get('rank'),
            d['tabaka'], as_bool(d['bukhari']), as_bool(d['muslim']),
            as_bool(d['ikhtilat']), as_bool(d['tadlis']), d['riwaia_qty'],
            by, byr, dy, dyr, d.get('rawi_age'),
            d.get('profession'), d.get('nasab'), d.get('iqama'), d.get('death_place')))
    db.executemany(f"INSERT INTO rawis VALUES ({','.join('?' * 20)})", rawi_rows)
    rawi_ids = {r[0] for r in rawi_rows}
    del rawi_rows

    log('alems + aqwal ...')
    db.executemany(
        'INSERT INTO alems VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [(d['id'], d['alem_name'], d.get('alem_nickname'), d['alem_shuhra'],
          d.get('alem_laqab'), d['tabaka'], d['death_year'], d['rank_no'],
          d.get('rank'), d['aqual_qty'], d.get('notes')) for d in stream('alem')])
    db.executemany(
        'INSERT INTO aqwal VALUES (?,?,?,?)',
        [(d['id'], d['alem_no'], d['rawi_no'], d['qawl']) for d in stream('aqwal')])

    log('meaning_groups (rawa_cat.csv) ...')
    with open(CAT_CSV, encoding='utf-8') as f:
        db.executemany(
            'INSERT INTO meaning_groups VALUES (?,?,?,?,?,?,?)',
            [(int(r['cat_id']), int(r['taraf_id']) or None, as_bool(r['marfu_qudsi']),
              int(r['matn_id']), int(r['sahaba_qty']), int(r['repeat_qty']),
              r['taraf_nass']) for r in csv.DictReader(f)])
    group_ids = {r[0] for r in db.execute('SELECT id FROM meaning_groups')}

    log('tarafs ...')
    db.executemany(
        'INSERT INTO tarafs VALUES (?,?,?,?,?,?)',
        [(d['id'], d['taraf_nass'], d['matn_no'], d['matn'], as_bool(d['qudsi']),
          d['shawahid'] if d.get('shawahid') in group_ids else None)
         for d in stream('taraf')])

    log('topics (mawadee) ...')
    db.executemany(
        'INSERT INTO topics VALUES (?,?,?,?,?,?,?,?)',
        [(d['id'], d['maudu_name'], d['parent'] or None, d['level'],
          d['left'], d['right'], d['tree_id'], d.get('takhrij'))
         for d in stream('mawadee')])

    # ---- salasil first: chain metadata + verification data ----------------
    log('salasil (chain metadata pass) ...')
    chain_meta = {}   # sanad_id -> (takhrij, maxRank, sLength, rwat_csv)
    for d in stream('salasil'):
        chain_meta[d['id']] = (d['takhrij'], d['maxRank'], d['sLength'], d['rwat'])
    report['salasil_rows'] = len(chain_meta)

    # ---- hadiths ----------------------------------------------------------
    log('hadiths (715,790 — the long pass) ...')
    sanad_to_hadith = {}
    unknown_mention_rawis = set()
    h_rows, m_rows, a_rows = [], [], []
    n = 0
    for d in stream('hadith'):
        n += 1
        plain, mentions, matn_span, ayas = parse_nass(d['nass'])
        gid = d.get('shawahid')
        h_rows.append((
            d['id'], d['book_no'], d['hadith_no_inbook'], d['page_no'],
            d['type_no'], d['type'], d['matn_no'], d['matn'],
            gid if gid in group_ids else None, d.get('takhrij'),
            d.get('taraf_nass'), plain,
            matn_span[0] if matn_span else None,
            matn_span[1] if matn_span else None))
        for seq, (rid, s, e) in enumerate(mentions):
            m_rows.append((d['id'], seq, rid, s, e))
            if rid is not None and rid not in rawi_ids:
                unknown_mention_rawis.add(rid)
        for seq, (s, e) in enumerate(ayas):
            a_rows.append((d['id'], seq, s, e))
        for sid in d.get('sanad_list') or []:
            sanad_to_hadith[sid] = d['id']
        if len(h_rows) >= BATCH:
            db.executemany(f"INSERT INTO hadiths VALUES ({','.join('?' * 14)})", h_rows)
            db.executemany('INSERT INTO hadith_rawis VALUES (?,?,?,?,?)', m_rows)
            db.executemany('INSERT INTO hadith_ayas VALUES (?,?,?,?)', a_rows)
            h_rows, m_rows, a_rows = [], [], []
            if n % 100_000 == 0:
                log(f'  {n:,} hadiths')
    db.executemany(f"INSERT INTO hadiths VALUES ({','.join('?' * 14)})", h_rows)
    db.executemany('INSERT INTO hadith_rawis VALUES (?,?,?,?,?)', m_rows)
    db.executemany('INSERT INTO hadith_ayas VALUES (?,?,?,?)', a_rows)
    report['hadith_rows'] = n
    report['unknown_mention_rawi_ids'] = sorted(unknown_mention_rawis)

    # ---- sanads -----------------------------------------------------------
    log('sanads ...')
    s_rows, sr_rows = [], []
    n = rwat_mismatch = hadith_link_mismatch = orphan = 0
    for d in stream('sanad'):
        n += 1
        sid = d['id']
        meta_row = chain_meta.get(sid)
        rwat = list(d.get('rwat') or [])
        if meta_row:
            takhrij, max_rank, s_len, rwat_csv = meta_row
            if [int(x) for x in rwat_csv.split(',') if x] != rwat:
                rwat_mismatch += 1
        else:
            takhrij = max_rank = s_len = None
        hid = sanad_to_hadith.get(sid)
        if hid is None:
            orphan += 1
            hid = d['hadith_no']       # fall back to the sanad's own pointer
        elif hid != d['hadith_no']:
            hadith_link_mismatch += 1
        gid = d.get('shawahid')
        s_rows.append((sid, hid, d['matn_no'], d['matn'], d['hukum_nass'],
                       gid if gid in group_ids else None, takhrij, max_rank,
                       s_len if s_len is not None else len(rwat)))
        sr_rows.extend((sid, pos, rid) for pos, rid in enumerate(rwat))
        if len(s_rows) >= BATCH:
            db.executemany('INSERT INTO sanads VALUES (?,?,?,?,?,?,?,?,?)', s_rows)
            db.executemany('INSERT INTO sanad_rawis VALUES (?,?,?)', sr_rows)
            s_rows, sr_rows = [], []
            if n % 100_000 == 0:
                log(f'  {n:,} sanads')
    db.executemany('INSERT INTO sanads VALUES (?,?,?,?,?,?,?,?,?)', s_rows)
    db.executemany('INSERT INTO sanad_rawis VALUES (?,?,?)', sr_rows)
    report['sanad_rows'] = n
    report['salasil_rwat_mismatches'] = rwat_mismatch
    report['sanad_hadith_link_mismatches'] = hadith_link_mismatch
    report['sanads_not_in_any_sanad_list'] = orphan
    del chain_meta, sanad_to_hadith

    # ---- indexes + validation --------------------------------------------
    log('indexes ...')
    db.executescript(INDEXES)
    db.execute('ANALYZE')

    # ---- repair pass: broken inline narrator links -------------------------
    # The source has ~0.15% of <a href> links malformed (slash lost / id truncated,
    # e.g. "/rawi63") or pointing at ids with no rawis row. The sanad chain is the
    # authority: for a hadith with exactly one chain whose narrator count matches
    # the text mentions (chain minus the author at pos 0), and where every intact
    # mention agrees with its chain position, the broken mention's true id is the
    # chain value at that position.
    log('repairing broken narrator links from sanad chains ...')
    broken_hadiths = [r[0] for r in db.execute(
        'SELECT DISTINCT hadith_id FROM hadith_rawis WHERE rawi_id IS NULL'
        '  UNION '
        'SELECT DISTINCT h.hadith_id FROM hadith_rawis h'
        '  LEFT JOIN rawis r ON r.id = h.rawi_id'
        '  WHERE h.rawi_id IS NOT NULL AND r.id IS NULL')]
    repaired = unrepaired = 0
    fixes = []
    for hid in broken_hadiths:
        chains = db.execute('SELECT id FROM sanads WHERE hadith_id=?', (hid,)).fetchall()
        ments = db.execute('SELECT seq, rawi_id FROM hadith_rawis WHERE hadith_id=?'
                           ' ORDER BY seq', (hid,)).fetchall()
        chain = None
        if len(chains) == 1:
            chain = [r[0] for r in db.execute(
                'SELECT rawi_id FROM sanad_rawis WHERE sanad_id=? ORDER BY pos',
                (chains[0][0],))][1:]          # drop the author at pos 0
        ok = (chain is not None and len(ments) == len(chain) and all(
            rid is None or rid not in rawi_ids or rid == chain[i]
            for i, (_, rid) in enumerate(ments)))
        for i, (seq, rid) in enumerate(ments):
            if rid is None or rid not in rawi_ids:
                if ok:
                    fixes.append((chain[i], hid, seq))
                    repaired += 1
                else:
                    unrepaired += 1
    db.executemany('UPDATE hadith_rawis SET rawi_id=? WHERE hadith_id=? AND seq=?', fixes)
    report['mentions_repaired_from_chain'] = repaired
    report['mentions_unrepairable'] = unrepaired

    # single-pass aggregate validation: per-table scans with hash-lookup
    # subqueries, NOT per-check LEFT JOIN scans (30+ min on spinning disks)
    log('validating ...')
    q = lambda sql: db.execute(sql).fetchone()[0]
    for t in ('books', 'rawis', 'alems', 'aqwal', 'meaning_groups', 'tarafs',
              'hadiths', 'hadith_rawis', 'hadith_ayas', 'sanads', 'sanad_rawis',
              'topics'):
        report[f'count_{t}'] = q(f'SELECT COUNT(*) FROM {t}')
    checks = {}
    row = db.execute("""
        SELECT SUM(book_id NOT IN (SELECT id FROM books)),
               SUM(type_no IN (0,1) AND group_id IS NULL),
               SUM(matn_start IS NULL)
        FROM hadiths""").fetchone()
    checks['fk_hadith_book'], checks['marfu_without_group'], \
        checks['matn_span_missing'] = [x or 0 for x in row]
    row = db.execute("""
        SELECT SUM(rawi_id IS NULL),
               SUM(rawi_id IS NOT NULL AND rawi_id NOT IN (SELECT id FROM rawis))
        FROM hadith_rawis""").fetchone()
    checks['mentions_still_null'], checks['mentions_still_unknown_rawi'] = \
        [x or 0 for x in row]
    checks['fk_srawi_rawi'] = q('SELECT COALESCE(SUM(rawi_id NOT IN (SELECT id FROM rawis)),0) FROM sanad_rawis')
    checks['fk_sanad_hadith'] = q('SELECT COALESCE(SUM(hadith_id NOT IN (SELECT id FROM hadiths)),0) FROM sanads')
    checks['fk_aqwal_alem'] = q('SELECT COALESCE(SUM(alem_id NOT IN (SELECT id FROM alems)),0) FROM aqwal')
    checks['fk_aqwal_rawi'] = q('SELECT COALESCE(SUM(rawi_id NOT IN (SELECT id FROM rawis)),0) FROM aqwal')
    checks['fk_topic_parent'] = q('SELECT COALESCE(SUM(parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM topics)),0) FROM topics')
    checks['fk_topic_group'] = q('SELECT COALESCE(SUM(group_id IS NOT NULL AND group_id NOT IN (SELECT id FROM meaning_groups)),0) FROM topics')
    checks['group_without_hadith'] = q('SELECT COUNT(*) FROM meaning_groups g WHERE id>0 AND NOT EXISTS (SELECT 1 FROM hadiths h WHERE h.group_id=g.id)')
    report.update(checks)

    db.executemany('INSERT INTO meta VALUES (?,?)', [
        ('source', 'mongodump hadithdb/hadith (2017-10-12) + rawa_cat.csv'),
        ('built_by', 'build_hkg.py'),
        ('sanad_rawis.pos', '0 = book author (musannif), ascending toward the sahabi'),
        ('offsets', 'hadith_rawis/hadith_ayas/matn_start are [start,end) char offsets into hadiths.nass'),
        *[(f'report.{k}', str(v)) for k, v in report.items()],
    ])
    db.commit()
    db.execute('PRAGMA journal_mode=WAL')  # sane default for consumers
    db.close()

    log(f'done in {time.time() - t0:,.0f}s — {os.path.getsize(DB_PATH) / 1e9:.2f} GB')
    for k, v in report.items():
        print(f'  {k}: {v}')
    # fk_srawi_rawi is expectedly ~60 pre-clean (source never described 25
    # narrators used in chains); clean_hkg.py stubs them — not a build failure
    hard_fail = (checks['fk_sanad_hadith'] or checks['fk_hadith_book']
                 or report['salasil_rwat_mismatches'])
    print('BUILD ' + ('FAILED VALIDATION' if hard_fail else 'OK'))
    return 1 if hard_fail else 0


if __name__ == '__main__':
    sys.exit(main())
