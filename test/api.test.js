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
