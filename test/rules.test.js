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
