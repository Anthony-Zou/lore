'use strict';

// Attempt to extract readable article text from a URL.
// Uses built-in fetch (Node 18+) + cheerio for HTML parsing.
// Falls back gracefully if the page is paywalled, JS-rendered, or times out.

let cheerio;
try {
  cheerio = require('cheerio');
} catch {
  cheerio = null;
}

const TIMEOUT_MS = 8000;
const MAX_TEXT_CHARS = 3000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Domains that are JS-rendered, paywalled, or otherwise unfetchable.
// For these we skip the fetch entirely and return a clear note.
const SKIP_DOMAINS = new Set([
  'twitter.com', 'x.com',
  'reddit.com', 'old.reddit.com',
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'bloomberg.com',
  'wsj.com',
  'ft.com',
  'nytimes.com',
  'theatlantic.com',
  'wired.com',
]);

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

/**
 * Fetch and extract plain text from a URL.
 * Returns { text, title, excerpt, ok, error }
 */
async function fetchArticle(url) {
  if (!url) return { ok: false, error: 'No URL provided', text: '', excerpt: '', title: '' };

  const domain = getDomain(url);

  // Skip known unfetchable domains early
  if (SKIP_DOMAINS.has(domain)) {
    return {
      ok: false,
      error: `${domain} requires JS or login — see HN discussion for context`,
      text: '',
      excerpt: '',
      title: '',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, text: '', excerpt: '', title: '' };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return { ok: false, error: 'Non-HTML content', text: '', excerpt: '', title: '' };
    }

    const html = await res.text();

    if (!cheerio) {
      const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const excerpt = stripped.slice(0, MAX_TEXT_CHARS);
      return { ok: true, text: stripped, excerpt, title: '' };
    }

    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, aside, .ad, .ads, .advertisement, ' +
      '.sidebar, .cookie-banner, [role="banner"], [role="navigation"]').remove();

    const title = $('title').text().trim() ||
                  $('h1').first().text().trim() ||
                  '';

    const candidates = [
      $('article'),
      $('[role="main"]'),
      $('main'),
      $('.post-content, .article-body, .entry-content, .content-body, .story-body'),
      $('body'),
    ];

    let text = '';
    for (const el of candidates) {
      if (el.length) {
        text = el.first().text().replace(/\s+/g, ' ').trim();
        if (text.length > 200) break;
      }
    }

    const excerpt = text.slice(0, MAX_TEXT_CHARS);
    return { ok: true, text, excerpt, title };

  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return {
      ok: false,
      error: isTimeout ? 'Timeout' : err.message,
      text: '',
      excerpt: '',
      title: '',
    };
  }
}

/**
 * Extract likely topic tags from a title string using keyword matching.
 */
const TAG_RULES = [
  { tag: 'ai-ml', keywords: [
    'ai', 'gpt', 'llm', 'openai', 'anthropic', 'claude', 'gemini', 'neural',
    'machine learning', 'deep learning', 'language model', 'mistral', 'ollama',
    'diffusion', 'transformer', 'agent', 'rag', 'inference', 'quantiz',
    'fine-tun', 'embedding', 'vector db', 'benchmark', 'swe-bench', 'copilot',
    'cursor', 'model', 'multimodal', 'reinforcement', 'chatgpt', 'llama',
    'prompt', 'token', 'context window', 'hallucin',
  ]},
  { tag: 'startup', keywords: [
    'startup', 'yc', 'y combinator', 'founder', 'series a', 'series b',
    'venture', 'saas', 'bootstrapped', 'indie hacker', 'solopreneur',
    'product hunt', 'mvp', 'b2b', 'churn', 'mrr', 'arr', 'runway',
    'social network', 'domain name', 'acquired', 'exit', 'pivot',
    'i built', 'i made', 'i created', 'i bought', 'i launched', 'i sold',
    'show hn', 'side project', 'side-project',
  ]},
  { tag: 'programming', keywords: [
    'javascript', 'python', 'rust', 'golang', 'typescript', 'react',
    'linux', 'open source', 'git', 'api', 'framework', 'compiler', 'database',
    'sql', 'kubernetes', 'docker', 'programming', 'developer', 'algorithm',
    'data structure', 'refactor', 'codebase', 'debugging', 'terminal',
    'shell', 'webassembly', 'wasm', 'pcb', 'firmware', 'embedded',
    'memory', 'concurrency', 'async', 'runtime', 'interpreter', 'llvm',
    'kernel', 'driver', 'bsd', 'freebsd', 'hardware', 'microcontroller',
    'bare-metal', 'assembly', 'zig', 'elixir', 'haskell', 'ocaml',
  ]},
  { tag: 'security', keywords: [
    'security', 'vulnerability', 'exploit', 'breach', 'malware', 'ransomware',
    'zero-day', 'cve', 'privacy', 'encryption', 'phishing', 'backdoor',
    'authentication', 'certificate', 'x.509', 'tls', 'csrf', 'xss',
    'injection', 'hack', 'cyber',
  ]},
  { tag: 'science', keywords: [
    'research', 'study', 'physics', 'biology', 'chemistry', 'space', 'nasa',
    'climate', 'quantum', 'genomics', 'neuroscience', 'astronomy', 'telescope',
    'genome', 'protein', 'cell', 'evolution', 'ecology', 'anatomy', 'mushroom',
    'butterfl', 'wildlife', 'insect', 'species', 'ecosyst', 'extinction',
    'marathon', 'athlete', 'medicine', 'vaccine', 'neuron', 'fossil',
    'chernobyl', 'radiation', 'nuclear', 'particle',
  ]},
  { tag: 'business', keywords: [
    'acquisition', 'ipo', 'revenue', 'profit', 'layoffs', 'economy', 'market',
    'stock', 'apple', 'google', 'microsoft', 'meta', 'amazon', 'trademark',
    'patent', 'regulation', 'antitrust', 'merger', 'valuation', 'funding',
    'enterprise', 'fintech', 'bank', 'finance', 'investment', 'hedge fund',
    'private equity', 'tariff', 'trade war',
  ]},
];

// Use word-boundary matching for short keywords (≤4 chars) to avoid
// false positives like 'ai' in 'constraints' or 'cli' in 'decline'.
function makeKeywordMatcher(keyword) {
  if (keyword.length <= 4) {
    const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return str => re.test(str);
  }
  return str => str.includes(keyword);
}

const COMPILED_RULES = TAG_RULES.map(({ tag, keywords }) => ({
  tag,
  matchers: keywords.map(makeKeywordMatcher),
}));

function extractTags(title) {
  const lower = title.toLowerCase();
  return COMPILED_RULES
    .filter(r => r.matchers.some(m => m(lower)))
    .map(r => r.tag);
}

module.exports = { fetchArticle, extractTags };
