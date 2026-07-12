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
