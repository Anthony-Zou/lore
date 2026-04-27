# HN Wiki — Schema & Agent Instructions

This is a personal knowledge wiki seeded from Hacker News articles.
You are the wiki maintainer. Follow these rules at all times.

---

## Directory Layout

```
wiki/
├── CLAUDE.md          ← this file (schema + rules)
├── index.md           ← master table of all saved articles (auto-maintained)
├── log.md             ← ingest history, one line per event
├── sources/           ← one .md per saved HN article (hn-{id}.md)
├── concepts/          ← one .md per extracted concept/topic
└── people/            ← one .md per notable author or company
```

---

## Source Page Format (sources/hn-*.md)

Every source page has:
1. YAML frontmatter: hn_id, title, url, author, score, tags, saved_at, source
2. ## Connections — wikilinks to concept and people pages
3. ## Article Excerpt — first ~3000 chars of article text
4. ## Community Highlights — top HN comments
5. ## Notes — free-form personal annotations (human writes this)

---

## Concept Page Format (concepts/*.md)

```markdown
# <concept-name>

_One sentence definition._

## Key Ideas
- ...

## Saved Articles
- [[sources/hn-xxxxx]]

## Related Concepts
- [[concepts/related-topic]]
```

---

## People Page Format (people/*.md)

```markdown
# <Name>

Role / affiliation.

## Key Ideas
Summary of their thinking based on saved articles.

## Saved Articles
- [[sources/hn-xxxxx]]
```

---

## Operations

### Ingest (automated via server)
The Node.js server handles ingest automatically when you click "Save" in the Dashboard.
You don't need to ingest manually unless adding non-HN sources.

### Manual ingest
To add a non-HN source, drop a file into wiki/sources/ and tell Claude:
> "Ingest wiki/sources/<filename>"

Claude will: read the file, update index.md, create/update concept pages, append to log.md.

### Query
Ask any question. Claude reads wiki pages and synthesizes answers with citations.
Example: "What do the saved articles say about the future of AI agents?"

### Lint
Ask: "Lint the wiki"
Claude will:
- Find orphan pages (no incoming links)
- Find concept pages missing definitions
- Find contradictions between source summaries
- Suggest missing concept pages for frequently mentioned terms

---

## Wikilink Convention

Always use Obsidian-style double-bracket links:
- `[[sources/hn-12345]]` — links to a source page
- `[[concepts/ai-agents]]` — links to a concept page
- `[[people/andrej-karpathy]]` — links to a people page

---

## Tags in Use

| Tag | Description |
|-----|-------------|
| ai-ml | Artificial intelligence, machine learning, LLMs |
| startup | Startups, fundraising, Y Combinator |
| programming | Languages, frameworks, tools, open source |
| security | Vulnerabilities, privacy, cryptography |
| science | Research papers, physics, biology, space |
| business | Markets, acquisitions, company news |
| general | Uncategorized |

---

## Source Types

| source field | Meaning |
|---|---|
| `hacker-news` | Saved from HN Dashboard |
| `bloomberg` | From daily Bloomberg report (auto-ingested) |
| `manual` | Manually added |

---

## Bloomberg Report Pages (bloomberg/*.md)

Stored in `wiki/bloomberg/bloomberg-YYYY-MM-DD.md`.

Each page has:
1. YAML frontmatter: date, source, filename, ingested_at, top_call
2. ## 🔝 Top Call — most important single thing today
3. ## 📈 Market Snapshot — asset class table
4. ## 🌍 Core Themes — 3 key macro themes with market impact
5. ## 💡 Trade Ideas — structured: direction, target, logic, catalyst, risk
6. ## ⚠️ Position Signals — portfolio adjustment recommendations
7. ## ⚡ Strategy Summary — FX/equity/bond/commodity directional calls
8. ## 💱 FX — currency pair table
9. ## Notes — your personal annotations

### Bloomberg Wikilink convention
- `[[bloomberg/bloomberg-2026-04-26]]` — link to a specific day's report

### Cross-linking Bloomberg ↔ HN
When a Bloomberg theme matches an HN article topic, link them:
- In the Bloomberg page: add `[[sources/hn-xxxxx]]` to ## Connections
- In the HN source page: add `[[bloomberg/bloomberg-YYYY-MM-DD]]` to ## Connections

### Bloomberg Lint rules
- Each Trade Idea should eventually have a follow-up note (outcome)
- Top Calls older than 30 days should be marked `[RESOLVED]` or `[MISSED]`
- Recurring themes across multiple days should get a concept page, e.g. `[[concepts/ai-capex-cycle]]`

### Portfolio-specific tags

| Tag | Description |
|-----|-------------|
| bloomberg | All Bloomberg reports |
| market | Market data / price levels |
| trade-idea | Specific investment ideas |
| macro | Macro themes (inflation, rates, FX) |
| earnings | Company earnings events |
| central-bank | Fed/ECB/BOJ/BOE decisions |
