# 本地模型整页翻译扩展 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome MV3 扩展：整页翻译 + 自动翻译规则，翻译后端为可配置的 OpenAI 兼容 API（默认 vLLM `qwen35-122b`）。

**Architecture:** content script 收集 DOM 文本块 → service worker 并发批量调 API（带 LRU 缓存、失败降级）→ 同序 JSON 写回 DOM。纯静态文件，无构建步骤。纯逻辑（分块/解析/缓存/规则/并发池）为 ES 模块，用 `node --test` 做单元测试；DOM/UI 用本地测试页人工验证。

**Tech Stack:** Chrome MV3（service worker `type: module`）、原生 JS ES modules、node:test、无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-10-20-chrome-translate-extension-design.md`

**已验证事实（不要重新怀疑）:**
- `POST http://localhost:8000/v1/chat/completions` + `Authorization: Bearer <key>` 可用；`GET <base>/models` 可测连接。
- 必须带 `chat_template_kwargs: {"enable_thinking": false}`（实测 reasoning_tokens=0）。
- 小请求延迟 ~0.45s。API key 不写进仓库，由用户在设置页填入。

**工作目录:** 所有路径相对 `/Users/shuang/code/ai/chrome`。git 操作只在本目录（工作区根 `/Users/shuang/code` 的 git 是坏的，禁止在那提交）。

**文件结构:**
```
manifest.json            MV3 清单
package.json             type:module + npm test
background.js            service worker：消息路由、并发队列、缓存、任务中止
engine/settings.js       设置默认值与读写（纯逻辑，可测）
engine/chunker.js        文本块打包（纯逻辑，可测）
engine/api.js            请求体构造 + 响应 JSON 解析（纯逻辑，可测）
engine/cache.js          LRU 缓存，storage 适配器注入（可测）
engine/rules.js          自动翻译规则判定（纯逻辑，可测）
engine/pool.js           并发池（纯逻辑，可测）
content/toolbar.js       页面工具条（closed shadow DOM），定义 globalThis.trToolbar
content/content.js       DOM 收集、写回、还原、SPA 增量、消息
popup/popup.html|js      工具栏弹窗
options/options.html|js  设置页
test/*.test.js           node --test 单元测试
test-pages/*.html        人工验证页（经 http://localhost:8080 访问）
README.md                加载与使用说明
```

---

### Task 1: 项目脚手架

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: 写 `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Local LLM Translate",
  "version": "0.1.0",
  "description": "Whole-page translation with your own local model (OpenAI-compatible API).",
  "permissions": ["storage", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup/popup.html" },
  "options_page": "options/options.html",
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content/toolbar.js", "content/content.js"],
      "all_frames": true,
      "run_at": "document_idle"
    }
  ]
}
```

注意：`toolbar.js` 必须排在 `content.js` 前面（同一 isolated world 内按序执行，content.js 依赖 `globalThis.trToolbar`）。

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "local-llm-translate",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/" }
}
```

- [ ] **Step 3: 写 `.gitignore`**

```
.DS_Store
node_modules/
```

- [ ] **Step 4: 验证 JSON 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json')); JSON.parse(require('fs').readFileSync('package.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add manifest.json package.json .gitignore
git commit -m "chore: 扩展脚手架（MV3 manifest + npm test）"
```

---

### Task 2: engine/settings.js（TDD）

**Files:**
- Create: `engine/settings.js`
- Test: `test/settings.test.js`

storage 适配器约定（全项目统一）：`{ get(keys: string|string[]): Promise<object>, set(obj): Promise<void> }`。测试用内存 fake，扩展里包 `chrome.storage.local`。

- [ ] **Step 1: 写失败测试 `test/settings.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, loadSettings, saveSettings } from '../engine/settings.js';

export function fakeStorage(init = {}) {
  const db = { ...init };
  return {
    db,
    async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in db) out[k] = db[k]; return out; },
    async set(obj) { Object.assign(db, obj); },
  };
}

test('loadSettings returns defaults when empty', async () => {
  const s = await loadSettings(fakeStorage());
  assert.equal(s.model, DEFAULTS.model);
  assert.equal(s.baseUrl, 'http://localhost:8000/v1');
  assert.equal(s.apiKey, '');
});

test('loadSettings merges stored over defaults and drops unknown keys', async () => {
  const s = await loadSettings(fakeStorage({ settings: { model: 'other', junk: 1 } }));
  assert.equal(s.model, 'other');
  assert.equal(s.baseUrl, DEFAULTS.baseUrl);
  assert.equal(s.junk, undefined);
});

test('saveSettings persists merged settings and ignores unknown keys', async () => {
  const st = fakeStorage();
  const next = await saveSettings(st, { model: 'x', junk: 1 });
  assert.equal(next.model, 'x');
  assert.equal(next.junk, undefined);
  assert.deepEqual(st.db.settings, next);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（Cannot find module `engine/settings.js`）

- [ ] **Step 3: 实现 `engine/settings.js`**

```js
export const DEFAULTS = {
  baseUrl: 'http://localhost:8000/v1',
  apiKey: '',
  model: 'qwen35-122b',
  targetLang: 'zh-CN',
  concurrency: 3,
  bilingual: false,
  autoTranslateNonTarget: true,
};

export function loadSettings(storage) {
  return storage.get('settings').then((stored) => {
    const s = { ...DEFAULTS };
    const p = stored.settings || {};
    for (const k of Object.keys(DEFAULTS)) if (k in p) s[k] = p[k];
    return s;
  });
}

