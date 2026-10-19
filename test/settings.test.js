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
