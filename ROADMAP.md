# Roadmap — الجامع

Backlog distilled from two multi-agent reviews (2026-07-10): a feature-ideation
swarm (24 ranked ideas) and the v1 release gate. v1.0.0 shipped with all
confirmed bugs fixed and 10 scholar quick-wins included.

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
