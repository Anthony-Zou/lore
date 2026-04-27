'use strict';

/**
 * bloombergWatcher.js
 *
 * Watches a directory for new bloomberg-YYYY-MM-DD.md files,
 * parses the structured report format, and ingests them into the wiki.
 *
 * File format expected:
 *   # 📊 彭博社每日市场简报 — YYYY年M月D日
 *   ## 🔝 Top Call
 *   ## 📈 当日市场数据快照
 *   ## 🌍 核心主题（N个）
 *   ## 💱 外汇市场
 *   ## 📊 股票市场
 *   ## 📉 债券与利率
 *   ## 🛢️ 大宗商品
 *   ## 💡 交易机会（Idea Generation）
 *   ## ⚡ 交易策略总结
 */

const fs   = require('fs');
const path = require('path');

const WIKI_DIR    = path.join(__dirname, '..', 'wiki');
const REPORTS_DIR = path.join(WIKI_DIR, 'bloomberg');
const INDEX_PATH  = path.join(WIKI_DIR, 'index.md');
const LOG_PATH    = path.join(WIKI_DIR, 'log.md');

// SSE broadcast — injected from wikiEngine
let _broadcast = () => {};
function setBroadcast(fn) { _broadcast = fn; }

// ─── Directory setup ─────────────────────────────────────────────────────────

function ensureDirs() {
  [WIKI_DIR, REPORTS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Extract a section's content from the markdown by heading text.
 * Returns the text between this heading and the next same-level heading.
 */
function extractSection(md, headingEmoji, level = 2) {
  const prefix = '#'.repeat(level) + ' ';
  const lines  = md.split('\n');
  let inside = false;
  const collected = [];

  for (const line of lines) {
    if (line.startsWith(prefix)) {
      if (inside) break; // hit next same-level heading
      if (line.includes(headingEmoji)) { inside = true; continue; }
    }
    if (inside) collected.push(line);
  }

  return collected.join('\n').trim();
}

/**
 * Extract ALL level-2 sections as a map { heading → content }
 */
function extractAllSections(md) {
  const lines   = md.split('\n');
  const sections = {};
  let current   = null;
  let buf       = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current !== null) sections[current] = buf.join('\n').trim();
      current = line.replace('## ', '').trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) sections[current] = buf.join('\n').trim();

  return sections;
}

/**
 * Extract trade ideas from the 交易机会 section.
 * Returns array of { title, direction, target, logic, catalysts, risks }
 */
