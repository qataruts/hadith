# الجامع — Hadith Knowledge Graph

A knowledge graph and research platform for the sciences of hadith (علوم الحديث):
**715,790 hadith** from **425 classical collections**, **577,024 fully-linked isnad
chains**, **49,819 narrator biographies** with generation (tabaqa) and reliability
gradings, **127,863 narrator-criticism statements** (الجرح والتعديل) by 1,015
critics, **20,745 meaning groups** clustering every narration of one matn across
all books, and a **54,862-node subject tree** — all connected, all queryable.

On top of the graph: an Arabic-first web application with meaning-level semantic
search, interactive isnad-tree visualizations with automatic madār detection, and
a research chat that answers with numbered citations into the corpus.

## Highlights

- **Every element is a door** — narrator names inside the hadith text are linked
  entities (stored as character offsets, not markup); every hadith links to its
  meaning group; every meaning shows its companions, generations, and books.
- **شجرة الإسناد** — all transmission routes of one meaning merged into a single
  weighted DAG: Prophet ﷺ → companions → generations → book authors, edge
  thickness = number of routes, automatic **مدار الحديث** (pivot narrator)
  detection, per-companion route filtering.
- **Meaning-level semantic search** — 20,745 meaning-group embeddings
  (Gemini, 768-dim); queries are answered by *meaning*, with attestation-aware
  ranking. Practically free per query (one embedding call, no LLM tokens).
- **Cited research chat** — retrieval-augmented generation over the corpus,
  streamed answers with 【n】 citations that resolve to full hadith pages with
  their gradings; the answer always states each hadith's hukm.
- **Narrator dossiers** — biography, jarh-wa-ta'dil quotes linked to their
  critics, and teacher/student networks computed from 4.4M chain links.

## Architecture

```
BSON dump ──build_hkg.py──▶ hadith-kg.db      canonical relational KG (SQLite)
                │                │  scripts/embed-groups.mjs (vectors)
                │                ▼
                │      scripts/convert-to-app-db.mjs
                │                │
                ▼                ▼
         clean_hkg.py     hadith-app.db       app documents + Arabic FTS (monlite)
         audit_hkg.py            │
                                 ▼
                        server/server.mjs     zero-dependency node API
                                 │            (docs/FTS + graph queries + SSE chat)
                                 ▼
                        apps/dashboard        «الجامع» SPA (Vite, RTL, ~11 KB gz)
```

