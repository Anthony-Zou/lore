'use strict';

const HN_API = 'https://hacker-news.firebaseio.com/v0';

// Simple in-memory TTL cache
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Evict stale entries every 10 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}, 10 * 60 * 1000);

async function hnFetch(path) {
  const res = await fetch(`${HN_API}${path}`);
  if (!res.ok) throw new Error(`HN API error: ${res.status} ${path}`);
  return res.json();
}

/**
 * Fetch story IDs for a given feed type.
 * @param {'top'|'new'|'ask'|'show'|'job'} type
 * @returns {Promise<number[]>}
 */
async function getStoryIds(type) {
  const key = `ids:${type}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const endpoints = {
    top: '/topstories.json',
    new: '/newstories.json',
    ask: '/askstories.json',
    show: '/showstories.json',
    job:  '/jobstories.json',
  };

  const endpoint = endpoints[type];
  if (!endpoint) throw new Error(`Unknown story type: ${type}`);

  const ids = await hnFetch(endpoint);
  cacheSet(key, ids, 5 * 60 * 1000); // 5 min TTL
  return ids;
}

/**
 * Fetch a single HN item (story, comment, etc.)
 * @param {number} id
 * @returns {Promise<object>}
 */
async function getItem(id) {
  const key = `item:${id}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const item = await hnFetch(`/item/${id}.json`);
  cacheSet(key, item, 10 * 60 * 1000); // 10 min TTL
  return item;
}

/**
 * Fetch full stories for a feed type, up to `limit`.
 * Concurrent fetches with graceful per-item error handling.
 */
async function getStories(type, limit = 100) {
  const ids = await getStoryIds(type);
  const slice = ids.slice(0, limit);

  const stories = await Promise.all(
    slice.map(id => getItem(id).catch(() => null))
  );

  return stories.filter(s => s && s.title);
}

/**
 * Fetch top-level comments for a story, up to `limit`.
 */
async function getComments(storyId, limit = 20) {
  const key = `comments:${storyId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const story = await getItem(storyId);
  const commentIds = (story.kids || []).slice(0, limit);

  const comments = await Promise.all(
    commentIds.map(id => getItem(id).catch(() => null))
  );

  const result = comments.filter(c => c && c.text && !c.deleted && !c.dead);
  cacheSet(key, result, 2 * 60 * 1000); // 2 min TTL
  return result;
}

module.exports = { getStories, getItem, getComments };
