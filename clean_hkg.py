#!/usr/bin/env python3
"""Post-build cleanup of hadith-kg.db (idempotent).

1. rawis.is_stub column: stub rows for narrator ids that appear in sanad
   chains but have no rawi biography in the source (25 ids). Names are
   harvested from the hadith-text mention anchors where possible.
2. Documents verified source semantics in meta:
   - sanads.length     = DISTINCT narrators in the chain (repeats count once)
   - sanads.max_rank   = max rank_no over the chain INCLUDING the author
   - meaning_groups.sahaba_qty / repeat_qty = legacy declared values from the
     Aug-2017 cat table; the corpus moved on by Oct-2017, so treat as
     approximate; compute live stats from sanads/hadiths for exact numbers.
   - hadith_rawis.rawi_id may reference ids with no rawis row (source used
     ids, e.g. 0, for narrators it never got to describe) — kept verbatim.
3. Refreshes the report in meta.
"""
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'hadith-kg.db')

db = sqlite3.connect(DB_PATH)
db.executescript('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;'
                 'PRAGMA cache_size=-262144; PRAGMA temp_store=MEMORY;')

cols = [r[1] for r in db.execute('PRAGMA table_info(rawis)')]
if 'is_stub' not in cols:
    db.execute('ALTER TABLE rawis ADD COLUMN is_stub INTEGER NOT NULL DEFAULT 0')

missing = [r[0] for r in db.execute(
    'SELECT DISTINCT sr.rawi_id FROM sanad_rawis sr'
    ' LEFT JOIN rawis r ON r.id = sr.rawi_id WHERE r.id IS NULL')]
print(f'chain narrator ids without rawi row: {len(missing)}')

made = 0
for rid in missing:
    row = db.execute(
        """SELECT SUBSTR(h.nass, hr.start + 1, hr.end - hr.start) name, COUNT(*) c
           FROM hadith_rawis hr JOIN hadiths h ON h.id = hr.hadith_id
           WHERE hr.rawi_id = ? GROUP BY name ORDER BY c DESC LIMIT 1""",
        (rid,)).fetchone()
    name = row[0] if row and row[0] and len(row[0]) < 120 else 'غير معرف'
    db.execute(
        'INSERT INTO rawis (id, name, nickname, rank_no, rank, tabaka,'
        ' is_bukhari, is_muslim, has_ikhtilat, has_tadlis, riwaya_qty, is_stub)'
        " VALUES (?,?,?,0,NULL,0,0,0,0,0,0,1)", (rid, name, name))
    made += 1
print(f'stub rawis created: {made}')

sem = [
    ('sanads.length', 'DISTINCT narrators in the chain (a repeated narrator counts once); 1,117 chains have a repeated narrator'),
    ('sanads.max_rank', 'max rank_no over the chain INCLUDING the author at pos 0'),
    ('meaning_groups.counts', 'sahaba_qty/repeat_qty are legacy declared values (Aug-2017 cat table); corpus drifted by Oct-2017 — compute live stats for exact numbers'),
    ('hadith_rawis.rawi_id', 'kept verbatim from source; may be NULL (unrepairable malformed href) or reference an id with no rawis row (e.g. 0 = never described)'),
    ('rawis.is_stub', '1 = placeholder created by clean_hkg.py for a chain narrator the source never described; name harvested from hadith text'),
]
db.executemany('INSERT OR REPLACE INTO meta VALUES (?,?)', sem)

fk = db.execute('SELECT COALESCE(SUM(rawi_id NOT IN (SELECT id FROM rawis)),0)'
                ' FROM sanad_rawis').fetchone()[0]
db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', ('report.fk_srawi_rawi', str(fk)))
db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)',
           ('report.count_rawis',
            str(db.execute('SELECT COUNT(*) FROM rawis').fetchone()[0])))
db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)',
           ('cleaned_at', time.strftime('%Y-%m-%d %H:%M')))
db.commit()
db.close()
print(f'fk_srawi_rawi after stubs: {fk}')
print('CLEAN ' + ('OK' if fk == 0 else 'INCOMPLETE'))
sys.exit(0 if fk == 0 else 1)
