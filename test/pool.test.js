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
