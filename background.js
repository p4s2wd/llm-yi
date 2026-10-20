import { loadSettings } from './engine/settings.js';
import { createCache } from './engine/cache.js';
import { createPool } from './engine/pool.js';
import { packSegments } from './engine/chunker.js';
import { translateBatch } from './engine/api.js';
import { shouldAutoTranslate, domainOf, normLang, pickPageLang } from './engine/rules.js';

const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};
const cache = createCache(storage);
const jobs = new Map(); // `${tabId}:${frameId}` -> AbortController
const REQUEST_TIMEOUT_MS = 60000;
let pool = null;
let poolSize = 0;

function getPool(concurrency) {
  if (!pool || poolSize !== concurrency) { pool = createPool(concurrency); poolSize = concurrency; }
  return pool;
}

// Auth/model errors: retrying is pointless — fail the whole job so the UI can point to settings.
function isFatal(err) {
  return err && (err.status === 401 || err.status === 403 || err.status === 404);
}

async function detectLang({ lang, sample }) {
  try {
    const det = await chrome.i18n.detectLanguage(sample || ' ');
    return pickPageLang(lang, det);
  } catch {
    return normLang(lang) || null;
  }
}

async function runBatch(settings, batch, { sourceLang, targetLang, signal }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const batchSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    try {
      const out = await translateBatch(settings, batch, { sourceLang, targetLang, signal: batchSignal });
      return batch.map((seg, i) => ({ ok: true, text: out[i] }));
    } catch (err) {
      if (isFatal(err) || signal.aborted) throw err;
      if (attempt === 1) {
        // Last resort: translate one segment at a time; failures keep original text (ok:false).
        return Promise.all(batch.map(async (seg) => {
          try {
            const segSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
            return { ok: true, text: (await translateBatch(settings, [seg], { sourceLang, targetLang, signal: segSignal }))[0] };
          } catch (inner) {
            if (isFatal(inner) || signal.aborted) throw inner;
            return { ok: false, text: seg.text };
          }
        }));
      }
    }
  }
}

// 逐批写回（tr-batch）：不等全量聚合，缓存命中与每个批次的完成结果即时写回页面。
// 防串线：translate-page 由某 frame 发出；push 用 {frameId} 定向投递，progress 数字与 items 只属于该
// frame 的请求。gen 由 content 发起请求时附带、background 原样回传，用于 content 侧换代丢弃。
async function translateAll({ segments, sourceLang, targetLang, tabId, signal, gen, frameId }) {
  const settings = await loadSettings(storage);
  const results = new Array(segments.length).fill(null);
  const todo = [];
  const cachedItems = []; // 缓存命中的结果，扫描完立即作为第一批推出
  for (const seg of segments) {
    const hit = await cache.get(seg.text, targetLang);
    if (hit !== undefined) {
      results[seg.index] = hit;
      cachedItems.push({ index: seg.index, ok: true, text: hit });
    }
    else todo.push(seg);
  }
  let doneCount = segments.length - todo.length;
  const push = (items) =>
    tabId != null &&
    chrome.tabs.sendMessage(
      tabId,
      { type: 'tr-batch', gen, done: doneCount, total: segments.length, bilingual: settings.bilingual, items },
      frameId != null ? { frameId } : {},
    ).catch(() => {});
  push(cachedItems); // 刷新同页时命中部分即时上屏——"立刻翻译"的关键

  const batches = packSegments(todo);
  const p = getPool(settings.concurrency);
  let jobFailed = false;
  await Promise.all(batches.map((batch) => p.run(async () => {
    if (signal.aborted) return;
    const out = await runBatch(settings, batch, { sourceLang, targetLang, signal });
    if (!out) return;
    const items = [];
    batch.forEach((seg, i) => {
      results[seg.index] = out[i].text;
      // Only cache real translations; never cache fallback originals (would poison the cache).
      if (out[i].ok && out[i].text !== seg.text) cache.set(seg.text, targetLang, out[i].text).catch(() => {});
      if (!out[i].ok) jobFailed = true;
      items.push({ index: seg.index, ok: out[i].ok, text: out[i].text }); // ok:false 兜底原文也发，content 侧跳过写回
    });
    doneCount += batch.length;
    push(items);
  })));

  await cache.flush().catch(() => {});

  // Contract: segments arrive with index === position (content.js builds them that way).
  const partial = jobFailed || results.some((r) => r == null);
  if (partial) for (let i = 0; i < results.length; i++) if (results[i] == null) results[i] = segments[i].text;
  return { results, bilingual: settings.bilingual, partial };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;

  if (msg.type === 'page-init') {
    (async () => {
      const settings = await loadSettings(storage);
      const pageLang = await detectLang(msg);
      const stored = await chrome.storage.local.get('sites');
      const siteRule = (stored.sites || {})[domainOf((sender.tab && sender.tab.url) || '')] || null;
      const autoTranslate = !!pageLang && shouldAutoTranslate({
        pageLang,
        targetLang: settings.targetLang,
        siteRule,
        autoTranslateNonTarget: settings.autoTranslateNonTarget,
      });
      sendResponse({ pageLang, targetLang: settings.targetLang, autoTranslate });
    })();
    return true;
  }

  if (msg.type === 'translate-page') {
    const controller = new AbortController();
    const jobKey = tabId != null ? `${tabId}:${sender.frameId ?? 0}` : null;
    if (jobKey) jobs.set(jobKey, controller);
    translateAll({ ...msg, tabId, frameId: sender && sender.frameId, signal: controller.signal })
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }))
      .finally(() => { if (jobKey && jobs.get(jobKey) === controller) jobs.delete(jobKey); });
    return true;
  }

  if (msg.type === 'test-connection') {
    (async () => {
      try {
        const url = msg.baseUrl.replace(/\/+$/, '') + '/models';
        const res = await fetch(url, { headers: msg.apiKey ? { Authorization: `Bearer ${msg.apiKey}` } : {} });
        let models = [];
        try {
          const data = await res.json();
          models = (data.data || []).map((m) => m.id);
        } catch { /* non-JSON error body (HTML 404/5xx) — status still tells the story */ }
        sendResponse({ ok: res.ok, status: res.status, models });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
});

function abortJobs(tabId) {
  for (const [key, c] of jobs) {
    if (key.startsWith(`${tabId}:`)) { c.abort(); jobs.delete(key); }
  }
}
chrome.tabs.onRemoved.addListener(abortJobs);
// 仅当中止信号携带 URL（主 frame 真正换址的跨文档导航）才中止在途翻译；
// SPA hydration 期间的 replaceState 等也会触发 status:loading 但不带 url，不得误杀。
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading' && info.url && (info.frameId ?? 0) === 0) abortJobs(tabId); });