Two databases by design: the **canonical KG** (normalized, graph traversals,
embeddings) and the **app DB** ([monlite](https://github.com/emadjumaah/monlite)
document collections with FTS). The API server opens both.

## Data model (canonical KG)

| Table | Rows | Contents |
|---|---:|---|
| `books` | 425 | collection, author, era, category (tasnif) |
| `hadiths` | 715,790 | plain text + matn/aya/mention character offsets, type, grading, meaning group |
| `sanads` / `sanad_rawis` | 577K / 4.4M | every chain as ordered narrator links, per-chain hukm |
| `rawis` | 49,844 | narrators: tabaqa, grading, tadlis/ikhtilat flags, dates, places |
| `alems` / `aqwal` | 1,015 / 127,863 | critics and their statements on narrators |
| `meaning_groups` / `tarafs` | 20,745 | one row per hadith *meaning* |
| `topics` | 54,862 | nested-set subject hierarchy, leaves linked to meanings |
| `group_embedding` | 20,744 | 768-dim semantic vectors per meaning |

Text markup is relational: narrator mentions, matn boundaries, and Quran quotes
are `[start,end)` offsets into plain text — renderers rebuild rich text, and
matn-only slices feed search and embeddings directly.

> **Data availability:** both built databases are freely available as a public
> dataset — **https://huggingface.co/datasets/emadjumaah/hadith-kg**
> (`hadith-kg.db` ~1.6 GB, `hadith-app.db` ~2.9 GB, CC-BY-4.0). This project is
> offered as an open donation (صدقة جارية) for students and scholars of hadith.
> Only the raw 2017 source dump is not distributed.

## Build pipeline

```sh
# 1. canonical KG (needs pymongo for its bson module; build on local SSD)
python3 build_hkg.py /tmp/hadith-kg.db
python3 clean_hkg.py /tmp/hadith-kg.db     # narrator stubs + semantics metadata
python3 audit_hkg.py /tmp/hadith-kg.db     # → DATA_REPORT.md quality report

# 2. embeddings + app DB
cd js && pnpm install
GEMINI_API_KEY=... node scripts/embed-groups.mjs --db /tmp/hadith-kg.db
node --max-old-space-size=6144 scripts/convert-to-app-db.mjs /tmp/hadith-kg.db /tmp/hadith-app.db

# 3. serve (caches DBs to ~/.hadith-kg on local disk)
pnpm serve                                  # api + dashboard on :8077
```

Every stage validates itself (FK integrity, source cross-checks, repair
reports); results are stored in the DB `meta` table and `DATA_REPORT.md`.

## API

`GET` unless noted. All responses JSON; CORS enabled.

| Endpoint | Returns |
|---|---|
| `/api/stats` | corpus-wide counts and distributions |
| `/api/search/hadiths?q=` | Arabic FTS over matn (diacritics-normalized) |
| `/api/search/groups?q=` · `/api/search/rawis?q=` | FTS over meanings / narrator names |
| `/api/semantic/groups?q=` | meaning-level semantic search (embeddings) |
| `/api/rag/context?q=` | LLM-ready retrieval context (meanings + narrations) |
| `POST /api/chat` | retrieval + generation, SSE stream with cited sources |
| `/api/hadith/:id` | full hadith: text, offsets, chains with narrator info |
| `/api/group/:id` | meaning dashboard: books, companions, tabaqat |
| `/api/group/:id/tree` | isnad DAG: nodes, weighted edges, madār, companions |
| `/api/rawi/:id` (+`/hadiths`) | dossier: bio, criticism, teachers/students |
| `/api/alem/:id` · `/api/alems` | critics and their statements |
| `/api/book/:id` · `/api/books` | collections |
| `/api/topics?parent=` · `/api/topic/:id` | subject-tree navigation |

## Dashboard

```sh
cd js/apps/dashboard
pnpm install && pnpm dev    # http://localhost:5177 (proxies /api → :8077)
pnpm build                  # → dist/, served by the API server
```

Vanilla-JS SPA (no framework), hash routing, RTL, Amiri + IBM Plex Sans Arabic,
light/dark themes, ~12 KB gzipped. Charts follow a validated accessible palette;
gradings and narrator ranks always pair color with text.

## Desktop app (الجامع)

A cross-platform Electron build that runs the whole platform locally — no server
to host. It launches the API server as a child process and, on first run,
downloads the two databases from the Hugging Face dataset into the OS app-data
folder (resumable). A settings screen stores the user's own Gemini API key
(semantic search + chat; the rest works offline without it).

- Source: `js/apps/desktop/` (Electron shell) — reuses the server and dashboard unchanged.
- **Releases are built by CI**, not locally: push a tag and GitHub Actions builds
  macOS / Windows / Linux installers and attaches them to a Release.

  ```sh
  git tag v0.1.0 && git push origin v0.1.0
  ```

  `.github/workflows/desktop-release.yml` runs a `node:sqlite` preflight, builds
  the dashboard, installs flat production deps, and runs `electron-builder` on
  each OS. Manual runs (workflow_dispatch) build installers as artifacts without
  publishing.

## Operations notes

- SQLite must run on local SSD storage; network/HDD volumes stall on random I/O.
  The serve script caches DB files to `~/.hadith-kg/` automatically.
- Back up live databases with `sqlite3 live.db "VACUUM INTO 'backup.db'"` —
  never `cp` a database an open process is writing.
- `GEMINI_API_KEY` lives in `.env` (git-ignored) and is used server-side only.

## Roadmap (v2)

- **Āthār semantic tier** — embed the ~294K distinct mawqūf/maqṭūʿ taraf texts
  so companion/successor reports are searchable by meaning too (v1 covers all
  marfūʿ/qudsī hadith through their 20,744 meaning groups)
- Geographic transmission-flow and chronology visualizations
- I'tibar engine: automatic mutābaʿāt/shawāhid discovery; matn variant diff
- Narrator-network exploration; weakest-link chain analysis
- Expanded translations layer
