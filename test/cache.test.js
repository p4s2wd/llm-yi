import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, cacheKey } from '../engine/cache.js';
import { fakeStorage } from './helpers.js';

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
