# Roadmap — الجامع

Backlog distilled from three multi-agent reviews: feature-ideation (24 ideas),
the v1 release gate, and the isnad-graph audit. v1.0.0 shipped (desktop
installers + public Docker image).

## Shipped
- **v1.0.0** — canonical KG, monlite app DB + Arabic FTS, semantic search, cited
  RAG chat, dashboard, desktop app (mac/win/linux installers), Docker image on
  Docker Hub (`emadjumaah/hadith`), data public on Hugging Face.
- **Isnad graph** — grade-colored nodes, weakest-link colored edges; click a
  narrator → dossier card; click a line → popup of its narrations (with matn);
  filters (companion / grade / book / problems-only); expand-one (+N) and
  expand-all toggle; fullscreen, pan/zoom. Both meaning-group tree and per-hadith
  chain view. All self-explanatory in Arabic.
- **Teaching wins** — «لماذا هذا الحكم؟» grade-aware chain analysis; interactive
  glossary (tap any term for a definition).
- **Corpus scope** — pick active books (default top-30, presets الصحيحان/الستة/
  التسعة/الكل); search, graphs, narrations AND all counts/stats recompute within
  the selection. (Chat + narrator profiles still corpus-wide.)

- **Auto-i'tibar** ✓ — on any hadith page «الاعتبار»: pick the studied narrator
  from the reference chain, and every route of the meaning is bucketed into
  متابعة تامة (shares his shaykh) / قاصرة (agrees higher) / شاهد (other
  Companion). Verified classically correct on «إنما الأعمال بالنيات» (focus the
  madār يحيى → 11 متابعات تامة at his level).

- **Contact auditor** ✓ — «فحص الاتصال الزمني» on hadith pages: checks each
  isnad link's tabaqa/death-year for hidden breaks. Conservative (Mālik←Nāfiʿ
  stays clean); only born-after-teacher-died or explicit markers = confirmed.
- **Geo transmission map** ✓ — «مسار الانتقال الجغرافي» on meaning pages: a
  self-contained SVG (no tiles) placing cities by lat/lng, sized by narrator
  count, with weighted directional flow arcs from death_place/iqama.

- **v1.10.0** — **نبراس · الخلاصة النقدية** (hadith_audit): a synthesized critical
  dossier atop every hadith page, assembled in-process (Phase-0 `callApi`) from
  the recorded grade + i'tibar board + contact audit + per-sanad defects + the
  meaning's route-grade spread. Amiri headline + colour-coded signals (good/warn/
  bad), under the نبراس «قراءةٌ من الموسوعة لا فتوى» tag. Reads stored analysis
  only — issues no ruling. New: GET /api/nibras/audit/:id. (Also removed a stray
  🕸 emoji — the UI is now fully emoji-free.)
