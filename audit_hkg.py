#!/usr/bin/env python3
"""Deep data-quality audit of hadith-kg.db → DATA_REPORT.md.

Read-only: reports source-data issues (and what the build already repaired)
without inventing corrections. Run after build_hkg.py.
"""
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1
                     else os.path.join(ROOT, 'hadith-kg.db'))
db.row_factory = sqlite3.Row
out = []
w = out.append


def q(sql, *args):
    return db.execute(sql, args).fetchall()


def q1(sql, *args):
    return db.execute(sql, args).fetchone()[0]


w(f"# HKG data-quality report\n\nGenerated {time.strftime('%Y-%m-%d %H:%M')} by audit_hkg.py against hadith-kg.db.\n")

w("## Build self-report (from meta)\n")
for r in q("SELECT key, value FROM meta WHERE key LIKE 'report.%' ORDER BY key"):
    w(f"- `{r['key'][7:]}` = {r['value']}")
w("")

w("## Row counts\n")
for t in ('books', 'rawis', 'alems', 'aqwal', 'meaning_groups', 'tarafs',
          'hadiths', 'hadith_rawis', 'hadith_ayas', 'sanads', 'sanad_rawis', 'topics'):
    w(f"- {t}: {q1('SELECT COUNT(*) FROM ' + t):,}")
w("")

w("## Books: declared hadith_qty vs actual\n")
rows = q("""SELECT b.id, b.name, b.hadith_qty, COUNT(h.id) AS actual
            FROM books b LEFT JOIN hadiths h ON h.book_id = b.id
            GROUP BY b.id HAVING b.hadith_qty != actual
            ORDER BY ABS(b.hadith_qty - actual) DESC""")
w(f"{len(rows)} of 425 books differ; top 10 by gap:\n")
for r in rows[:10]:
    w(f"- book {r['id']} {r['name']}: declared {r['hadith_qty']:,}, actual {r['actual']:,}")
w("")

w("## Meaning groups\n")
mism = q1("""SELECT COUNT(*) FROM meaning_groups g
             JOIN (SELECT group_id gid, COUNT(*) c FROM hadiths
                   WHERE group_id IS NOT NULL GROUP BY group_id) x ON x.gid = g.id
             WHERE g.repeat_qty != x.c""")
total = q1("SELECT COUNT(*) FROM meaning_groups WHERE id > 0")
empty = q1("""SELECT COUNT(*) FROM meaning_groups g WHERE id > 0
              AND NOT EXISTS (SELECT 1 FROM hadiths h WHERE h.group_id = g.id)""")
orphan_h = q1("""SELECT COUNT(*) FROM hadiths h LEFT JOIN meaning_groups g ON g.id = h.group_id
                 WHERE h.group_id IS NOT NULL AND g.id IS NULL""")
w(f"- groups where repeat_qty != COUNT(hadiths): {mism:,} of {total:,}")
w(f"- groups with no hadith at all: {empty:,}")
w(f"- hadiths whose group_id has no meaning_groups row: {orphan_h:,}")
w("")

w("## sahaba_qty spot check (10 most-narrated groups)\n")
w("Computed = distinct chain-end narrators with rank صحابي across the group's sanads.\n")
for r in q("""SELECT g.id, g.sahaba_qty, g.nass FROM meaning_groups g
              WHERE g.id > 0 ORDER BY g.repeat_qty DESC LIMIT 10"""):
    comp = q1("""SELECT COUNT(DISTINCT last.rawi_id) FROM sanads s
                 JOIN (SELECT sanad_id, rawi_id,
                              ROW_NUMBER() OVER (PARTITION BY sanad_id ORDER BY pos DESC) rn
                       FROM sanad_rawis) last ON last.sanad_id = s.id AND last.rn = 1
                 JOIN rawis r ON r.id = last.rawi_id
                 WHERE s.group_id = ? AND r.rank = 'صحابي'""", r['id'])
    w(f"- group {r['id']} (declared {r['sahaba_qty']}, computed {comp}): {r['nass'][:60]}…")
w("")

w("## Chain structure\n")
end_not_sahabi = q1("""SELECT COUNT(*) FROM sanads s
    JOIN hadiths h ON h.id = s.hadith_id AND h.type_no IN (0,1)
    JOIN (SELECT sanad_id, rawi_id,
                 ROW_NUMBER() OVER (PARTITION BY sanad_id ORDER BY pos DESC) rn
          FROM sanad_rawis) last ON last.sanad_id = s.id AND last.rn = 1
    JOIN rawis r ON r.id = last.rawi_id WHERE r.rank != 'صحابي'""")
marfu_sanads = q1("""SELECT COUNT(*) FROM sanads s
                     JOIN hadiths h ON h.id = s.hadith_id AND h.type_no IN (0,1)""")
len_mism = q1("""SELECT COUNT(*) FROM sanads s
    JOIN (SELECT sanad_id, COUNT(DISTINCT rawi_id) c FROM sanad_rawis GROUP BY sanad_id) x
    ON x.sanad_id = s.id WHERE s.length != x.c""")
rank_mism = q1("""SELECT COUNT(*) FROM sanads s JOIN
    (SELECT sr.sanad_id, MAX(r.rank_no) mr FROM sanad_rawis sr
     JOIN rawis r ON r.id = sr.rawi_id GROUP BY sr.sanad_id) x
    ON x.sanad_id = s.id WHERE s.max_rank IS NOT NULL AND s.max_rank != x.mr""")
