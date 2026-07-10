#!/usr/bin/env python3
"""Finalize hadith-kg.db if build_hkg.py was interrupted during its
validation phase (all bulk data + indexes are durable by then; the repair
pass, validation report and WAL switch are not).

Re-does, efficiently:
  1. broken narrator-link repair from sanad chains
  2. source cross-checks that were streamed in the build (salasil vs sanad)
  3. validation (single-pass aggregate queries instead of per-check scans)
  4. meta report + journal_mode=WAL
Safe to run repeatedly.
"""
import os
import sqlite3
import sys
import time

import bson

ROOT = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(ROOT, 'archive', 'hadithdb', 'hadith')
DB_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'hadith-kg.db')


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def stream(name):
    with open(os.path.join(DUMP, name + '.bson'), 'rb') as f:
        yield from bson.decode_file_iter(f)


def main():
    t0 = time.time()
    db = sqlite3.connect(DB_PATH)
    db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;'
                     'PRAGMA cache_size=-524288; PRAGMA temp_store=MEMORY;')
    q1 = lambda sql: db.execute(sql).fetchone()[0]
    report = {}

    rawi_ids = {r[0] for r in db.execute('SELECT id FROM rawis')}

    # ---- 1. repair broken narrator links ----------------------------------
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
                (chains[0][0],))][1:]
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
    db.commit()
    report['broken_link_hadiths'] = len(broken_hadiths)
    report['mentions_repaired_from_chain'] = repaired
    report['mentions_unrepairable'] = unrepaired
    log(f'  repaired {repaired}, unrepairable {unrepaired} across {len(broken_hadiths)} hadith')

    # ---- 2. source cross-checks (re-streamed from BSON) --------------------
    log('cross-checking salasil vs sanad from source ...')
    chains = {}
    for d in stream('salasil'):
        chains[d['id']] = d['rwat']
    mism = 0
    for d in stream('sanad'):
        exp = chains.get(d['id'])
        if exp is None or [int(x) for x in exp.split(',') if x] != list(d.get('rwat') or []):
            mism += 1
    report['salasil_rwat_mismatches'] = mism
    del chains

    log('cross-checking hadith.sanad_list coverage ...')
    listed = set()
    for d in stream('hadith'):
        for sid in d.get('sanad_list') or []:
            listed.add(sid)
    n_sanads = q1('SELECT COUNT(*) FROM sanads')
    report['sanads_not_in_any_sanad_list'] = n_sanads - len(listed)

    # ---- 3. validation (single-pass aggregates) ----------------------------
    log('validating ...')
    for t in ('books', 'rawis', 'alems', 'aqwal', 'meaning_groups', 'tarafs',
              'hadiths', 'hadith_rawis', 'hadith_ayas', 'sanads', 'sanad_rawis',
              'topics'):
        report[f'count_{t}'] = q1(f'SELECT COUNT(*) FROM {t}')

    row = db.execute("""
        SELECT SUM(book_id NOT IN (SELECT id FROM books)),
               SUM(type_no IN (0,1) AND group_id IS NULL),
               SUM(group_id IS NOT NULL AND group_id NOT IN (SELECT id FROM meaning_groups)),
               SUM(matn_start IS NULL)
        FROM hadiths""").fetchone()
    report['fk_hadith_book'], report['marfu_without_group'], \
        report['fk_hadith_group'], report['matn_span_missing'] = [x or 0 for x in row]

    row = db.execute("""
        SELECT SUM(rawi_id IS NULL),
               SUM(rawi_id IS NOT NULL AND rawi_id NOT IN (SELECT id FROM rawis))
        FROM hadith_rawis""").fetchone()
    report['mentions_still_null'], report['mentions_still_unknown_rawi'] = [x or 0 for x in row]

    report['fk_srawi_rawi'] = q1(
        'SELECT COALESCE(SUM(rawi_id NOT IN (SELECT id FROM rawis)),0) FROM sanad_rawis')
    report['fk_sanad_hadith'] = q1(
        'SELECT COALESCE(SUM(hadith_id NOT IN (SELECT id FROM hadiths)),0) FROM sanads')
    report['fk_aqwal_alem'] = q1(
        'SELECT COALESCE(SUM(alem_id NOT IN (SELECT id FROM alems)),0) FROM aqwal')
    report['fk_aqwal_rawi'] = q1(
        'SELECT COALESCE(SUM(rawi_id NOT IN (SELECT id FROM rawis)),0) FROM aqwal')
    report['fk_topic_parent'] = q1(
        'SELECT COALESCE(SUM(parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM topics)),0) FROM topics')
    report['fk_topic_group'] = q1(
        'SELECT COALESCE(SUM(group_id IS NOT NULL AND group_id NOT IN (SELECT id FROM meaning_groups)),0) FROM topics')
    report['group_without_hadith'] = q1(
        'SELECT COUNT(*) FROM meaning_groups g WHERE id > 0 AND NOT EXISTS'
        ' (SELECT 1 FROM hadiths h WHERE h.group_id = g.id)')

    # ---- 4. meta + WAL ------------------------------------------------------
    db.execute('DELETE FROM meta')
    db.executemany('INSERT INTO meta VALUES (?,?)', [
        ('source', 'mongodump hadithdb/hadith (2017-10-12) + rawa_cat.csv'),
        ('built_by', 'build_hkg.py + finalize_hkg.py'),
        ('sanad_rawis.pos', '0 = book author (musannif), ascending toward the sahabi'),
        ('offsets', 'hadith_rawis/hadith_ayas/matn_start are [start,end) char offsets into hadiths.nass'),
        *[(f'report.{k}', str(v)) for k, v in report.items()],
    ])
    db.commit()
    db.execute('PRAGMA journal_mode=WAL')
    db.close()

    log(f'done in {time.time() - t0:,.0f}s')
    for k, v in report.items():
        print(f'  {k}: {v}')
    hard_fail = (report['fk_sanad_hadith'] or report['fk_srawi_rawi']
                 or report['fk_hadith_book'] or report['salasil_rwat_mismatches'])
    print('BUILD ' + ('FAILED VALIDATION' if hard_fail else 'OK'))
    return 1 if hard_fail else 0


if __name__ == '__main__':
    sys.exit(main())