export function saveSettings(storage, patch) {
  return loadSettings(storage).then((cur) => {
    const next = { ...cur };
    for (const k of Object.keys(DEFAULTS)) if (k in patch) next[k] = patch[k];
    return storage.set({ settings: next }).then(() => next);
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add engine/settings.js test/settings.test.js
git commit -m "feat: 设置模块（默认值+合并读写，未知键丢弃）"
```

---

### Task 3: engine/chunker.js（TDD）

**Files:**
- Create: `engine/chunker.js`
- Test: `test/chunker.test.js`

输入段格式（全项目统一）：`{ index: number, text: string }`，`index` 是段在整页结果数组中的位置，打包/拆包必须原样保留。

- [ ] **Step 1: 写失败测试 `test/chunker.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { packSegments } from '../engine/chunker.js';

const seg = (i, len = 1) => ({ index: i, text: 'a'.repeat(len) });

test('empty input yields no batches', () => {
  assert.deepEqual(packSegments([]), []);
});

test('packs by maxItems and preserves indices', () => {
  const segs = Array.from({ length: 7 }, (_, i) => seg(i));
  const batches = packSegments(segs, { maxChars: 1e9, maxItems: 3 });
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[2].map((s) => s.index), [6]);
});

test('packs by maxChars', () => {
  const segs = [seg(0, 600), seg(1, 600), seg(2, 600)];
  const batches = packSegments(segs, { maxChars: 1300, maxItems: 15 });
  assert.deepEqual(batches.map((b) => b.map((s) => s.index)), [[0, 1], [2]]);
});

test('oversized segment goes alone without being dropped', () => {
  const segs = [seg(0, 5000), seg(1, 10)];
  const batches = packSegments(segs, { maxChars: 1200, maxItems: 15 });
  assert.deepEqual(batches.map((b) => b.map((s) => s.index)), [[0], [1]]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（Cannot find module `engine/chunker.js`）

- [ ] **Step 3: 实现 `engine/chunker.js`**

```js
export function packSegments(segments, { maxChars = 1200, maxItems = 15 } = {}) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const s of segments) {
    if (current.length && (chars + s.text.length > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(s);
    chars += s.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/chunker.js test/chunker.test.js
git commit -m "feat: 文本块打包器（按字符数/条数贪心分批，保留原索引）"
```

---

### Task 4: engine/api.js（TDD）

**Files:**
- Create: `engine/api.js`
- Test: `test/api.test.js`

- [ ] **Step 1: 写失败测试 `test/api.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatBody, parseTranslationResponse, chatCompletionsUrl, langName } from '../engine/api.js';

test('buildChatBody disables thinking, pins model, demands exact length', () => {
  const body = buildChatBody({
    model: 'm1',
    segments: [{ index: 0, text: 'Hello' }, { index: 1, text: 'Bye' }],
    sourceLang: 'en',
    targetLang: 'zh-CN',
  });
  assert.equal(body.model, 'm1');
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.equal(body.temperature, 0.3);
  assert.match(body.messages[0].content, /exactly 2/);
  assert.match(body.messages[0].content, /Simplified Chinese/);
  assert.equal(body.messages[1].content, '["Hello","Bye"]');
});

test('parseTranslationResponse handles plain, fenced and prefixed JSON', () => {
  assert.deepEqual(parseTranslationResponse('["甲","乙"]', 2), ['甲', '乙']);
  assert.deepEqual(parseTranslationResponse('```json\n["甲","乙"]\n```', 2), ['甲', '乙']);
  assert.deepEqual(parseTranslationResponse('Here you go: ["甲","乙"] hope it helps', 2), ['甲', '乙']);
});

test('parseTranslationResponse rejects mismatched length / non-array', () => {
  assert.throws(() => parseTranslationResponse('["甲"]', 2), /mismatch/);
  assert.throws(() => parseTranslationResponse('no array here', 2), /no JSON array/);
  assert.throws(() => parseTranslationResponse('{"a":1,"b":2}', 2), /not an array/);
});

test('chatCompletionsUrl normalizes trailing slash', () => {
  assert.equal(chatCompletionsUrl('http://x/v1/'), 'http://x/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://x/v1'), 'http://x/v1/chat/completions');
});

test('langName maps known codes and falls back', () => {
  assert.equal(langName('zh-CN'), 'Simplified Chinese');
  assert.equal(langName('th'), 'th');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（Cannot find module `engine/api.js`）

- [ ] **Step 3: 实现 `engine/api.js`**

```js
const LANG_NAMES = {
  'zh-CN': 'Simplified Chinese', en: 'English', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian',
};

export function langName(code) {
  return LANG_NAMES[code] || code;
}

export function chatCompletionsUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

export function buildChatBody({ model, segments, sourceLang, targetLang }) {
  const list = segments.map((s) => s.text);
  const totalChars = list.reduce((n, t) => n + t.length, 0);
  return {
    model,
    temperature: 0.3,
    max_tokens: Math.min(8000, 100 + totalChars * 2),
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      {
        role: 'system',
        content:
          `You are a professional translator. Translate each string from ${langName(sourceLang)} ` +
          `to ${langName(targetLang)}. Preserve meaning, tone and inline formatting. ` +
          `Output ONLY a JSON array of exactly ${list.length} translated strings in the same order. ` +
          `No explanations, no code fences.`,
      },
      { role: 'user', content: JSON.stringify(list) },
    ],
  };
}

export function parseTranslationResponse(text, expectedLen) {
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('no JSON array in response');
  let arr;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    throw new Error('invalid JSON in response: ' + e.message);
  }
  if (!Array.isArray(arr)) throw new Error('response is not an array');
  if (arr.length !== expectedLen) {
    throw new Error(`length mismatch: expected ${expectedLen}, got ${arr.length}`);
  }
  return arr.map((x) => (x == null ? '' : String(x)));
}

export async function translateBatch(settings, segments, { sourceLang, targetLang, signal }) {
  const res = await fetch(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(buildChatBody({ model: settings.model, segments, sourceLang, targetLang })),
  });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  return parseTranslationResponse(content, segments.length);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/api.js test/api.test.js
git commit -m "feat: API 请求构造与 JSON 响应解析（关思考+容错解析）"
```

---

### Task 5: engine/cache.js（TDD）

**Files:**
- Create: `engine/cache.js`
- Test: `test/cache.test.js`

- [ ] **Step 1: 写失败测试 `test/cache.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, cacheKey } from '../engine/cache.js';
import { fakeStorage } from './settings.test.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('miss then hit; key includes target lang', async () => {
  const c = createCache(fakeStorage());
  assert.equal(await c.get('hello', 'zh-CN'), undefined);
  await c.set('hello', 'zh-CN', '你好');
  assert.equal(await c.get('hello', 'zh-CN'), '你好');
  assert.equal(await c.get('hello', 'ja'), undefined);
});

