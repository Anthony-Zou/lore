# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start server
node server.js          # http://localhost:3000
npm run dev             # hot-reload via nodemon

# Override Bloomberg watch directory
BLOOMBERG_DIR=/your/path node server.js
```

Requires Node.js 18+ (uses native `fetch`). No build step.

## Architecture

This is a single-file Express server (`server.js`) backed by three lib modules and a file-based wiki in `wiki/`.

### Data flow

1. **HN stories** → `lib/hnClient.js` fetches from `hacker-news.firebaseio.com/v0` with an in-memory TTL cache (5 min for feed IDs, 10 min for items, 2 min for comments).
2. **Article text** → `lib/fetcher.js` fetches the linked URL, strips HTML noise with cheerio, returns a `≤3000 char` excerpt. Also runs keyword-based tag extraction against `TAG_RULES`.
3. **Wiki ingest** → `lib/wikiEngine.js` orchestrates: fetch story + article + comments → build markdown source page → update `wiki/index.md` → create/update `wiki/concepts/*.md` backlinks → append to `wiki/log.md`.
4. **Bloomberg ingest** → `lib/bloombergWatcher.js` watches a directory for `bloomberg-YYYY-MM-DD.md` files, parses structured Chinese-language sections (using emoji anchors like `🔝`, `🌍`, `💡`), and writes to `wiki/bloomberg/`.
5. **SSE** → `wikiEngine` holds a `sseClients` Set; `bloombergWatcher` injects its broadcast via `setBroadcast()` on startup, sharing the same registry.

### Wiki directory layout

```
wiki/
├── CLAUDE.md          ← wiki schema & agent instructions (separate from this file)
├── index.md           ← master table, auto-maintained by wikiEngine + bloombergWatcher
├── log.md             ← append-only ingest history
├── sources/           ← hn-{id}.md, one per saved HN story
├── concepts/          ← auto-generated topic pages, Obsidian wikilinks
├── people/            ← author/company pages
└── bloomberg/         ← bloomberg-YYYY-MM-DD.md, one per ingested report
```

Source pages use YAML frontmatter (`hn_id`, `title`, `url`, `author`, `score`, `tags`, `saved_at`, `source`). Bloomberg pages use (`date`, `source`, `filename`, `ingested_at`, `top_call`).

### API surface

| Route | Notes |
|---|---|
| `GET /api/stories/:type` | `type` ∈ top/new/ask/show/job; `?limit=` max 200 |
| `GET /api/item/:id` | Single HN item |
| `GET /api/comments/:id` | Top-level comments; `?limit=` max 50 |
| `POST /api/wiki/save` | Body `{ storyId }` |
| `GET /api/wiki/list` | Parsed from `index.md` |
| `GET /api/wiki/page/*` | Raw markdown; path-traversal sanitized |
| `GET /api/wiki/events` | SSE stream |
| `GET /api/bloomberg/list` | Ingested reports, newest first |
| `GET /api/bloomberg/report/:slug` | Raw markdown for a report |
| `POST /api/bloomberg/ingest` | Body `{ filename }` — manual trigger |

### Key implementation details

- **No database.** All persistence is filesystem markdown in `wiki/`.
- **`_broadcastRaw`** on `wikiEngine` is a shim that lets `bloombergWatcher` write to the shared SSE client set without duplicating it.
- Bloomberg parser identifies sections by emoji anchors in heading text, not by position, so section order in source files doesn't matter.
- `fetcher.js` gracefully degrades if `cheerio` is missing (falls back to naive tag stripping).
- `wiki/CLAUDE.md` contains the wiki schema and instructions for Claude when running `claude` inside the `wiki/` directory.
