# HN Dashboard + LLM Wiki

A Hacker News reader that doubles as a personal knowledge base.
Browse top stories, read community highlights, and save articles to a structured wiki — all in one app.

---

## Quick Start

```bash
cd hn-dashboard
npm install
node server.js
# → http://localhost:3000
```

For hot-reload during development:
```bash
npm run dev
```

Requires **Node.js 18+** (uses native `fetch`).

---

## Features

| Feature | Description |
|---|---|
| 🔥 Live HN feeds | Top, New, Ask HN, Show HN, Jobs — refreshed every 5 min |
| 💬 Comment preview | See top comments without leaving the dashboard |
| 🔍 Search + filter | Filter by topic: AI, startup, programming, security, science, business |
| ⭐ Save to Wiki | One click saves a story → structured Markdown in `wiki/` |
| 📚 Wiki panel | See all saved articles in the right panel |
| 🔄 SSE updates | Real-time save status via Server-Sent Events |

---

## Wiki

Saved articles live in `wiki/` as Markdown files:

```
wiki/
├── CLAUDE.md        ← schema for Claude Code / Codex
├── index.md         ← master table (auto-maintained)
├── log.md           ← ingest history
├── sources/         ← one file per HN article
├── concepts/        ← auto-generated topic pages
└── people/          ← author / company pages
```

### Open in Obsidian

1. Install [Obsidian](https://obsidian.md) (free)
2. Open Obsidian → **Open folder as vault** → select `hn-dashboard/wiki/`
3. Hit Graph View to see your knowledge network

### Use with Claude Code / Codex

Open a terminal in `wiki/` and run Claude Code:
```bash
cd wiki
claude
```

Claude reads `CLAUDE.md` automatically and knows the full schema. Then:
- `"Lint the wiki"` — find orphan pages and contradictions
- `"What do I know about AI agents?"` — cross-article synthesis
- `"Ingest raw/my-article.md"` — add a non-HN source

---

## Adding Bloomberg Reports (coming soon)

Drop your daily Bloomberg report into `wiki/sources/bloomberg-YYYY-MM-DD.md`
and tell Claude: `"Ingest wiki/sources/bloomberg-2026-04-27.md"`.

Claude will extract key themes, update concept pages, and cross-link with HN articles.

---

## API Endpoints

| Route | Method | Description |
|---|---|---|
| `/api/stories/:type` | GET | HN feed (top/new/ask/show/job) |
| `/api/item/:id` | GET | Single HN item |
| `/api/comments/:id` | GET | Top-level comments |
| `/api/wiki/save` | POST | Save story to wiki |
| `/api/wiki/list` | GET | List saved entries |
| `/api/wiki/page/*` | GET | Read a wiki page |
| `/api/wiki/events` | GET | SSE stream for live updates |
| `/api/health` | GET | Health check |

---

## Dependencies

```
express      — HTTP server
cors         — CORS headers
cheerio      — HTML parsing for article text extraction
node-fetch   — fetch polyfill (Node < 18)
nodemon      — dev hot-reload (devDependency)
```

No database. No external services. No API keys required.
