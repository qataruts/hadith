---
language:
  - ar
license: cc-by-4.0
pretty_name: "الجامع — Hadith Knowledge Graph"
tags:
  - hadith
  - islam
  - arabic
  - knowledge-graph
  - sqlite
size_categories:
  - 100K<n<1M
---

# الجامع — Hadith Knowledge Graph (SQLite)

A knowledge graph of the sciences of hadith (علوم الحديث), offered openly as a
donation for students and scholars:

- **715,790 hadith** from **425 classical collections**
- **577,024 complete isnad chains** as ordered narrator links (4.4M edges)
- **49,819 narrator biographies** — tabaqa, reliability grading, tadlis/ikhtilat
  flags, dates and places
- **127,863 jarh-wa-ta'dil statements** by 1,015 critics, fully entity-linked
- **20,745 meaning groups** clustering every narration of one matn across books,
  with 768-dim Gemini embeddings for semantic search
- **54,862-node subject tree** linked down to the hadith level
- Hadith text stored as plain Arabic with **character-offset annotations** for
  narrator mentions, matn boundaries, and Quran quotes

## Files

| File | Size | What it is |
|---|---|---|
| `hadith-kg.db` | ~1.6 GB | Canonical relational knowledge graph (SQLite) — normalized tables, chains, criticism, topics, embeddings |
| `hadith-app.db` | ~2.9 GB | Application database ([monlite](https://github.com/emadjumaah/monlite)) — document collections + Arabic FTS, precomputed dashboards |

Open with any SQLite client. Table/semantics documentation lives in the `meta`
table of each database and in the project README.

## Application

The full open-source platform (API server, RTL dashboard with isnad-tree
visualizations, semantic search, cited RAG chat):
**https://github.com/qataruts/hadith**

## Notes for researchers

- `sanad_rawis.pos` = 0 is the collection author; the chain ascends to the
  companion; transmission direction is Prophet ﷺ → companion → … → author.
- `sanads.length` counts distinct narrators; `sanads.max_rank` includes the
  author. `meaning_groups.sahaba_qty`/`repeat_qty` are legacy declared values —
  compute live statistics from the chains for exact numbers.
- A small number of chain narrators are stubs (`rawis.is_stub = 1`) whose
  biographies were absent in the source; names were recovered from the hadith
  text itself.
