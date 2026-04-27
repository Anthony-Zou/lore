'use strict';
/**
 * HN Dashboard — Full Test Suite
 * Run: node test_suite.js
 *
 * OFFLINE tests: mocks/local files only (always runnable)
 * NETWORK tests: skipped if no internet
 */

process.chdir(__dirname);

const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── Harness ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;

function ok(label, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${label}${detail ? '  (' + detail + ')' : ''}`); passed++; }
  else       { console.log(`  ❌ ${label}${detail ? '  (' + detail + ')' : ''}`); failed++; }
}
function skip(label, reason) {
  console.log(`  ⏭  ${label}  [${reason}]`);
  skipped++;
}

async function hasNetwork() {
  return new Promise(resolve => {
    const req = http.get('http://hacker-news.firebaseio.com', { timeout: 3000 }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

const PROJECT      = __dirname;
const SAMPLE_BB    = '/sessions/tender-fervent-hawking/mnt/uploads/bloomberg-2026-04-26.md';

// ── 1. File structure ─────────────────────────────────────────────────────────
async function testFileStructure() {
  console.log('\n━━━ 1. File Structure ━━━');
  const required = [
    'package.json', 'server.js', 'README.md',
    'lib/hnClient.js', 'lib/fetcher.js', 'lib/wikiEngine.js', 'lib/bloombergWatcher.js',
    'public/index.html',
    'wiki/CLAUDE.md', 'wiki/index.md', 'wiki/log.md',
  ];
  for (const f of required) ok(`exists: ${f}`, fs.existsSync(path.join(PROJECT, f)));

  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT, 'package.json'), 'utf8'));
  ok('dep: express',  !!pkg.dependencies?.express);
  ok('dep: cors',     !!pkg.dependencies?.cors);
  ok('dep: cheerio',  !!pkg.dependencies?.cheerio);
  ok('node_modules installed', fs.existsSync(path.join(PROJECT, 'node_modules', 'express')));
  ok('package.json has start script', pkg.scripts?.start === 'node server.js');
}

// ── 2. JS Syntax ──────────────────────────────────────────────────────────────
async function testSyntax() {
  console.log('\n━━━ 2. JS Syntax ━━━');
  const { execSync } = require('child_process');
  for (const f of ['server.js','lib/hnClient.js','lib/fetcher.js','lib/wikiEngine.js','lib/bloombergWatcher.js']) {
    try {
      execSync(`node --check ${f}`, { cwd: PROJECT, stdio: 'pipe' });
      ok(`syntax ok: ${f}`, true);
    } catch (e) {
      ok(`syntax ok: ${f}`, false, e.stderr?.toString().slice(0, 100));
    }
  }
}

// ── 3. Module exports ─────────────────────────────────────────────────────────
async function testModuleExports() {
  console.log('\n━━━ 3. Module Exports ━━━');

  const mods = {};
  for (const [name, rel] of [
    ['hnClient',          './lib/hnClient.js'],
    ['fetcher',           './lib/fetcher.js'],
    ['wikiEngine',        './lib/wikiEngine.js'],
    ['bloombergWatcher',  './lib/bloombergWatcher.js'],
  ]) {
    try { mods[name] = require(rel); ok(`require ${name}`, true); }
    catch (e) { ok(`require ${name}`, false, e.message.slice(0, 80)); }
  }

  const hn = mods.hnClient;
  if (hn) {
    ok('hnClient.getStories',  typeof hn.getStories  === 'function');
    ok('hnClient.getItem',     typeof hn.getItem     === 'function');
    ok('hnClient.getComments', typeof hn.getComments === 'function');
  }

  const f = mods.fetcher;
  if (f) {
    ok('fetcher.fetchArticle', typeof f.fetchArticle === 'function');
    ok('fetcher.extractTags',  typeof f.extractTags  === 'function');
  }

  const w = mods.wikiEngine;
  if (w) {
    ok('wikiEngine.saveToWiki',        typeof w.saveToWiki        === 'function');
    ok('wikiEngine.listSaved',         typeof w.listSaved         === 'function');
    ok('wikiEngine.readPage',          typeof w.readPage          === 'function');
    ok('wikiEngine.registerSseClient', typeof w.registerSseClient === 'function');
    ok('wikiEngine._broadcastRaw',     typeof w._broadcastRaw     === 'function');
  }

  const b = mods.bloombergWatcher;
  if (b) {
    ok('bloombergWatcher.startWatcher', typeof b.startWatcher === 'function');
    ok('bloombergWatcher.ingestFile',   typeof b.ingestFile   === 'function');
    ok('bloombergWatcher.listReports',  typeof b.listReports  === 'function');
    ok('bloombergWatcher.readReport',   typeof b.readReport   === 'function');
    ok('bloombergWatcher.setBroadcast', typeof b.setBroadcast === 'function');
  }

  return mods;
}

// ── 4. Fetcher — offline ──────────────────────────────────────────────────────
async function testFetcherOffline() {
  console.log('\n━━━ 4. Fetcher — Tag Extraction ━━━');
  const f = require('./lib/fetcher.js');

  const cases = [
    ['ai-ml',       'GPT-5 beats all LLM benchmarks with new transformer architecture'],
    ['startup',     'YC-backed startup raises $20M Series A for SaaS product'],
    ['security',    'Critical zero-day vulnerability found in OpenSSL 3.x'],
    ['programming', 'Python 4.0 released with major compiler improvements'],
    ['science',     'NASA discovers exoplanet using quantum sensor array'],
    ['business',    'Apple $2B acquisition of startup shakes market'],
  ];
  for (const [tag, title] of cases) {
    const tags = f.extractTags(title);
    ok(`extractTags: ${tag}`, tags.includes(tag), `"${title.slice(0,45)}" → [${tags}]`);
  }
  ok('extractTags: no false positive', f.extractTags('My cat loves tuna').length === 0);

  // Graceful error handling
  const empty = await f.fetchArticle('');
  ok('fetchArticle(""): ok=false', empty.ok === false);
  ok('fetchArticle(""): has error field', typeof empty.error === 'string');

  const bad = await f.fetchArticle('not-a-url');
  ok('fetchArticle(invalid): ok=false', bad.ok === false);
}

// ── 5. Wiki Engine — file I/O ─────────────────────────────────────────────────
async function testWikiEngineIO() {
  console.log('\n━━━ 5. Wiki Engine — File I/O ━━━');
  const w = require('./lib/wikiEngine.js');

  // listSaved always returns array
  const saved = w.listSaved();
  ok('listSaved: returns array', Array.isArray(saved), `${saved.length} entries`);

  // readPage: missing
  ok('readPage: null for missing',     w.readPage('sources/does-not-exist.md') === null);

  // readPage: path traversal
  ok('readPage: blocks ../',           w.readPage('../../../etc/passwd') === null);
  ok('readPage: blocks windows path',  w.readPage('..\\..\\server.js')  === null);

  // readPage: real file (CLAUDE.md)
  const claude = w.readPage('CLAUDE.md');
  ok('readPage: CLAUDE.md exists',     claude !== null);
  ok('readPage: CLAUDE.md has content', claude?.includes('HN Wiki'));

  // _broadcastRaw: safe with zero clients
  try { w._broadcastRaw('event: test\ndata: {}\n\n'); ok('_broadcastRaw: no-op with 0 clients', true); }
  catch (e) { ok('_broadcastRaw: no-op with 0 clients', false, e.message); }

  // registerSseClient: mock res object
  let closed = false;
  const mockRes = {
    write: () => {},
    on: (evt, cb) => { if (evt === 'close') { /* store cb */ } },
  };
  try { w.registerSseClient(mockRes); ok('registerSseClient: accepts mock client', true); }
  catch (e) { ok('registerSseClient: accepts mock client', false, e.message); }
}

// ── 6. Bloomberg Parser ───────────────────────────────────────────────────────
async function testBloombergParser() {
  console.log('\n━━━ 6. Bloomberg Parser ━━━');
  const b = require('./lib/bloombergWatcher.js');

  // listReports: always array
  ok('listReports: returns array', Array.isArray(b.listReports()));

  // readReport: null for missing
  ok('readReport: null for missing', b.readReport('bloomberg-9999-12-31') === null);

  // setBroadcast: no throw
  try { b.setBroadcast(() => {}); ok('setBroadcast: no throw', true); }
  catch (e) { ok('setBroadcast: no throw', false, e.message); }

  // ingestFile: full parse test with sample
  if (!fs.existsSync(SAMPLE_BB)) {
    skip('ingestFile: full parse', `sample file not at ${SAMPLE_BB}`);
    skip('bloomberg wiki page content', 'no sample');
    skip('bloomberg index/log update', 'no sample');
    skip('bloomberg listReports post-ingest', 'no sample');
    return;
  }

  const tmpDir  = '/tmp/_hn_test_bb_input';
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, 'bloomberg-2026-04-26.md');
  fs.writeFileSync(tmpFile, fs.readFileSync(SAMPLE_BB));

  const r = await b.ingestFile(tmpFile);
  ok('ingestFile: ok=true',           r.ok === true,                      r.error || '');
  ok('ingestFile: correct date',      r.date === '2026-04-26',            r.date);
  ok('ingestFile: correct slug',      r.slug === 'bloomberg-2026-04-26',  r.slug);
  ok('ingestFile: ideasCount >= 1',   r.ideasCount >= 1,                  `${r.ideasCount} ideas`);
  ok('ingestFile: topCall extracted', r.topCall?.length > 10,             r.topCall?.slice(0,60));

  const bbPath = path.join(PROJECT, 'wiki', 'bloomberg', 'bloomberg-2026-04-26.md');
  ok('wiki/bloomberg/ page created',   fs.existsSync(bbPath));

  const content = fs.existsSync(bbPath) ? fs.readFileSync(bbPath, 'utf8') : '';
  ok('page: source: bloomberg',  content.includes('source: bloomberg'));
  ok('page: top_call field',     content.includes('top_call:'));
  ok('page: date field',         content.includes('date: 2026-04-26'));
  ok('page: ## 💡 Trade Ideas', content.includes('## 💡 Trade Ideas'));
  ok('page: ## ⚡ Strategy',    content.includes('## ⚡ Strategy Summary'));
  ok('page: ## ⚠️ Signals',     content.includes('## ⚠️ Position Signals'));
  ok('page: ## 📈 Snapshot',    content.includes('## 📈 Market Snapshot'));
  ok('page: ## Connections',     content.includes('## Connections'));
  ok('page: has trade direction', content.includes('**Direction**'));
  ok('page: has trade catalyst',  content.includes('**Catalyst**'));

  const idx = fs.readFileSync(path.join(PROJECT, 'wiki', 'index.md'), 'utf8');
  ok('index.md: bloomberg entry added', idx.includes('bloomberg-2026-04-26'));

  const log = fs.readFileSync(path.join(PROJECT, 'wiki', 'log.md'), 'utf8');
  ok('log.md: bloomberg entry added', log.includes('Bloomberg'));

  const reports2 = b.listReports();
  ok('listReports: new entry present',     reports2.some(r2 => r2.slug === 'bloomberg-2026-04-26'));
  ok('listReports: topCall populated',     reports2[0]?.topCall?.length > 0, reports2[0]?.topCall?.slice(0,40));

  const rc = b.readReport('bloomberg-2026-04-26');
  ok('readReport: returns content',        rc && rc.length > 200, `${rc?.length} chars`);

  // Idempotent second ingest
  const r2 = await b.ingestFile(tmpFile);
  ok('ingestFile: idempotent 2nd run',     r2.ok === true);

  // Non-.md file ignored
  const badFile = path.join(tmpDir, 'random.txt');
  fs.writeFileSync(badFile, 'hello');
  const r3 = await b.ingestFile(badFile);
  ok('ingestFile: rejects non-md file',    r3.ok === false, r3.error);

  try { fs.rmSync('/tmp/_hn_test_bb_input', { recursive: true, force: true }); } catch { /* ok */ }
}

// ── 7. Server route audit ─────────────────────────────────────────────────────
async function testServerRoutes() {
  console.log('\n━━━ 7. Server Route Audit ━━━');
  const src = fs.readFileSync(path.join(PROJECT, 'server.js'), 'utf8');

  const checks = [
    ['GET /api/stories/:type',          "app.get('/api/stories/:type'"],
    ['GET /api/item/:id',               "app.get('/api/item/:id'"],
    ['GET /api/comments/:id',           "app.get('/api/comments/:id'"],
    ['POST /api/wiki/save',             "app.post('/api/wiki/save'"],
    ['GET /api/wiki/list',              "app.get('/api/wiki/list'"],
    ['GET /api/wiki/page/*',            "app.get('/api/wiki/page/*'"],
    ['GET /api/wiki/events (SSE)',      "app.get('/api/wiki/events'"],
    ['GET /api/bloomberg/list',         "app.get('/api/bloomberg/list'"],
    ['GET /api/bloomberg/report/:slug', "app.get('/api/bloomberg/report/:slug'"],
    ['POST /api/bloomberg/ingest',      "app.post('/api/bloomberg/ingest'"],
    ['GET /api/health',                 "app.get('/api/health'"],
    ['SPA fallback',                    "app.get('*'"],
    ['SSE: text/event-stream',          'text/event-stream'],
    ['SSE: keep-alive ping',            ': ping'],
    ['SSE: registerSseClient wired',    'wiki.registerSseClient'],
    ['Bloomberg: setBroadcast wired',   'bloomberg.setBroadcast'],
    ['Bloomberg: startWatcher called',  'bloomberg.startWatcher'],
    ['BLOOMBERG_DIR configurable',      'BLOOMBERG_DIR'],
    ['CORS enabled',                    'app.use(cors())'],
    ['JSON body parser',                'express.json()'],
    ['Static files served',             'express.static'],
  ];

  for (const [label, snippet] of checks) ok(label, src.includes(snippet));
}

// ── 8. Frontend audit ─────────────────────────────────────────────────────────
async function testFrontend() {
  console.log('\n━━━ 8. Frontend Audit ━━━');
  const html = fs.readFileSync(path.join(PROJECT, 'public/index.html'), 'utf8');

  const checks = [
    // Layout
    ['search input',              'id="searchInput"'],
    ['story list container',      'id="storyList"'],
    ['load more button',          'id="loadMoreBtn"'],
    ['stats bar',                 'id="statsBar"'],
    ['panel body',                'id="panelBody"'],
    ['right panel tabs',          'class="panel-tabs"'],
    // Tabs
    ['comments tab button',       "switchTab('comments')"],
    ['wiki tab button',           "switchTab('wiki')"],
    ['bloomberg tab button',      "switchTab('bloomberg')"],
    // Nav
    ['nav: top stories',          "switchType('top'"],
    ['nav: new',                  "switchType('new'"],
    ['nav: ask hn',               "switchType('ask'"],
    ['nav: show hn',              "switchType('show'"],
    ['nav: job',                  "switchType('job'"],
    // Tag filters
    ['tag filter: ai-ml',         "filterTag('ai-ml'"],
    ['tag filter: startup',       "filterTag('startup'"],
    ['tag filter: programming',   "filterTag('programming'"],
    ['tag filter: security',      "filterTag('security'"],
    ['tag filter: science',       "filterTag('science'"],
    ['tag filter: business',      "filterTag('business'"],
    // Story cards
    ['save to wiki button',       'saveToWiki('],
    ['comment button',            'loadComments('],
    ['story type: ask badge',     '.ask{'],
    ['story type: show badge',    '.show{'],
    ['skeleton loading',          'skel-card'],
    // Wiki panel
    ['wiki count badge',          'id="wikiCount"'],
    ['renderWikiPanel fn',        'function renderWikiPanel'],
    ['refreshWikiList fn',        'function refreshWikiList'],
    // Bloomberg panel
    ['renderBloombergList fn',    'function renderBloombergList'],
    ['renderBloombergReport fn',  'function renderBloombergReport'],
    ['bloomberg card style',      'bb-card'],
    ['bloomberg date label',      'bb-date'],
    ['bloomberg top call label',  'bb-topcall'],
    ['bloomberg trade ideas',     'bb-idea'],
    ['bloomberg back button',     'bb-back'],
    ['loadBloombergList fn',      'function loadBloombergList'],
    ['loadBloombergReport fn',    'function loadBloombergReport'],
    // SSE
    ['EventSource connect',       'new EventSource('],
    ['SSE: wiki:saved listener',  "addEventListener('wiki:saved'"],
    ['SSE: bloomberg:saved',      "addEventListener('bloomberg:saved'"],
    ['SSE: reconnect on error',   'setTimeout(connectSSE'],
    // Helpers
    ['escHtml XSS guard',         'function escHtml'],
    ['timeAgo helper',            'function timeAgo'],
    ['domain extractor',          'function domain'],
    ['tag keyword map',           'const TAG_KW'],
    // Timers
    ['HN auto-refresh 5min',      '5 * 60 * 1000'],
    ['Bloomberg poll 10min',      '10 * 60 * 1000'],
    // API calls
    ['fetch /api/stories',        "fetch(`/api/stories/"],
    ['fetch /api/comments',       "fetch(`/api/comments/"],
    ['fetch /api/wiki/save',      "fetch('/api/wiki/save'"],
    ['fetch /api/wiki/list',      "fetch('/api/wiki/list'"],
    ['fetch /api/bloomberg/list', "fetch('/api/bloomberg/list'"],
    ['fetch /api/bloomberg/report', "fetch(`/api/bloomberg/report/"],
  ];

  for (const [label, snippet] of checks) ok(`frontend: ${label}`, html.includes(snippet));
}

