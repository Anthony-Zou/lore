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

/**
 * Fetch and extract plain text from a URL.
 * Returns { text, title, excerpt, ok, error }
 */
async function fetchArticle(url) {
  if (!url) return { ok: false, error: 'No URL provided', text: '', excerpt: '', title: '' };

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
      // Fallback: naive tag stripping
      const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const excerpt = stripped.slice(0, MAX_TEXT_CHARS);
      return { ok: true, text: stripped, excerpt, title: '' };
    }

    const $ = cheerio.load(html);

    // Remove noise elements
    $('script, style, nav, header, footer, aside, .ad, .ads, .advertisement, ' +
      '.sidebar, .cookie-banner, [role="banner"], [role="navigation"]').remove();

    const title = $('title').text().trim() ||
                  $('h1').first().text().trim() ||
                  '';

    // Try to find main content area
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
  { tag: 'ai-ml',       keywords: ['ai', 'gpt', 'llm', 'openai', 'anthropic', 'claude', 'gemini', 'neural', 'machine learning', 'deep learning', 'language model', 'mistral', 'ollama', 'diffusion', 'transformer'] },
  { tag: 'startup',     keywords: ['startup', 'yc', 'y combinator', 'founder', 'series a', 'series b', 'venture', 'saas', 'bootstrapped'] },
  { tag: 'programming', keywords: ['javascript', 'python', 'rust', 'golang', 'typescript', 'react', 'linux', 'open source', 'git', 'api', 'framework', 'compiler', 'database', 'sql', 'kubernetes', 'docker', 'programming', 'developer'] },
  { tag: 'security',    keywords: ['security', 'vulnerability', 'exploit', 'breach', 'malware', 'ransomware', 'zero-day', 'cve', 'privacy', 'encryption'] },
  { tag: 'science',     keywords: ['research', 'study', 'physics', 'biology', 'chemistry', 'space', 'nasa', 'climate', 'quantum', 'genomics'] },
  { tag: 'business',    keywords: ['acquisition', 'ipo', 'revenue', 'profit', 'layoffs', 'economy', 'market', 'stock', 'apple', 'google', 'microsoft', 'meta', 'amazon'] },
];

function extractTags(title) {
  const lower = title.toLowerCase();
  return TAG_RULES
    .filter(r => r.keywords.some(k => lower.includes(k)))
    .map(r => r.tag);
}

module.exports = { fetchArticle, extractTags };