test('LRU evicts least-recently-used beyond max', async () => {
  const c = createCache(fakeStorage(), { max: 2 });
  await c.set('a', 'x', '1'); await sleep(5);
  await c.set('b', 'x', '2'); await sleep(5);
  await c.get('a', 'x'); await sleep(5); // touch a → b 最旧
  await c.set('c', 'x', '3');
  assert.equal(await c.get('a', 'x'), '1');
  assert.equal(await c.get('b', 'x'), undefined);
  assert.equal(await c.get('c', 'x'), '3');
});

test('cacheKey differs by lang and text', () => {
  assert.notEqual(cacheKey('a', 'zh'), cacheKey('a', 'ja'));
  assert.notEqual(cacheKey('a', 'zh'), cacheKey('b', 'zh'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（Cannot find module `engine/cache.js`）

- [ ] **Step 3: 实现 `engine/cache.js`**

```js
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function cacheKey(text, targetLang) {
  return `${targetLang}:${fnv1a(text)}`;
}

export function createCache(storage, { max = 3000 } = {}) {
  let map = null; // key -> { t: lastTouchMs, v: translated }
  async function load() {
    if (!map) {
      const stored = await storage.get('cache');
      map = new Map(Object.entries(stored.cache || {}));
    }
    return map;
  }
  return {
    async get(text, targetLang) {
      const m = await load();
      const k = cacheKey(text, targetLang);
      if (!m.has(k)) return undefined;
      m.get(k).t = Date.now();
      return m.get(k).v;
    },
    async set(text, targetLang, value) {
      const m = await load();
      m.set(cacheKey(text, targetLang), { t: Date.now(), v: value });
      if (m.size > max) {
        const oldest = [...m.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, m.size - max);
        for (const [k] of oldest) m.delete(k);
      }
      await storage.set({ cache: Object.fromEntries(m) });
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/cache.js test/cache.test.js
git commit -m "feat: LRU 翻译缓存（storage 适配器注入，键含目标语言）"
```

---

### Task 6: engine/rules.js（TDD）

**Files:**
- Create: `engine/rules.js`
- Test: `test/rules.test.js`

- [ ] **Step 1: 写失败测试 `test/rules.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoTranslate, domainOf, normLang } from '../engine/rules.js';

test('site rule never wins over everything', () => {
  assert.equal(shouldAutoTranslate({ pageLang: 'en', targetLang: 'zh-CN', siteRule: 'never', autoTranslateNonTarget: true }), false);
});

test('same language as target never translates, even with always', () => {
  assert.equal(shouldAutoTranslate({ pageLang: 'zh', targetLang: 'zh-CN', siteRule: 'always', autoTranslateNonTarget: true }), false);
});

test('site rule always overrides global switch off', () => {
  assert.equal(shouldAutoTranslate({ pageLang: 'en', targetLang: 'zh-CN', siteRule: 'always', autoTranslateNonTarget: false }), true);
});

test('language-level rule follows global switch; unknown lang never auto', () => {
  assert.equal(shouldAutoTranslate({ pageLang: 'en', targetLang: 'zh-CN', siteRule: null, autoTranslateNonTarget: true }), true);
  assert.equal(shouldAutoTranslate({ pageLang: 'en', targetLang: 'zh-CN', siteRule: null, autoTranslateNonTarget: false }), false);
  assert.equal(shouldAutoTranslate({ pageLang: null, targetLang: 'zh-CN', siteRule: null, autoTranslateNonTarget: true }), false);
});

test('domainOf and normLang basics', () => {
  assert.equal(domainOf('https://a.b.com/x?y=1'), 'a.b.com');
  assert.equal(domainOf('not a url'), null);
  assert.equal(normLang('zh-CN'), 'zh');
  assert.equal(normLang('EN'), 'en');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（Cannot find module `engine/rules.js`）

- [ ] **Step 3: 实现 `engine/rules.js`**

```js
export function normLang(lang) {
  return String(lang || '').toLowerCase().split('-')[0];
}

export function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function shouldAutoTranslate({ pageLang, targetLang, siteRule, autoTranslateNonTarget }) {
  if (siteRule === 'never') return false;
  if (!pageLang || normLang(pageLang) === normLang(targetLang)) return false;
  if (siteRule === 'always') return true;
  return !!autoTranslateNonTarget;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/rules.js test/rules.test.js
git commit -m "feat: 自动翻译规则判定（站点覆盖>同语言跳过>语言级开关）"
```

---

### Task 7: engine/pool.js（TDD）

**Files:**
- Create: `engine/pool.js`
- Test: `test/pool.test.js`

- [ ] **Step 1: 写失败测试 `test/pool.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../engine/pool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('caps concurrency and resolves all results', async () => {
  const pool = createPool(2);
  let active = 0, maxActive = 0;
  const mk = () => pool.run(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await sleep(5); active--; return 'ok';
  });
  const rs = await Promise.all(Array.from({ length: 6 }, mk));
  assert.equal(maxActive, 2);
  assert.deepEqual(rs, Array(6).fill('ok'));
});

test('task error propagates but queue keeps draining', async () => {
  const pool = createPool(1);
  const bad = pool.run(async () => { throw new Error('boom'); });
  const good = pool.run(async () => 42);
  await assert.rejects(bad, /boom/);
  assert.equal(await good, 42);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（Cannot find module `engine/pool.js`）

- [ ] **Step 3: 实现 `engine/pool.js`**

```js
export function createPool(concurrency) {
  let active = 0;
  const queue = [];
  function pump() {
    while (active < concurrency && queue.length) {
      active++;
      const { task, resolve, reject } = queue.shift();
      task()
        .then(resolve, reject)
        .finally(() => { active--; pump(); });
    }
  }
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
      });
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS（全部 6 个测试文件通过）

- [ ] **Step 5: Commit**

```bash
git add engine/pool.js test/pool.test.js
git commit -m "feat: 并发池（限制同时进行的 API 请求数）"
```

---

### Task 8: background.js（service worker 胶水层）

**Files:**
- Create: `background.js`

无单元测试（纯 chrome.* 胶水），Task 9 加载扩展后在 SW 控制台验证。

- [ ] **Step 1: 写 `background.js`**

```js
import { loadSettings } from './engine/settings.js';
import { createCache } from './engine/cache.js';
import { createPool } from './engine/pool.js';
import { packSegments } from './engine/chunker.js';
import { translateBatch } from './engine/api.js';
import { shouldAutoTranslate, domainOf, normLang } from './engine/rules.js';

const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};
const cache = createCache(storage);
const jobs = new Map(); // tabId -> AbortController
let pool = null;
let poolSize = 0;

function getPool(concurrency) {
  if (!pool || poolSize !== concurrency) { pool = createPool(concurrency); poolSize = concurrency; }
  return pool;
}

async function detectLang({ lang, sample }) {
  if (lang && normLang(lang)) return normLang(lang);
  try {
    const det = await chrome.i18n.detectLanguage(sample || ' ');
    const top = (det.languageResults || [])[0];
    return top ? normLang(top.language) : null;
  } catch {
    return null;
  }
}

async function translateAll({ segments, sourceLang, targetLang, tabId, signal }) {
  const settings = await loadSettings(storage);
  const results = new Array(segments.length).fill(null);
  const todo = [];
  for (const seg of segments) {
    const hit = await cache.get(seg.text, targetLang);
    if (hit !== undefined) results[seg.index] = hit;
    else todo.push(seg);
  }
  let doneCount = segments.length - todo.length;
  const notify = () =>
    tabId != null &&
    chrome.tabs.sendMessage(tabId, { type: 'tr-progress', done: doneCount, total: segments.length }).catch(() => {});
  notify();

  const batches = packSegments(todo);
  const p = getPool(settings.concurrency);
  await Promise.all(batches.map((batch) => p.run(async () => {
    if (signal.aborted) return;
    let out = null;
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      try {
        out = await translateBatch(settings, batch, { sourceLang, targetLang, signal });
      } catch {
        out = null;
        if (signal.aborted) return;
      }
    }
    if (!out) {
      if (signal.aborted) return;
      out = await Promise.all(batch.map(async (seg) => {
        try {
          return (await translateBatch(settings, [seg], { sourceLang, targetLang, signal }))[0];
        } catch {
          return seg.text; // 保留原文，工具条标部分完成
        }
      }));
    }
    batch.forEach((seg, i) => {
      results[seg.index] = out[i];
      cache.set(seg.text, targetLang, out[i]).catch(() => {});
    });
    doneCount += batch.length;
    notify();
  })));

  const failed = results.some((r) => r == null);
  if (failed) for (let i = 0; i < results.length; i++) if (results[i] == null) results[i] = segments[i].text;
  return { results, bilingual: settings.bilingual, partial: failed };
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
    if (tabId != null) jobs.set(tabId, controller);
    translateAll({ ...msg, tabId, signal: controller.signal })
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }))
      .finally(() => { if (tabId != null) jobs.delete(tabId); });
    return true;
  }

  if (msg.type === 'test-connection') {
    (async () => {
      try {
        const url = msg.baseUrl.replace(/\/+$/, '') + '/models';
        const res = await fetch(url, { headers: msg.apiKey ? { Authorization: `Bearer ${msg.apiKey}` } : {} });
        const data = await res.json();
        sendResponse({ ok: res.ok, status: res.status, models: (data.data || []).map((m) => m.id) });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
});

function abortJob(tabId) {
  const c = jobs.get(tabId);
  if (c) { c.abort(); jobs.delete(tabId); }
}
chrome.tabs.onRemoved.addListener(abortJob);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading') abortJob(tabId); });
```

- [ ] **Step 2: 语法检查**

Run: `node --check background.js && echo ok`
Expected: `ok`（`node --check` 不解析 import？会按 module 检查失败的话改用 `node --input-type=module --check < background.js`，Expected 同样 `ok`）

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: service worker 翻译引擎（缓存+并发+重试+逐段降级+按tab中止）"
```

---

### Task 9: 页面工具条 + content script + 静态测试页

**Files:**
- Create: `content/toolbar.js`
- Create: `content/content.js`
- Create: `test-pages/static-article.html`

- [ ] **Step 1: 写 `content/toolbar.js`**

```js
// 页面翻译工具条（closed shadow DOM）。与 content.js 共享 isolated world，
// 通过 globalThis.trToolbar 暴露命令式 API。
(() => {
  const LANGS = [
    ['auto', '自动检测'], ['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'],
    ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'],
  ];
  let host = null, els = {}, cb = {};

  function ensure() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:8px;left:8px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .bar{font:13px/1.4 system-ui,sans-serif;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:6px 8px;box-shadow:0 2px 6px rgba(0,0,0,.25)}
        select,button{font:inherit;border:1px solid #dadce0;border-radius:4px;background:#fff;padding:2px 6px;cursor:pointer}
        .status{color:#5f6368;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .status.err{color:#d93025}
      </style>
      <div class="bar">
        <select class="src"></select><span>→</span><select class="dst"></select>
        <button class="toggle">显示原文</button>
        <span class="status"></span>
        <button class="close" title="关闭">✕</button>
      </div>`;
    const q = (s) => shadow.querySelector(s);
    els = { src: q('.src'), dst: q('.dst'), toggle: q('.toggle'), status: q('.status') };
    for (const [v, label] of LANGS) els.src.add(new Option(label, v));
    for (const [v, label] of LANGS) if (v !== 'auto') els.dst.add(new Option(label, v));
    els.src.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.dst.onchange = () => cb.onSwitchLang && cb.onSwitchLang(els.src.value, els.dst.value);
    els.toggle.onclick = () => cb.onToggleOriginal && cb.onToggleOriginal();
    q('.close').onclick = () => cb.onClose && cb.onClose();
    document.documentElement.appendChild(host);
  }

  globalThis.trToolbar = {
    show({ sourceLang = 'auto', targetLang = 'zh-CN', showingOriginal = false, onSwitchLang, onToggleOriginal, onClose } = {}) {
      ensure();
      cb = { onSwitchLang, onToggleOriginal, onClose };
      els.src.value = sourceLang;
      els.dst.value = targetLang;
      els.toggle.textContent = showingOriginal ? '显示译文' : '显示原文';
      els.status.textContent = '';
      els.status.className = 'status';
      host.style.display = '';
    },
    progress(done, total) { if (host) { els.status.textContent = `翻译中 ${done}/${total}`; els.status.className = 'status'; } },
    done() { if (host) els.status.textContent = ''; },
    error(msg) { if (host) { els.status.textContent = msg; els.status.className = 'status err'; } },
    hide() { if (host) host.style.display = 'none'; },
  };
})();
```

- [ ] **Step 2: 写 `content/content.js`**

```js
// DOM 收集、写回、还原、SPA 增量翻译、与 background 消息。
(() => {
  const SKIP = 'script,style,noscript,textarea,input,select,code,pre,svg,template,[contenteditable],[translate="no"],.notranslate,[data-notranslate]';
  const isTop = window.top === window.self;
  const originals = new Map(); // node -> 原始 nodeValue
  const bilingualSpans = [];
  const done = new WeakSet(); // 已翻译节点
  let translating = false, showingOriginal = false, moTimer = null, moStarted = false;
  const state = { translated: false, pageLang: null, targetLang: null };

  function isVisible(node) {
    const el = node.parentElement;
    if (!el || el.closest(SKIP)) return false;
    const r = document.createRange();
    r.selectNodeContents(node);
    const rect = r.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function collectSegments() {
    const segments = [];
    if (!document.body) return segments;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (done.has(node) || originals.has(node)) continue;
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (text.length < 2 || /^[\d\s.,%$€£¥/:;()\-]+$/.test(text)) continue;
      if (!isVisible(node)) continue;
      segments.push({ index: segments.length, text, node });
    }
    return segments;
  }

  function applyResults(segments, results, bilingual) {
    translating = true;
    segments.forEach((seg, i) => {
      const t = results[i];
      if (!t || t === seg.text) return;
      originals.set(seg.node, seg.node.nodeValue);
      done.add(seg.node);
      seg.node.nodeValue = t;
      if (bilingual) {
        const span = document.createElement('span');
        span.setAttribute('data-notranslate', '');
        span.style.cssText = 'display:block;color:#888;font-size:0.85em;';
        span.textContent = seg.text;
        seg.node.parentElement.insertBefore(span, seg.node.nextSibling);
        bilingualSpans.push(span);
      }
    });
    translating = false;
    state.translated = true;
  }

  function restoreOriginal() {
    translating = true;
    for (const [node, text] of originals) { node.nodeValue = text; done.delete(node); }
    originals.clear();
    for (const s of bilingualSpans) s.remove();
    bilingualSpans.length = 0;
    translating = false;
    state.translated = false;
  }

  function showToolbar() {
    if (!isTop) return;
    globalThis.trToolbar.show({
      sourceLang: state.pageLang || 'auto',
      targetLang: state.targetLang || 'zh-CN',
      showingOriginal,
      onSwitchLang: (_src, dst) => { state.targetLang = dst; doTranslate(state.pageLang || 'auto'); },
      onToggleOriginal: () => {
        if (showingOriginal) { doTranslate(state.pageLang || 'auto'); }
        else { restoreOriginal(); showingOriginal = true; showToolbar(); }
      },
      onClose: () => { restoreOriginal(); showingOriginal = false; globalThis.trToolbar.hide(); },
    });
  }

  async function requestTranslation(segments, sourceLang) {
    return chrome.runtime.sendMessage({
      type: 'translate-page',
      segments: segments.map(({ index, text }) => ({ index, text })),
      sourceLang: sourceLang || 'auto',
      targetLang: state.targetLang,
    });
  }

  async function doTranslate(sourceLang) {
    if (translating) return;
    restoreOriginal();
    showingOriginal = false;
    state.targetLang = state.targetLang || 'zh-CN';
    showToolbar();
    const segments = collectSegments();
    if (!segments.length) return;
    translating = true;
    if (isTop) globalThis.trToolbar.progress(0, segments.length);
    try {
      const resp = await requestTranslation(segments, sourceLang);
      if (!resp || !resp.ok) { if (isTop) globalThis.trToolbar.error((resp && resp.error) || '翻译服务不可用'); return; }
      applyResults(segments, resp.results, resp.bilingual);
      if (isTop) { if (resp.partial) globalThis.trToolbar.error('部分段落翻译失败，已保留原文'); else globalThis.trToolbar.done(); }
      startObserver();
    } catch (e) {
      if (isTop) globalThis.trToolbar.error(String((e && e.message) || e));
    } finally {
      translating = false;
    }
  }

  async function translateNew() {
    if (translating || !state.translated) return;
    const segments = collectSegments();
    if (!segments.length) return;
    translating = true;
    try {
      const resp = await requestTranslation(segments, state.pageLang);
      if (resp && resp.ok) applyResults(segments, resp.results, resp.bilingual);
    } catch { /* 增量失败静默，下次 mutation 再试 */ }
    finally { translating = false; }
  }

  function startObserver() {
    if (moStarted || !document.body) return;
    moStarted = true;
    new MutationObserver(() => {
      if (translating || !state.translated) return;
      clearTimeout(moTimer);
      moTimer = setTimeout(translateNew, 800);
    }).observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'tr-progress') { if (isTop) globalThis.trToolbar.progress(msg.done, msg.total); return; }
    if (msg.type === 'popup-get-state') { sendResponse({ translated: state.translated, showingOriginal, pageLang: state.pageLang }); return; }
    if (msg.type === 'popup-translate') { doTranslate(msg.sourceLang || state.pageLang || 'auto'); sendResponse({ ok: true }); return; }
    if (msg.type === 'popup-restore') { restoreOriginal(); showingOriginal = true; showToolbar(); sendResponse({ ok: true }); return; }
  });

  async function init() {
    if (!/^https?:$/.test(location.protocol)) return;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'page-init',
        lang: document.documentElement.lang || null,
        sample: ((document.body && document.body.innerText) || '').slice(0, 2000),
      });
    } catch { return; }
    if (!resp) return;
    state.pageLang = resp.pageLang;
    state.targetLang = resp.targetLang;
    if (resp.autoTranslate) doTranslate(resp.pageLang || 'auto');
  }
  init();
})();
```

- [ ] **Step 3: 写 `test-pages/static-article.html`**

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Static Article Test</title></head>
<body>
  <h1>The History of Translation Machines</h1>
  <p>Translation machines have evolved dramatically over the past seventy years, from rule-based systems to large language models running on local hardware.</p>
  <p>Early systems relied on dictionaries and hand-written grammar rules, which often produced awkward and unnatural sentences.</p>
  <h2>Modern Approaches</h2>
  <ul>
    <li>Statistical machine translation dominated the 2000s.</li>
    <li>Neural models took over after 2014.</li>
    <li>Today, large language models can preserve tone and style.</li>
  </ul>
  <p>Running a model locally protects privacy, because no text ever leaves the user's own machine.</p>
  <pre><code>console.log("this code block must NOT be translated");</code></pre>
  <div translate="no">This div is marked translate=no and must stay in English.</div>
  <textarea>This textarea must not be translated.</textarea>
  <p>1234 5678 -- pure numbers should be skipped.</p>
</body>
</html>
```