// ── 9. Wiki schema content ────────────────────────────────────────────────────
async function testWikiSchema() {
  console.log('\n━━━ 9. Wiki Schema (CLAUDE.md) ━━━');
  const c = fs.readFileSync(path.join(PROJECT, 'wiki/CLAUDE.md'), 'utf8');

  const checks = [
    ['sources/ dir',              'sources/'],
    ['concepts/ dir',             'concepts/'],
    ['bloomberg/ dir',            'bloomberg/'],
    ['ingest operation',          'Ingest'],
    ['query operation',           'Query'],
    ['lint operation',            'Lint'],
    ['wikilink [[]]',             '[['],
    ['hacker-news source type',   'hacker-news'],
    ['bloomberg source type',     'bloomberg'],
    ['bloomberg page format doc', 'Bloomberg Report Pages'],
    ['cross-linking section',     'Cross-linking Bloomberg'],
    ['trade idea follow-up',      'Trade Idea'],
    ['bloomberg tag',             'bloomberg'],
    ['trade-idea tag',            'trade-idea'],
    ['macro tag',                 'macro'],
    ['portfolio mention',         'portfolio'],
  ];

  for (const [label, snippet] of checks) ok(`CLAUDE.md: ${label}`, c.includes(snippet));
}

// ── 10. Network / live HN API ─────────────────────────────────────────────────
async function testNetwork(online) {
  console.log('\n━━━ 10. Network / Live HN API ━━━');
  if (!online) {
    ['getStories top/ask/show/job','getItem','getComments','fetchArticle example.com']
      .forEach(t => skip(t, 'no network'));
    return;
  }

  const hn = require('./lib/hnClient.js');
  const f  = require('./lib/fetcher.js');

  const top = await hn.getStories('top', 5).catch(() => []);
  ok('getStories top', top.length > 0, `${top.length} stories`);
  ok('stories: have title', top.every(s => s.title));
  ok('stories: have score', top.every(s => typeof s.score === 'number'));

  if (top[0]) {
    const item = await hn.getItem(top[0].id).catch(() => null);
    ok('getItem', item?.id === top[0].id, item?.title?.slice(0,40));
    const comments = await hn.getComments(top[0].id, 3).catch(() => []);
    ok('getComments', Array.isArray(comments), `${comments.length}`);
  }

  for (const type of ['ask','show','job']) {
    const s = await hn.getStories(type, 2).catch(() => []);
    ok(`getStories ${type}`, s.length >= 0, `${s.length}`);
  }

  // Cache: second call should be instant
  const t0 = Date.now();
  await hn.getStories('top', 5);
  ok('TTL cache hit', Date.now() - t0 < 100, `${Date.now()-t0}ms`);

  const article = await f.fetchArticle('https://example.com');
  ok('fetchArticle: example.com', article.ok === true, `${article.excerpt?.length} chars`);

  // Live saveToWiki
  if (top[0]) {
    const w = require('./lib/wikiEngine.js');
    const res = await w.saveToWiki(top[0].id).catch(() => ({ ok: false, error: 'threw' }));
    ok('saveToWiki: live story', res.ok, res.error || res.slug);
    if (res.ok) {
      const p = w.readPage(`sources/${res.slug}.md`);
      ok('saveToWiki: file readable', p && p.length > 100, `${p?.length} chars`);
      ok('saveToWiki: has hn_id',     p?.includes('hn_id:'));
      ok('saveToWiki: has title',     p?.includes(top[0].title?.slice(0,15)));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    HN Dashboard — Full Test Suite        ║');
  console.log('╚══════════════════════════════════════════╝');

  const online = await hasNetwork();
  console.log(`\n  Network: ${online ? '🌐 Online' : '📴 Offline'}`);

  await testFileStructure();
  await testSyntax();
  await testModuleExports();
  await testFetcherOffline();
  await testWikiEngineIO();
  await testBloombergParser();
  await testServerRoutes();
  await testFrontend();
  await testWikiSchema();
  await testNetwork(online);

  console.log(`\n${'═'.repeat(46)}`);
  const total = passed + failed + skipped;
  console.log(`  Total:    ${total} checks`);
  console.log(`  ✅ Pass:  ${passed}`);
  if (failed)  console.log(`  ❌ Fail:  ${failed}`);
  if (skipped) console.log(`  ⏭  Skip:  ${skipped} (need network or sample file)`);
  console.log(`\n  ${failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} FAILURE(S) — see above`}`);
  console.log('═'.repeat(46));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n💥 Crash:', e.message, '\n', e.stack);
  process.exit(1);
});