w(f"- marfu/qudsi sanads whose chain END is not rank صحابي (mursal etc.): {end_not_sahabi:,} of {marfu_sanads:,}")
w(f"- sanads.length disagreeing with DISTINCT narrators in chain: {len_mism:,}")
w(f"- sanads.max_rank disagreeing with MAX(rank_no) incl. author: {rank_mism:,}")
w("")

w("## Inline mentions vs sanad chains\n")
agree = q1("""WITH one AS (SELECT hadith_id, MIN(id) sid FROM sanads
                           GROUP BY hadith_id HAVING COUNT(*) = 1),
    m AS (SELECT hadith_id, GROUP_CONCAT(rawi_id) sig FROM
          (SELECT hadith_id, rawi_id FROM hadith_rawis ORDER BY hadith_id, seq)
          GROUP BY hadith_id),
    c AS (SELECT one.hadith_id, GROUP_CONCAT(sr.rawi_id) sig FROM one
          JOIN sanad_rawis sr ON sr.sanad_id = one.sid AND sr.pos > 0
          GROUP BY one.hadith_id)
    SELECT COUNT(*) FROM m JOIN c ON c.hadith_id = m.hadith_id AND c.sig = m.sig""")
single = q1("SELECT COUNT(*) FROM (SELECT hadith_id FROM sanads GROUP BY hadith_id HAVING COUNT(*) = 1)")
w(f"- hadith whose mention sequence exactly equals its single chain (minus author): {agree:,} of {single:,} single-chain hadith")
w("")

w("## Narrators\n")
dup = q("""SELECT name, nickname, COUNT(*) c, GROUP_CONCAT(id) ids FROM rawis
           WHERE is_stub = 0
           GROUP BY name, nickname HAVING c > 1 ORDER BY c DESC""")
w(f"- same (name, nickname) narrator groups (homonyms — distinct persons sharing "
  f"common names, NOT merge candidates; differ in tabaqa/teachers): {len(dup)}")
for r in dup[:5]:
    w(f"    - ids {r['ids']}: {r['nickname']}")
w(f"- stub narrators created by cleanup (chain ids the source never described): "
  f"{q1('SELECT COUNT(*) FROM rawis WHERE is_stub = 1'):,}")
unused = q1("""SELECT COUNT(*) FROM rawis r WHERE
    NOT EXISTS (SELECT 1 FROM sanad_rawis WHERE rawi_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM hadith_rawis WHERE rawi_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM aqwal WHERE rawi_id = r.id)""")
qty_off = q1("""SELECT COUNT(*) FROM rawis r JOIN
    (SELECT rawi_id, COUNT(*) c FROM sanad_rawis GROUP BY rawi_id) x
    ON x.rawi_id = r.id
    WHERE r.riwaya_qty > 0 AND (x.c > r.riwaya_qty * 10 OR r.riwaya_qty > x.c * 10)""")
w(f"- narrators in no chain, no mention, no aqwal: {unused:,}")
w(f"- declared riwaya_qty vs actual chain appearances differing >10x: {qty_off:,}")
w("")

w("## Jarh wa ta'dil\n")
dup_aqwal = q1("""SELECT COUNT(*) - COUNT(DISTINCT alem_id || '-' || rawi_id || '-' || qawl)
                  FROM aqwal""")
alem_qty_off = q1("""SELECT COUNT(*) FROM alems a JOIN
    (SELECT alem_id, COUNT(*) c FROM aqwal GROUP BY alem_id) x
    ON x.alem_id = a.id WHERE a.aqwal_qty != x.c""")
w(f"- duplicate (alem, rawi, qawl) triples: {dup_aqwal:,}")
w(f"- alems.aqwal_qty vs actual, differing: {alem_qty_off:,} of {q1('SELECT COUNT(*) FROM alems'):,}")
w("")

w("## Topic tree\n")
bad_nest = q1("""SELECT COUNT(*) FROM topics c JOIN topics p ON p.id = c.parent_id
                 WHERE c.tree_id = p.tree_id AND NOT (c.lft > p.lft AND c.rgt < p.rgt)""")
bad_lr = q1("SELECT COUNT(*) FROM topics WHERE lft >= rgt")
linked = q1("SELECT COUNT(*) FROM topics WHERE group_id IS NOT NULL")
bad_link = q1("""SELECT COUNT(*) FROM topics t LEFT JOIN meaning_groups g ON g.id = t.group_id
                 WHERE t.group_id IS NOT NULL AND g.id IS NULL""")
w(f"- children outside parent's nested-set interval: {bad_nest:,}")
w(f"- lft >= rgt nodes: {bad_lr:,}")
w(f"- nodes linked to a meaning group: {linked:,} (invalid links: {bad_link:,})")
w("")

w("## Text spans\n")
w("- hadith without matn span, by type:")
for r in q("""SELECT type, COUNT(*) c FROM hadiths WHERE matn_start IS NULL
              GROUP BY type ORDER BY c DESC"""):
    w(f"    - {r['type']}: {r['c']:,}")
w(f"- aya spans total: {q1('SELECT COUNT(*) FROM hadith_ayas'):,}")
w("")

report = '\n'.join(out)
path = os.path.join(ROOT, 'DATA_REPORT.md')
with open(path, 'w') as f:
    f.write(report)
print(report)
print(f"\nwritten to {path}")