- **v1.9.0** — **نبراس · حارس الإسناد** (swarm rec #3, first slice): paste a
  circulating hadith/claim → the app searches the whole encyclopedia (FTS +
  literal token-coverage, works without a key) and reports its matched wording,
  book, grade, and the MEANING's full route-grade distribution — or plainly «لم
  أعثر عليه في هذه الموسوعة» (a coverage statement, never «لا أصل له»). Grade-
  first, cited, hedged, under a permanent «بياناتٌ من الموسوعة، لا فتوى» banner.
  Also Phase 0: an internal `callApi` call-path so higher Nibras phases can
  compose route handlers in-process. New: GET /api/nibras/check · pages/check.js.
- **v1.8.0** — **جسر القرآن ⇄ الحديث** (swarm rec #2): the Quranic quotes already
  highlighted inside hadith text (117,194 spans in `hadith_ayas`) now RESOLVE to a
  سورة:آية and link to the sibling Quran app مشكاة (quran.uts.qa/#/read/:sura/:aya).
  Resolution is a cheap parse of the literal «سورة X آية Y» label in the span
  against a 114-sura name→number map exported from the Quran project's DB — 99.8%
  resolve; the rest stay highlighted, just unlinked. The unique cross-project
  bridge (same owner holds both graphs). New: `shared/sura-map.mjs`, ayaRefs on
  `/api/hadith/:id`, linked spans in `renderNass`.
- **v1.7.0** — **تعارض الأحكام بين الطرق** at `#/conflicts` (swarm rec #1): a
  browsable, severity-sorted list of the 29,164 hadith whose isnads are graded
  differently (a matn sound from one route, weak from another) — the core علل
  teaching case. Severity = spread on the 0–5 grade scale (`sanads.matn_no`);
  defaults to gap≥2 to skip the routine one-degree cases (85 are the starkest
  صحيح↔موضوع). Scope-aware, framed as teaching not indictment. Backed by a lazy
  in-memory conflict index (warmed at startup) so browsing is instant. This is
  also the aggregation Nibras Phase 3 will consume.
- **v1.6.2** — the book scope now governs the WHOLE app consistently: search
  (text/group/semantic — with a candidate-pool fix so a narrow scope's matches
  aren't lost below the global top-N), the books page, rawi profiles (scoped
  narration count + hadith list), the i'tibar board, ICMA, and the quiz all
  respect the selected books. (Only person/record lookups where a book filter is
  meaningless stay corpus-wide: a critic's judgements, a rawi's bio, the topic
  taxonomy, a single-hadith view, and name search.)
- **v1.6.1** — polish: **normalized rawi search** (a lazy in-memory normalized
  index — «احمد»/«ابو هريره»/«يحيي» now match أحمد/أبو هريرة/يحيى — with no DB
  change or HF re-upload); **scroll-position restoration** on back-navigation
  (sessionStorage per hash). (Tree sink-tiering nuance deferred — low value,
  layout risk.)
- **v1.6.0** — **تحليل الإسناد والمتن (ICMA)** at `#/icma/:groupId`: correlates matn
  wording with isnad topology. Clusters routes by their exact (normalized) taraf,
  and for each wording carried by ≥2 routes finds the deepest narrator common to
  all of them — the point at which the wording was fixed and below which the
  routes branch. Reports «نقاء اللفظ» (purity = share of that narrator's routes
  carrying the wording) and an early/late era so attributions are honest: a
  high-purity EARLY narrator is a real transmission event; a late one is a
  compiler's line. Strictly descriptive — never overrides the recorded grade.
  Reachable from the meaning page and the i'tibar board.
- **v1.5.1** — every isnad now visibly ends in its **book**: the chain X-ray gets
  a gold book terminal above the author (with the number-in-book), and the merged
  graph labels each author leaf with the book(s) its routes land in (multi-book
  authors like النسائي show الصغرى + الكبرى).
- **v1.5.0** — **لوحة الاعتبار** (the i'tibar board): a purpose-built workbench at
  `#/board/:groupId` that fuses the merged isnad network with a group-level
  i'tibar. Picks the studied narrator (default = the madār, found by Juynboll's
  common-link rule: closest-to-Companion narrator whose traffic genuinely splits
  ≥15% to ≥3 transmitters), buckets every other route into متابعة تامة/قاصرة/شاهد,
  and issues a plain verdict (strong/medium/تفرّد). Corpus-wide by design.
  Verified on «إنما الأعمال»: madār يحيى بن سعيد → 11 متابعات تامة, 21 شواهد.
  Reached from every meaning and hadith page.
- **v1.4.1** — real app/installer icon + OG social card from the mihrab-arch mark.
- **v1.4.0** — visual identity overhaul: warm «مشكاة» manuscript palette (paper
  #f7f4ee / brown-ink #241f18 / emerald #0b6e56 / gold #a97e2f), Amiri for ALL
  headings + brand, a real logo mark (pointed mihrab arch enclosing converging
  isnad threads — الجامع = mosque + gathering of chains), SVG favicon + OG tags,
  and a consistent inline-SVG icon set replacing every emoji/glyph in the UI.
- **v1.3.0** — «الأفراد والغرائب» (network-wide tafarrud: singular-chain meanings
  with their weakest narrator, filterable by grade) · «احكم على السند» (grade-the-
  chain quiz) · home-page performance fix (scoped stats cached + warmed at
  startup: ~3.9s → instant) · «الموضوعات» → «المواضيع» in the nav.

## Design & branding (owner-requested — make it professional)
Design cues studied from the Quran app «مشكاة» (js/apps/studio/src/theme.css):
warm-paper canvas #f7f4ee, warm-brown ink #241f18, ONE emerald accent #0b6e56,
muted gold #a97e2f for illumination; Amiri used for ALL titles (calligraphic
headings — the key premium move); red avoided; signature gold-keyline "mushaf
page" frame; pill nav + docs-style omnibox search; three modes (light/dark/sepia).
- **Visual overhaul (الجامع)** — warmer palette, Amiri for headings not just body,
  gold illumination accents, a framed hadith-display component, refined spacing.
- **Logo / icon** — «الجامع» has a double meaning (the comprehensive collection +
  the congregational mosque الجامع). Natural icon: a mosque dome / mihrab arch,
  or converging isnad threads. Build full set: favicon, app/PWA icons, desktop
  installer icons, OG image. Currently only a 📚 emoji + generated geometric icon.

## Next up
- Reprioritize with owner. Candidates below (v1.1 polish + v2 features).

## Isnad-graph audit (2026-07-11) — feature ideas

From a 10-agent audit of the new grade-colored isnad X-ray + filters. All 5
confirmed bugs were fixed (rank-severity ordering, tree author-sinking, edge
endpoint filter blocker, popup listener leak, distinct-count cap).

**For students** (ranked by impact):
1. «لماذا هذا الإسناد ضعيف؟» — auto-explain WHY a chain is weak (weakest link, tadlis, inqita') · small
2. Interactive term glossary tooltips (تدليس، اختلاط، مدار، متابعة، شاهد، عنعنة) · small
3. Guided learning path — 10 stations from real data · medium
4. «احكم على السند» — grade-the-chain quiz mode · medium
5. Tabaqat timeline (narrators across generations) · medium
6. صحيح vs ضعيف of the same matn — side-by-side route comparison · medium
7. Highlight متابعة / شاهد on the isnad tree · medium

**For scholars** (ranked by impact):
1. Chronological inqita' auditor — birth/death overlap check on every adjacent pair · large
2. Performance-formula + mudallis-'an'ana detector · medium
3. Route ladder — weakest link per route, ranked · small
4. Auto-i'tibar classifier (متابعة تامة/قاصرة/شاهد) · medium
5. Matn variant diff across routes · medium
6. Jarh-wa-ta'dil aggregator + mukhtalaf-fih detector · medium
7. Publish-ready takhrij dossier export · medium
8. Network-wide tafarrud/gharabah detection · large

**Remaining polish (minors/UX from the audit):** keyboard access for +N pills &
edges; focus-into-popup; show all sahabis/books (not just top 6); touch targets
& pinch-zoom; distinguish the two color taxonomies (narrator-reliability vs
hadith-grade) for beginners; copy-citation number for books ≥1000; static
path-traversal guard hardening.

## v1.1 — polish (small, high value)

- **Normalized rawi search** — `/api/search/rawis` does raw `contains`; add a
  `nameClean` field (normalizeArabic) to the `rawis` collection at convert time
  and search against it. *Requires one app-DB reconvert (~9 min).*
- **Scroll restoration** — router scrolls to top on every navigation; restore
  position on back-navigation (sessionStorage per hash).
- **Isnad-tree layout nuance** — sink-to-bottom rule can mis-tier nodes whose
  children are pruned; recompute sinks against the *visible* subgraph.
- **Proxy support in desktop downloader** (undici ignores system proxy).
- **Code signing + auto-update** — Apple Developer ID / Windows cert, then
  electron-updater (macOS auto-update requires signed builds).

## v2 — the flagship features (from the ideation swarm, by wow-rank)

1. **I'tibar engine (10)** — select any hadith → automatic classical i'tibar:
   scan all chains in its meaning-group, label each as متابعة تامة (joins at
   the narrator's own shaykh), متابعة قاصرة (joins higher), or شاهد (different
   companion). Data: meaning groups + positional chain sequences. The single
   most scholar-valuable feature we can build.
2. **I'tibar board (10)** — the merged multi-variant isnad DAG as a workspace:
   variants clustered, joins/madār/tafarrud annotated in one view.
3. **ICMA engine (10, large)** — isnad-cum-matn analysis: where two branches of
   the tree carry different wordings, pin the divergence to the narrator at the
   fork. Builds on i'tibar board + matn diff.
4. **Matn variant diff (9)** — word-level diff of all narrations in a meaning
   group; زيادات glow, each reading tagged with route strength.
5. **Weakest-link chain X-ray (9)** — chains rendered with per-narrator grade
   coloring; the chain visually "breaks" at its weakest link; tadlis/ikhtilat
   warning badges.
6. **Madar radar + tafarrud alerts (9)** — "X is alone in transmitting this
   from Y" detection per meaning (counts above/below each node).
7. **Chronological contact auditor (9)** — for every adjacent chain pair, did
   the two lifetimes overlap? Flags hidden انقطاع using birth/death years.
8. **Geographic transmission flow map (9, large)** — hadith travel animated
   Medina → Kufa → Baghdad… from rawis.iqama/death_place + tabaqa timing.

## v2 — data expansion

- **Āthār semantic tier** — embed ~294K distinct mawqūf/maqṭūʿ taraf texts so
  companion/successor reports are searchable by meaning (v1 covers all marfūʿ
  through 20,744 meaning-group embeddings). Results labeled مرفوع vs أثر.
  ~14× the original embedding job; vectors likely want monlite vector plugin
  or quantization (~900 MB in RAM brute-force otherwise).
- Compressed first-run download (.gz halves the 4.5 GB) or lazy kg-DB fetch.

## Reference

- Ideas source: feature swarm 2026-07-10 (24 ideas; full pitches in session
  transcript). Release-gate swarm found 12 issues — all fixed in v1.0.0.
- Release process: bump `js/apps/desktop/package.json` version →
  `git tag vX.Y.Z && git push origin vX.Y.Z` (CI gates tag == version).