function extractTradeIdeas(md) {
  const section = extractSection(md, '💡');
  if (!section) return [];

  const ideas = [];
  const ideaBlocks = section.split(/\n###\s+/).filter(Boolean);

  for (const block of ideaBlocks) {
    const titleLine = block.split('\n')[0].trim();
    const direction  = (block.match(/\*\*方向\*\*[：:]\s*(.+)/) || [])[1]?.trim() || '';
    const target     = (block.match(/\*\*标的\*\*[：:]\s*(.+)/) || [])[1]?.trim() || '';
    const logicMatch = block.match(/\*\*逻辑\*\*[：:]\s*([\s\S]*?)(?=\n-\s*\*\*|$)/);
    const logic      = logicMatch ? logicMatch[1].trim().slice(0, 300) : '';
    const catalyst   = (block.match(/\*\*催化剂\*\*[：:]\s*(.+)/) || [])[1]?.trim() || '';
    const risk       = (block.match(/\*\*关键风险\*\*[：:]\s*(.+)/) || [])[1]?.trim() || '';

    if (titleLine) {
      ideas.push({ title: titleLine, direction, target, logic, catalyst, risk });
    }
  }

  return ideas;
}

/**
 * Extract the Top Call (single most important thing today).
 */
function extractTopCall(md) {
  const section = extractSection(md, '🔝');
  // First bold sentence is the headline
  const headline = (section.match(/\*\*(.+?)\*\*/) || [])[1] || '';
  return { headline, body: section.slice(0, 500) };
}

/**
 * Extract key themes.
 */
function extractThemes(md) {
  const section = extractSection(md, '🌍');
  const themes  = [];
  const blocks  = section.split(/\n###\s+/).filter(Boolean);
  for (const b of blocks) {
    const title = b.split('\n')[0].trim();
    const impact = (b.match(/\*\*市场影响判断\*\*[：:]?\s*([\s\S]*?)(?=\n---|\n##|$)/) || [])[1]?.trim().slice(0, 400) || '';
    if (title) themes.push({ title, impact });
  }
  return themes;
}

/**
 * Extract portfolio signals / position review section.
 */
function extractPositionSignals(md) {
  return extractSection(md, '⚠️').slice(0, 600);
}

/**
 * Extract strategy summary.
 */
function extractStrategySummary(md) {
  return extractSection(md, '⚡').slice(0, 800);
}

/**
 * Extract the date from the filename or the markdown title.
 */
function extractDate(filename, md) {
  // Try filename first: bloomberg-2026-04-26.md
  const fromFile = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (fromFile) return fromFile[1];

  // Try title line
  const fromTitle = md.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (fromTitle) {
    return `${fromTitle[1]}-${String(fromTitle[2]).padStart(2,'0')}-${String(fromTitle[3]).padStart(2,'0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

// ─── Wiki page builder ───────────────────────────────────────────────────────

function buildBloombergPage(date, filename, md) {
  const topCall     = extractTopCall(md);
  const themes      = extractThemes(md);
  const ideas       = extractTradeIdeas(md);
  const signals     = extractPositionSignals(md);
  const strategy    = extractStrategySummary(md);
  const sections    = extractAllSections(md);
  const marketSnap  = sections['📈 当日市场数据快照'] || sections[Object.keys(sections).find(k => k.includes('市场数据')) || ''] || '';
  const fxSection   = sections[Object.keys(sections).find(k => k.includes('外汇')) || ''] || '';

  const themeLines = themes.map(t =>
    `### ${t.title}\n${t.impact}`
  ).join('\n\n');

  const ideaLines = ideas.map(i =>
    `#### ${i.title}\n- **Direction**: ${i.direction}\n- **Target**: ${i.target}\n- **Logic**: ${i.logic}\n- **Catalyst**: ${i.catalyst}\n- **Risk**: ${i.risk}`
  ).join('\n\n');

  const lines = [
    '---',
    `date: ${date}`,
    `source: bloomberg`,
    `filename: ${filename}`,
    `ingested_at: ${new Date().toISOString()}`,
    `top_call: "${topCall.headline.replace(/"/g, "'")}"`,
    '---',
    '',
    `# Bloomberg Daily — ${date}`,
    '',
    '## 🔝 Top Call',
    '',
    topCall.body,
    '',
    '## 📈 Market Snapshot',
    '',
    marketSnap || '_See raw report._',
    '',
    '## 🌍 Core Themes',
    '',
    themeLines || '_No themes extracted._',
    '',
    '## 💡 Trade Ideas',
    '',
    ideaLines || '_No ideas extracted._',
    '',
    '## ⚠️ Position Signals',
    '',
    signals || '_No signals extracted._',
    '',
    '## ⚡ Strategy Summary',
    '',
    strategy || '_No summary extracted._',
    '',
    '## 💱 FX',
    '',
    fxSection || '_See raw report._',
    '',
    '## Connections',
    '',
    '[[index]]',
    '',
    '## Notes',
    '',
    '_Your annotations here._',
    '',
  ];

  return lines.join('\n');
}

// ─── Index & log maintenance ──────────────────────────────────────────────────

function upsertBloombergIndex(date, slug, topCallHeadline) {
  const HEADER = '# HN Wiki — Saved Articles\n\n| ID | Title | Tags | Saved |\n|---|---|---|---|';

  // Read existing data rows only (skip header lines)
  let rows = [];
  if (fs.existsSync(INDEX_PATH)) {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    rows = content.split('\n').filter(l => {
      if (!l.startsWith('| ')) return false;
      if (l.startsWith('| ID ') || l.startsWith('|---')) return false; // skip header rows
      return true;
    });
    rows = rows.filter(r => !r.includes(`| ${slug} |`)); // remove old entry for this slug
  }

  rows.unshift(
    `| ${slug} | [Bloomberg ${date}](bloomberg/${slug}.md) | bloomberg, market | ${date} |`
  );

  fs.writeFileSync(INDEX_PATH, HEADER + '\n' + rows.join('\n') + '\n');
}

function appendLog(msg) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `- \`${ts}\` ${msg}\n`);
}

// ─── Ingest one file ──────────────────────────────────────────────────────────

/**
 * Ingest a single bloomberg .md file into wiki/bloomberg/.
 * Returns { ok, slug, date, ideas }
 */
async function ingestFile(filePath) {
  ensureDirs();

  const filename = path.basename(filePath);
  if (!filename.endsWith('.md')) return { ok: false, error: 'Not a markdown file' };

  let md;
  try {
    md = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, error: `Cannot read file: ${e.message}` };
  }

  const date  = extractDate(filename, md);
  const slug  = `bloomberg-${date}`;
  const outPath = path.join(REPORTS_DIR, `${slug}.md`);

  _broadcast('bloomberg:ingesting', { slug, date, filename });

  try {
    const pageContent = buildBloombergPage(date, filename, md);
    fs.writeFileSync(outPath, pageContent, 'utf8');

    const topCall = extractTopCall(md);
    const ideas   = extractTradeIdeas(md);

    upsertBloombergIndex(date, slug, topCall.headline);
    appendLog(`Ingested Bloomberg report **[${date}](bloomberg/${slug}.md)** — Top Call: ${topCall.headline.slice(0,80)}`);

    _broadcast('bloomberg:saved', { slug, date, topCall: topCall.headline, ideasCount: ideas.length });

    return { ok: true, slug, date, topCall: topCall.headline, ideasCount: ideas.length };
  } catch (e) {
    _broadcast('bloomberg:error', { slug, error: e.message });
    return { ok: false, error: e.message };
  }
}

// ─── Directory watcher ────────────────────────────────────────────────────────

const processedFiles = new Set();

/**
 * Start watching a directory for new bloomberg-*.md files.
 * @param {string} watchDir  Absolute path to the daily-reports folder
 */
function startWatcher(watchDir) {
  if (!fs.existsSync(watchDir)) {
    console.warn(`[Bloomberg] Watch directory not found: ${watchDir}`);
    console.warn('[Bloomberg] Watcher will not start. Set BLOOMBERG_DIR env var to correct path.');
    return;
  }

  ensureDirs();

  console.log(`[Bloomberg] Watching: ${watchDir}`);

  // Ingest any existing unprocessed files on startup
  const existing = fs.readdirSync(watchDir).filter(f => f.match(/^bloomberg-\d{4}-\d{2}-\d{2}\.md$/));
  for (const f of existing) {
    const slug = f.replace('.md', '');
    const outPath = path.join(REPORTS_DIR, `${slug}.md`);
    if (!fs.existsSync(outPath)) {
      console.log(`[Bloomberg] Auto-ingesting existing file: ${f}`);
      ingestFile(path.join(watchDir, f));
    } else {
      processedFiles.add(f);
    }
  }

  // Watch for new files
  fs.watch(watchDir, { persistent: false }, (eventType, filename) => {
    if (!filename || !filename.match(/^bloomberg-\d{4}-\d{2}-\d{2}\.md$/)) return;
    if (processedFiles.has(filename)) return;

    const fullPath = path.join(watchDir, filename);

    // Small delay to ensure file write is complete
    setTimeout(() => {
      if (!fs.existsSync(fullPath)) return;
      processedFiles.add(filename);
      console.log(`[Bloomberg] New file detected: ${filename}`);
      ingestFile(fullPath);
    }, 500);
  });
}

// ─── List ingested reports ────────────────────────────────────────────────────

function listReports() {
  ensureDirs();
  if (!fs.existsSync(REPORTS_DIR)) return [];

  return fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .map(f => {
      const full = path.join(REPORTS_DIR, f);
      const content = fs.readFileSync(full, 'utf8');
      const dateMatch = f.match(/bloomberg-(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : '';
      const topCall = (content.match(/top_call: "(.+?)"/) || [])[1] || '';
      return { slug: f.replace('.md', ''), date, topCall, filename: f };
    });
}

/**
 * Read a specific bloomberg wiki page.
 */
function readReport(slug) {
  const filePath = path.join(REPORTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

module.exports = { startWatcher, ingestFile, listReports, readReport, setBroadcast };
