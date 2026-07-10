# HKG data-quality report

Generated 2026-07-09 23:18 by audit_hkg.py against hadith-kg.db.

## Build self-report (from meta)

- `broken_link_hadiths` = 6351
- `count_alems` = 1015
- `count_aqwal` = 127863
- `count_books` = 425
- `count_hadith_ayas` = 117194
- `count_hadith_rawis` = 3339040
- `count_hadiths` = 715790
- `count_meaning_groups` = 20745
- `count_rawis` = 49844
- `count_sanad_rawis` = 4414211
- `count_sanads` = 577024
- `count_tarafs` = 20745
- `count_topics` = 54862
- `fk_aqwal_alem` = 0
- `fk_aqwal_rawi` = 0
- `fk_hadith_book` = 0
- `fk_hadith_group` = 0
- `fk_sanad_hadith` = 0
- `fk_srawi_rawi` = 0
- `fk_topic_group` = 0
- `fk_topic_parent` = 0
- `group_without_hadith` = 461
- `marfu_without_group` = 522
- `matn_span_missing` = 1180
- `mentions_repaired_from_chain` = 1087
- `mentions_still_null` = 6302
- `mentions_still_unknown_rawi` = 2028
- `mentions_unrepairable` = 8309
- `salasil_rwat_mismatches` = 0
- `sanads_not_in_any_sanad_list` = 0

## Row counts

- books: 425
- rawis: 49,844
- alems: 1,015
- aqwal: 127,863
- meaning_groups: 20,745
- tarafs: 20,745
- hadiths: 715,790
- hadith_rawis: 3,339,040
- hadith_ayas: 117,194
- sanads: 577,024
- sanad_rawis: 4,414,211
- topics: 54,862

## Books: declared hadith_qty vs actual

0 of 425 books differ; top 10 by gap:


## Meaning groups

- groups where repeat_qty != COUNT(hadiths): 9,730 of 20,744
- groups with no hadith at all: 461
- hadiths whose group_id has no meaning_groups row: 0

## sahaba_qty spot check (10 most-narrated groups)

Computed = distinct chain-end narrators with rank صحابي across the group's sanads.

- group 2 (declared 68, computed 63): توضأ فغسل وجهه أخذ غرفة من ماء فمضمض بها واستنشق ثم أخذ غرفة…
- group 4 (declared 46, computed 41): إذا قمت إلى الصلاة فأسبغ الوضوء ثم استقبل القبلة فكبر ثم اقر…
- group 3 (declared 67, computed 60): يتوضأ فغسل وجهه ويديه ومسح برأسه ومسح على الخفين…
- group 1 (declared 68, computed 64): لا تكذبوا علي فإنه من كذب علي فليلج النار…
- group 5 (declared 44, computed 35): صلى لنا رسول الله ركعتين من بعض الصلوات ثم قام فلم يجلس فقام…
- group 6 (declared 38, computed 31): أقام النبي تسعة عشر يقصر فنحن إذا سافرنا تسعة عشر قصرنا وإن …
- group 8 (declared 54, computed 45): نهى رسول الله عن الدباء والحنتم والمقير والمزفت…
- group 9 (declared 24, computed 20): أن يجعلوها عمرة إلا من معه الهدي…
- group 7 (declared 58, computed 56): الله قد حرم على النار من قال لا إله إلا الله يبتغي بذلك وجه …
- group 21 (declared 20, computed 16): المزابنة بيع الثمر بالتمر كيلا بيع الزبيب بالكرم كيلا…

## Chain structure

- marfu/qudsi sanads whose chain END is not rank صحابي (mursal etc.): 17,811 of 577,024
- sanads.length disagreeing with DISTINCT narrators in chain: 60
- sanads.max_rank disagreeing with MAX(rank_no) incl. author: 0

## Inline mentions vs sanad chains

- hadith whose mention sequence exactly equals its single chain (minus author): 216,177 of 307,205 single-chain hadith

## Narrators

- same (name, nickname) narrator groups (homonyms — distinct persons sharing common names, NOT merge candidates; differ in tabaqa/teachers): 421
    - ids 29623,29625,29653,29655,44003,52756,58379,59699,70797,81316,82910: محمد بن عبد الله
    - ids 22289,22290,22292,40208,41224,53430,54857,68899,68954: عبد الله بن سعيد
    - ids 30025,42438,44928,45877,48757,53416,61804,66208,66426: محمد بن علي
    - ids 31018,40274,40745,45605,46058,47376,57265,61721,75166: محمد بن يزيد
    - ids 9248,9250,9253,36028,41024,44176,45644,51135: أبو عبد الرحمن
- stub narrators created by cleanup (chain ids the source never described): 25
- narrators in no chain, no mention, no aqwal: 89
- declared riwaya_qty vs actual chain appearances differing >10x: 1,988

## Jarh wa ta'dil

- duplicate (alem, rawi, qawl) triples: 6
- alems.aqwal_qty vs actual, differing: 135 of 1,015

## Topic tree

- children outside parent's nested-set interval: 0
- lft >= rgt nodes: 0
- nodes linked to a meaning group: 34,012 (invalid links: 0)

## Text spans

- hadith without matn span, by type:
    - مقطوع: 1,131
    - موقوف: 36
    - مرفوع: 12
    - قدسي: 1
- aya spans total: 117,194
