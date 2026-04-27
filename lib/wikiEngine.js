'use strict';

const fs   = require('fs');
const path = require('path');
const { fetchArticle, extractTags } = require('./fetcher');
const { getItem, getComments }      = require('./hnClient');

const WIKI_DIR = path.join(__dirname, '..', 'wiki');
const SOURCES_DIR  = path.join(WIKI_DIR, 'sources');
const CONCEPTS_DIR = path.join(WIKI_DIR, 'concepts');
const PEOPLE_DIR   = path.join(WIKI_DIR, 'people');
const INDEX_PATH   = path.join(WIKI_DIR, 'index.md');
const LOG_PATH     = path.join(WIKI_DIR, 'log.md');

// SSE clients registry (set in server.js via registerSseClient)
const sseClients = new Set();

function registerSseClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { /* client disconnected */ }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDirs() {
  [WIKI_DIR, SOURCES_DIR, CONCEPTS_DIR, PEOPLE_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function timeAgo(unix) {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return ''; }
}

// ─── Index maintenance ───────────────────────────────────────────────────────

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) return [];
  const content = fs.readFileSync(INDEX_PATH, 'utf8');
  const lines = content.split('\n').filter(l => l.startsWith('| hn-'));
  return lines.map(l => {
    const cols = l.split('|').map(c => c.trim()).filter(Boolean);
    return { id: cols[0], title: cols[1], tags: cols[2], savedAt: cols[3] };
  });
}

function upsertIndex(entry) {
  const header = [
    '# HN Wiki — Saved Articles',
    '',
    '| ID | Title | Tags | Saved |',
    '|---|---|---|---|',
  ].join('\n');

  let rows = [];
  if (fs.existsSync(INDEX_PATH)) {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    rows = content.split('\n').filter(l => l.startsWith('| hn-'));
    // Remove existing entry for same id if re-saving
    rows = rows.filter(r => !r.startsWith(`| ${entry.id} |`));
  }

  rows.unshift(
    `| ${entry.id} | [${entry.title}](sources/${entry.id}.md) | ${entry.tags} | ${entry.savedAt} |`
  );

  fs.writeFileSync(INDEX_PATH, header + '\n' + rows.join('\n') + '\n');
}

function appendLog(msg) {
  const ts = new Date().toISOString();
  const line = `- \`${ts}\` ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

// ─── Concept pages ───────────────────────────────────────────────────────────

function ensureConceptPage(tag, linkedStoryId) {
  const filePath = path.join(CONCEPTS_DIR, `${tag}.md`);
  if (!fs.existsSync(filePath)) {
    const content = [
      `# ${tag}`,
      '',
      `_Auto-generated concept page._`,
      '',
      '## Saved Articles',
      '',
      `- [[sources/${linkedStoryId}]]`,
    ].join('\n') + '\n';
    fs.writeFileSync(filePath, content);
  } else {
    // Append backlink if not already present
    let content = fs.readFileSync(filePath, 'utf8');
    const link = `- [[sources/${linkedStoryId}]]`;
    if (!content.includes(link)) {
      content += `${link}\n`;
      fs.writeFileSync(filePath, content);
    }
  }
}

// ─── Source page ─────────────────────────────────────────────────────────────

function buildSourcePage(story, article, comments, tags) {
  const hnId     = `hn-${story.id}`;
  const domain   = getDomain(story.url || '');
  const tagsStr  = tags.length ? tags.join(', ') : 'general';
  const tagLinks = tags.map(t => `[[concepts/${t}]]`).join(', ') || '—';

  const topComments = comments
    .slice(0, 5)
    .map(c => {
      const txt = (c.text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      return `> **${c.by}** (${timeAgo(c.time)}): ${txt}…`;
    })
    .join('\n\n');

  const lines = [
    '---',
    `hn_id: ${story.id}`,
    `title: "${(story.title || '').replace(/"/g, "'")}"`,
    `url: ${story.url || ''}`,
    `domain: ${domain}`,
    `author: ${story.by || 'unknown'}`,
    `score: ${story.score || 0}`,
    `comments: ${story.descendants || 0}`,
    `tags: [${tagsStr}]`,
    `saved_at: ${new Date().toISOString()}`,
    `source: hacker-news`,
    '---',
    '',
    `# ${story.title}`,
    '',
    `**Source:** [${domain || story.url}](${story.url})  `,
    `**Author:** ${story.by || 'unknown'}  `,
    `**Score:** ▲ ${story.score || 0}  `,
    `**HN Discussion:** [comments (${story.descendants || 0})](https://news.ycombinator.com/item?id=${story.id})`,
    '',
    '## Connections',
    '',
    tagLinks,
    '',
    '## Article Excerpt',
    '',
    article.ok
      ? article.excerpt || '_No text extracted._'
      : `_Could not fetch article: ${article.error}_`,
    '',
    '## Community Highlights',
    '',
    topComments || '_No comments yet._',
    '',
    '## Notes',
    '',
    '_Your personal notes here._',
    '',
  ];

  return lines.join('\n');
}

// ─── Main ingest function ────────────────────────────────────────────────────

/**
 * Save a HN story to the wiki.
 * @param {number|string} storyId
 * @returns {Promise<{ ok: boolean, slug: string, tags: string[], error?: string }>}
 */
async function saveToWiki(storyId) {
  ensureDirs();

  const id = parseInt(storyId, 10);
  if (!id) return { ok: false, error: 'Invalid story ID' };

  const slug    = `hn-${id}`;
  const outPath = path.join(SOURCES_DIR, `${slug}.md`);

  broadcast('wiki:saving', { id, slug, status: 'fetching' });

  try {
    // 1. Fetch story metadata
    const story = await getItem(id);
    if (!story || !story.title) throw new Error('Story not found');

    // 2. Fetch full article text
    const article = await fetchArticle(story.url);

    // 3. Fetch top comments for community context
    const comments = await getComments(id, 10);

    // 4. Extract tags
    const tags = extractTags(story.title);

    // 5. Write source page
    const pageContent = buildSourcePage(story, article, comments, tags);
    fs.writeFileSync(outPath, pageContent, 'utf8');

    // 6. Update concept pages
    tags.forEach(tag => ensureConceptPage(tag, slug));

    // 7. Update index
    const savedAt = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    upsertIndex({ id: slug, title: story.title, tags: tags.join(', ') || 'general', savedAt });

    // 8. Append to log
    appendLog(`Ingested **[${story.title}](sources/${slug}.md)** (score: ${story.score}, tags: ${tags.join(', ') || 'general'})`);

    broadcast('wiki:saved', { id, slug, title: story.title, tags, savedAt });

    return { ok: true, slug, title: story.title, tags };

  } catch (err) {
    broadcast('wiki:error', { id, error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * List all saved wiki source pages (metadata from index).
 */
function listSaved() {
  return readIndex();
}

/**
 * Read a wiki page by relative path (e.g. "sources/hn-12345.md")
 */
function readPage(relPath) {
  const safe = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(WIKI_DIR, safe);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

// Allow bloomberg watcher (and other modules) to broadcast raw SSE messages
// through the same client registry without duplicating the Set.
function _broadcastRaw(msg) {
  for (const client of sseClients) {
    try { client.write(msg); } catch { /* client disconnected */ }
  }
}

module.exports = { saveToWiki, listSaved, readPage, registerSseClient, _broadcastRaw };