- [ ] **Step 4: 语法检查**

Run: `node --check content/toolbar.js && node --check content/content.js && echo ok`
Expected: `ok`

- [ ] **Step 5: 人工验证（需要用户或本机会话操作 Chrome）**

```bash
python3 -m http.server 8080 -d test-pages   # 后台运行
```
Chrome → `chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选项目根目录。打开 `http://localhost:8080/static-article.html`。

Expected（逐项检查）:
1. 页面自动整页变中文（默认规则：非中文→中文），左上角出现工具条。
2. `<code>` 块、`translate="no"` div、textarea 保持英文。
3. 工具条"显示原文"→ 全部还原英文；再点"显示译文"→ 再译回（第二次应明显更快，命中缓存）。
4. 工具条切换目标语言（如 English→日本語 反向）可重新翻译。
5. 关掉 vLLM 服务（或设置页填错地址）后刷新 → 工具条红字"翻译服务不可用"。
6. SW 控制台（chrome://extensions → 检查视图 Service Worker）无报错。

- [ ] **Step 6: Commit**

```bash
git add content/ test-pages/static-article.html
git commit -m "feat: 页面工具条+content script（收集/写回/还原/SPA增量）+静态测试页"
```

---

### Task 10: SPA 动态内容测试页

**Files:**
- Create: `test-pages/spa-dynamic.html`

