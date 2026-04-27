# Lore

**Turn anything you read into a Claude-queryable wiki.**

Lore starts with Hacker News. Save any story with one click — it becomes a structured Markdown file with the article excerpt, top comments, and auto-extracted tags. Open it in Obsidian. Ask Claude about it. Build your own knowledge base, one article at a time.

---

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/lore
cd lore
npm install
node server.js
# → http://localhost:3000
```

Requires **Node.js 18+**.

---

## How it works

1. Browse HN feeds (Top, New, Ask HN, Show HN, Jobs)
2. Click **☆ Save** on any story
3. Lore fetches the article text, top comments, and extracts topic tags
4. A structured Markdown file lands in `wiki/sources/`
5. Open `wiki/` as an Obsidian vault — or run `claude` inside it to query everything you've saved

```
wiki/
├── CLAUDE.md        ← schema for Claude Code
├── index.md         ← master table (auto-maintained)
├── log.md           ← ingest history
├── sources/         ← one file per saved article
└── concepts/        ← auto-generated topic pages
```

---

## Use with Claude Code

```bash
cd wiki
claude
```

Claude reads `CLAUDE.md` automatically and knows the full schema. Then:

- `"What do I know about AI agents?"` — cross-article synthesis
- `"Lint the wiki"` — find orphan pages, missing definitions
- `"Ingest raw/my-article.md"` — add any non-HN source

---

## Extensible by design

The wiki layer is source-agnostic. HN is the first parser. The same architecture accepts any structured input — RSS feeds, PDFs, financial reports, YouTube transcripts. Add a parser, point it at `wiki/`, done.

---

## API

| Route | Description |
|---|---|
| `GET /api/stories/:type` | HN feed (top/new/ask/show/job) |
| `POST /api/wiki/save` | Save story → wiki |
| `GET /api/wiki/list` | List saved entries |
| `GET /api/wiki/page/*` | Read a wiki page |
| `GET /api/wiki/events` | SSE stream for live updates |

---

## Stack

```
express    — HTTP server
cheerio    — article text extraction
nodemon    — dev hot-reload
```

No database. No API keys. No external services.
