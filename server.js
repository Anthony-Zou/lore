'use strict';

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const hn         = require('./lib/hnClient');
const wiki       = require('./lib/wikiEngine');
const bloomberg  = require('./lib/bloombergWatcher');

const app  = express();
const PORT = process.env.PORT || 3000;

// Bloomberg daily-reports directory.
// Override with: BLOOMBERG_DIR=/your/path node server.js
const BLOOMBERG_DIR = process.env.BLOOMBERG_DIR ||
  path.join(process.env.HOME || '', 'Documents', 'Claude', 'Projects', 'Zous', 'daily-reports');

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── HN API routes ───────────────────────────────────────────────────────────

/**
 * GET /api/stories/:type
 * Returns up to 100 full story objects for the given feed type.
 * Query params: ?limit=50
 */
app.get('/api/stories/:type', async (req, res) => {
  const { type } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);

  const valid = ['top', 'new', 'ask', 'show', 'job'];
  if (!valid.includes(type)) {
    return res.status(400).json({ error: `Unknown type. Must be one of: ${valid.join(', ')}` });
  }

  try {
    const stories = await hn.getStories(type, limit);
    res.json({ type, count: stories.length, stories });
  } catch (err) {
    console.error('[/api/stories]', err.message);
    res.status(502).json({ error: 'Failed to fetch stories', detail: err.message });
  }
});

/**
 * GET /api/item/:id
 * Returns a single HN item.
 */
app.get('/api/item/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });

  try {
    const item = await hn.getItem(id);
    res.json(item);
  } catch (err) {
    console.error('[/api/item]', err.message);
    res.status(502).json({ error: 'Failed to fetch item', detail: err.message });
  }
});

/**
 * GET /api/comments/:id
 * Returns top-level comments for a story.
 * Query params: ?limit=20
 */
app.get('/api/comments/:id', async (req, res) => {
  const id    = parseInt(req.params.id);
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });

  try {
    const comments = await hn.getComments(id, limit);
    res.json({ storyId: id, count: comments.length, comments });
  } catch (err) {
    console.error('[/api/comments]', err.message);
    res.status(502).json({ error: 'Failed to fetch comments', detail: err.message });
  }
});

// ─── Wiki API routes ──────────────────────────────────────────────────────────

/**
 * POST /api/wiki/save
 * Body: { storyId: number }
 * Ingests a HN story into the wiki.
 */
app.post('/api/wiki/save', async (req, res) => {
  const { storyId } = req.body;
  if (!storyId) return res.status(400).json({ error: 'storyId required' });

  const result = await wiki.saveToWiki(storyId);

  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  res.json(result);
});

/**
 * GET /api/wiki/list
 * Returns list of saved wiki entries from index.md.
 */
app.get('/api/wiki/list', (_req, res) => {
  try {
    const entries = wiki.listSaved();
    res.json({ count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/wiki/page/*
 * Returns raw markdown for a wiki page.
 * e.g. /api/wiki/page/sources/hn-12345.md
 */
app.get('/api/wiki/page/*', (req, res) => {
  const relPath = req.params[0];
  const content = wiki.readPage(relPath);
  if (!content) return res.status(404).json({ error: 'Page not found' });
  res.type('text/plain').send(content);
});

/**
 * GET /api/wiki/events
 * Server-Sent Events stream for real-time wiki updates.
 */
app.get('/api/wiki/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial heartbeat
  res.write('event: connected\ndata: {}\n\n');

  // Keep-alive ping every 25s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25000);

  wiki.registerSseClient(res);

  req.on('close', () => clearInterval(ping));
});

// ─── Bloomberg API routes ─────────────────────────────────────────────────────

/**
 * GET /api/bloomberg/list
 * Returns all ingested Bloomberg reports (newest first).
 */
app.get('/api/bloomberg/list', (_req, res) => {
  try {
    const reports = bloomberg.listReports();
    res.json({ count: reports.length, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bloomberg/report/:slug
 * Returns raw markdown for a specific Bloomberg wiki page.
 */
app.get('/api/bloomberg/report/:slug', (req, res) => {
  const content = bloomberg.readReport(req.params.slug);
  if (!content) return res.status(404).json({ error: 'Report not found' });
  res.type('text/plain').send(content);
});

/**
 * POST /api/bloomberg/ingest
 * Body: { filename: "bloomberg-2026-04-26.md" }
 * Manually trigger ingest of a specific file from the watch directory.
 */
app.post('/api/bloomberg/ingest', async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const fullPath = path.join(BLOOMBERG_DIR, filename);
  const result   = await bloomberg.ingestFile(fullPath);

  if (!result.ok) return res.status(500).json({ error: result.error });
  res.json(result);
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  🟠 HN Dashboard running at http://localhost:${PORT}`);
  console.log(`  📁 Bloomberg watch dir: ${BLOOMBERG_DIR}\n`);

  // Wire SSE broadcast into bloomberg watcher
  bloomberg.setBroadcast((event, data) => {
    // Re-use wiki's SSE client registry
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    // Access the private sseClients set indirectly via a broadcast shim in wikiEngine
    wiki._broadcastRaw(msg);
  });

  // Start watching for new Bloomberg files
  bloomberg.startWatcher(BLOOMBERG_DIR);
});