- [ ] **Step 1: 写 `test-pages/spa-dynamic.html`**

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>SPA Dynamic Test</title></head>
<body>
  <h1>Dynamic Content Test</h1>
  <p>This paragraph exists from the start and should be translated.</p>
  <button id="add">Add paragraph</button>
  <div id="feed"></div>
  <script>
    let n = 0;
    document.getElementById('add').addEventListener('click', () => {
      const p = document.createElement('p');
      p.textContent = `Dynamically added paragraph number ${++n}. It should be translated automatically after a short delay.`;
      document.getElementById('feed').appendChild(p);
    });
    setInterval(() => {
      const p = document.createElement('p');
      p.textContent = `Auto-appended message at ${new Date().toLocaleTimeString()}.`;
      document.getElementById('feed').appendChild(p);
    }, 3000);
  </script>
</body>
</html>
```

- [ ] **Step 2: 人工验证**

打开 `http://localhost:8080/spa-dynamic.html`，等整页翻译完成后：点按钮、等自动追加。
Expected: 新英文段落约 1s 内变中文；已有译文不被重复处理（工具条不闪烁、无死循环——新译文节点因 `done` WeakSet 被跳过）。

- [ ] **Step 3: Commit**

```bash
git add test-pages/spa-dynamic.html
git commit -m "test: SPA 动态内容增量翻译测试页"
```

