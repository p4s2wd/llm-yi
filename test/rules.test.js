import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoTranslate, domainOf, normLang, pickPageLang } from '../engine/rules.js';

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
  assert.equal(shouldAutoTranslate({ pageLang: 'und', targetLang: 'zh-CN', siteRule: null, autoTranslateNonTarget: true }), false);
  assert.equal(shouldAutoTranslate({ pageLang: 'en', targetLang: 'zh-CN', siteRule: 'yes', autoTranslateNonTarget: true }), true); // garbage siteRule falls open
});

test('domainOf and normLang basics', () => {
  assert.equal(domainOf('https://a.b.com/x?y=1'), 'a.b.com');
  assert.equal(domainOf('not a url'), null);
  assert.equal(normLang('zh-CN'), 'zh');
  assert.equal(normLang('EN'), 'en');
});

test('pickPageLang: aol scenario — reliable detection beats wrong declared lang', () => {
  assert.equal(pickPageLang('zh-CN', { isReliable: true, languages: [{ language: 'en', percentage: 80 }] }), 'en');
});

test('pickPageLang: declared matches detection', () => {
  assert.equal(pickPageLang('en', { isReliable: true, languages: [{ language: 'en', percentage: 90 }] }), 'en');
});

test('pickPageLang: unreliable detection loses to declaration', () => {
  assert.equal(pickPageLang('zh', { isReliable: false, languages: [{ language: 'en', percentage: 90 }] }), 'zh');
});

test('pickPageLang: low percentage loses to declaration', () => {
  assert.equal(pickPageLang('zh', { isReliable: true, languages: [{ language: 'en', percentage: 40 }] }), 'zh');
});

test('pickPageLang: no declaration uses reliable detection', () => {
  assert.equal(pickPageLang(null, { isReliable: true, languages: [{ language: 'en', percentage: 60 }] }), 'en');
});

test('pickPageLang: no declaration and low percentage yields null', () => {
  assert.equal(pickPageLang(null, { isReliable: true, languages: [{ language: 'en', percentage: 30 }] }), null);
});

test('pickPageLang: no declaration and no detection yields null', () => {
  assert.equal(pickPageLang(null, { isReliable: false, languages: [] }), null);
});

test('pickPageLang: null detection falls back to declaration', () => {
  assert.equal(pickPageLang('en', null), 'en');
});

test('pickPageLang: region normalization on detection winner', () => {
  assert.equal(pickPageLang('en-US', { isReliable: true, languages: [{ language: 'pt-BR', percentage: 70 }] }), 'pt');
});
