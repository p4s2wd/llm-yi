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