---

### Task 11: popup + options

**Files:**
- Create: `popup/popup.html`, `popup/popup.js`
- Create: `options/options.html`, `options/options.js`

- [ ] **Step 1: 写 `popup/popup.html`**

```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<style>
  body{font:13px/1.5 system-ui,sans-serif;width:260px;margin:0;padding:12px}
  select,button{font:inherit;width:100%;margin:6px 0;padding:6px;border:1px solid #dadce0;border-radius:6px;background:#fff;cursor:pointer}
  button.primary{background:#1a73e8;color:#fff;border-color:#1a73e8}
  label{display:block;margin-top:8px;color:#3c4043}
  .row{display:flex;gap:6px;align-items:center;justify-content:space-between;margin-top:10px}
  a{color:#1a73e8;cursor:pointer}
</style>
</head>
<body>
  <button id="action" class="primary">翻译此页</button>
  <label>目标语言 <select id="target"></select></label>
  <label>本站 <select id="site"><option value="">默认（按语言规则）</option><option value="always">总是翻译</option><option value="never">永不翻译</option></select></label>
  <div class="row"><span id="status"></span><a id="settings">设置</a></div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 `popup/popup.js`**

```js
const LANGS = [['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'],
  ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский']];
const $ = (s) => document.querySelector(s);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings || {};

  for (const [v, l] of LANGS) $('#target').add(new Option(l, v));
  $('#target').value = settings.targetLang || 'zh-CN';
  $('#target').onchange = () =>
    chrome.storage.local.set({ settings: { ...settings, targetLang: $('#target').value } });

  let page = { translated: false };
  try { page = (await chrome.tabs.sendMessage(tab.id, { type: 'popup-get-state' })) || page; } catch {}
  $('#status').textContent = page.pageLang ? `页面语言: ${page.pageLang}` : '无法检测页面语言';

  const btn = $('#action');
  btn.textContent = page.translated ? '显示原文' : '翻译此页';
  btn.onclick = async () => {
    if (page.translated) await chrome.tabs.sendMessage(tab.id, { type: 'popup-restore' });
    else await chrome.tabs.sendMessage(tab.id, { type: 'popup-translate', targetLang: $('#target').value });
    window.close();
  };

  const domain = tab.url ? new URL(tab.url).hostname : '';
  const sites = (await chrome.storage.local.get('sites')).sites || {};
  $('#site').value = sites[domain] || '';
  $('#site').onchange = async (e) => {
    const next = { ...sites };
    if (e.target.value) next[domain] = e.target.value;
    else delete next[domain];
    await chrome.storage.local.set({ sites: next });
  };

  $('#settings').onclick = () => chrome.runtime.openOptionsPage();
}
init();
```

- [ ] **Step 3: 写 `options/options.html`**

```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<style>
  body{font:14px/1.6 system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#202124}
  h1{font-size:20px}
  label{display:block;margin:14px 0 4px;font-weight:600}
  input,select{width:100%;padding:8px;border:1px solid #dadce0;border-radius:6px;font:inherit}
  .check{display:flex;align-items:center;gap:8px;margin:12px 0}
  .check input{width:auto}
  button{margin-top:16px;padding:8px 16px;border:1px solid #1a73e8;border-radius:6px;background:#1a73e8;color:#fff;font:inherit;cursor:pointer}
  #saved{color:#188038;margin-left:8px}
  #testResult{margin-top:8px;white-space:pre-wrap;color:#5f6368}
</style>
</head>
<body>
  <h1>Local LLM Translate 设置</h1>
  <label>API 地址（OpenAI 兼容，含 /v1）</label>
  <input id="baseUrl" placeholder="http://localhost:8000/v1">
  <label>API Key</label>
  <input id="apiKey" type="password" placeholder="sk-...">
  <label>模型名</label>
  <input id="model" placeholder="qwen35-122b">
  <label>并发请求数（1-8）</label>
  <input id="concurrency" type="number" min="1" max="8" value="3">
  <label>默认目标语言</label>
  <select id="targetLang"></select>
  <div class="check"><input id="bilingual" type="checkbox"><label for="bilingual" style="margin:0">双语显示（译文下附灰色原文）</label></div>
  <div class="check"><input id="autoLang" type="checkbox"><label for="autoLang" style="margin:0">自动翻译非目标语言页面</label></div>
  <button id="test">测试连接</button><span id="saved"></span>
  <pre id="testResult"></pre>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 4: 写 `options/options.js`**

```js
const LANGS = [['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'],
  ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский']];
const $ = (s) => document.querySelector(s);

async function init() {
  const stored = await chrome.storage.local.get('settings');
  const s = stored.settings || {};
  for (const [v, l] of LANGS) $('#targetLang').add(new Option(l, v));
  $('#baseUrl').value = s.baseUrl || 'http://localhost:8000/v1';
  $('#apiKey').value = s.apiKey || '';
  $('#model').value = s.model || 'qwen35-122b';
  $('#concurrency').value = s.concurrency || 3;
  $('#targetLang').value = s.targetLang || 'zh-CN';
  $('#bilingual').checked = !!s.bilingual;
  $('#autoLang').checked = s.autoTranslateNonTarget !== false;

  const save = async () => {
    const next = {
      baseUrl: $('#baseUrl').value.trim() || 'http://localhost:8000/v1',
      apiKey: $('#apiKey').value.trim(),
      model: $('#model').value.trim() || 'qwen35-122b',
      concurrency: Math.max(1, Math.min(8, Number($('#concurrency').value) || 3)),
      targetLang: $('#targetLang').value,
      bilingual: $('#bilingual').checked,
      autoTranslateNonTarget: $('#autoLang').checked,
    };
    await chrome.storage.local.set({ settings: next });
    $('#saved').textContent = '已保存';
    setTimeout(() => { $('#saved').textContent = ''; }, 1500);
  };
  document.querySelectorAll('input,select').forEach((el) => { el.onchange = save; });

  $('#test').onclick = async () => {
    $('#testResult').textContent = '测试中…';
    const r = await chrome.runtime.sendMessage({
      type: 'test-connection',
      baseUrl: $('#baseUrl').value.trim(),
      apiKey: $('#apiKey').value.trim(),
    });
    $('#testResult').textContent = r && r.ok
      ? '✔ 连接成功，可用模型:\n' + (r.models || []).join('\n')
      : '✘ 连接失败: ' + ((r && (r.error || r.status)) || '未知错误');
  };
}
init();
```

- [ ] **Step 5: 人工验证**

1. 重载扩展。设置页填 API 地址/key → "测试连接"显示模型列表（含 qwen35-122b）。
2. 打开测试页 → popup 显示"显示原文"（因自动翻译已生效）→ 点击还原。
3. popup"本站=永不翻译" → 刷新测试页不再自动翻译；"总是翻译" → 恢复。
4. 双语显示开启后翻译，译文下出现灰色原文。

- [ ] **Step 6: Commit**

```bash
git add popup/ options/
git commit -m "feat: popup（翻译/还原/站点规则）+ options（API设置/测试连接/双语/自动规则）"
```

---

### Task 12: README + 端到端验收

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 `README.md`**

```markdown
# Local LLM Translate

Chrome MV3 整页翻译扩展，翻译后端为可配置的 OpenAI 兼容 API（默认 vLLM qwen35-122b）。

## 安装
1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选本目录。
2. 点扩展图标 → 设置 → 填 API 地址（含 /v1）、Key、模型名 → 测试连接。

## 使用
- 打开任意英文页面自动整页翻译（可在设置/popup 调整规则）。
- 页面左上角工具条：切换语言、显示原文/译文、关闭。
- popup：手动翻译/还原、目标语言、本站总是/永不翻译。

## 开发
- 单元测试：`npm test`（engine/ 纯逻辑，node --test）。
- 人工验证：`python3 -m http.server 8080 -d test-pages` 后访问
  http://localhost:8080/static-article.html 与 spa-dynamic.html。
- 改代码后需在 chrome://extensions 点扩展的"重新加载"。

## 注意
- API key 只存 chrome.storage.local，不写文件不进 git。
- 翻译请求必须关思考模式（engine/api.js 已固定 enable_thinking:false）。
```

- [ ] **Step 2: 全量回归**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: 端到端清单（人工，同 Task 9 Step 5 + Task 10 + Task 11 Step 5 全过一遍）**

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: 使用说明与开发验证流程"
```

---

## Self-Review 结论

- Spec 覆盖：整页翻译(T8/T9)、还原/双语(T9)、自动规则(T6/T8/T11)、缓存(T5)、错误态(T8/T9)、测试页(T9/T10)、key 不进仓库(T12) ✅
- 无占位符 ✅；接口一致性：`{index,text}` 段格式、storage 适配器、`trToolbar` API、消息类型名在各任务间已核对一致 ✅
