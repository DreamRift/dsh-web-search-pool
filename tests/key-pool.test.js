import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPool } from '../src/core/key-pool.js';

function makeEntries() {
  return [
    { id: 't1', provider: 'tavily', credentialRef: 'TAVILY_1', rpm: 60 },
    { id: 't2', provider: 'tavily', credentialRef: 'TAVILY_2', rpm: 60 },
    { id: 'e1', provider: 'exa', credentialRef: 'EXA_1', rpm: 30 },
  ];
}

test('KeyPool: entriesForProvider 分组正确', () => {
  const pool = new KeyPool(makeEntries());
  assert.equal(pool.entriesForProvider('tavily').length, 2);
  assert.equal(pool.entriesForProvider('exa').length, 1);
  assert.equal(pool.totalKeys, 3);
});

test('KeyPool: isCooling 与 markCooldown 的边界', () => {
  const pool = new KeyPool(makeEntries(), { cooldownMs: 30_000 });
  const e = pool.entryById('t1');
  assert.equal(pool.isCooling(e, 0), false);
  pool.markCooldown(e, 0, 1_000);
  assert.equal(pool.isCooling(e, 1_000 + 29_999), true);
  assert.equal(pool.isCooling(e, 1_000 + 30_000), false);
});

test('KeyPool: markCooldown 取 retryAfter 与 cooldownMs 较大者', () => {
  const pool = new KeyPool(makeEntries(), { cooldownMs: 30_000 });
  const e = pool.entryById('t1');
  pool.markCooldown(e, 60_000, 1_000); // retryAfter 更大，覆盖默认冷却
  assert.equal(e.cooldownUntil, 1_000 + 60_000);
});

test('KeyPool: 连续失败达到 allowedFails 熔断并清零计数', () => {
  const pool = new KeyPool(makeEntries(), { allowedFails: 3, cooldownMs: 30_000 });
  const e = pool.entryById('t1');
  pool.markFailure(e, 1_000);
  pool.markFailure(e, 1_000);
  assert.equal(pool.isCooling(e, 1_000), false); // 未达阈值
  pool.markFailure(e, 1_000);
  assert.equal(pool.isCooling(e, 1_000), true); // 熔断
  assert.equal(e.failCount, 0); // 熔断后清零
});

test('KeyPool: markSuccess 清零失败计数', () => {
  const pool = new KeyPool(makeEntries(), { allowedFails: 3 });
  const e = pool.entryById('t1');
  pool.markFailure(e, 1_000);
  pool.markFailure(e, 1_000);
  pool.markSuccess(e);
  assert.equal(e.failCount, 0);
});

test('KeyPool: clearCooldown 手动解除长冷却', () => {
  const pool = new KeyPool(makeEntries(), { cooldownMs: 30_000 });
  const e = pool.entryById('t1');
  const now = Date.now();
  pool.markCooldown(e, 30 * 24 * 60 * 60 * 1_000, now); // 30 天长冷却
  assert.equal(pool.isCooling(e, now + 1_000), true);
  pool.clearCooldown(e);
  assert.equal(pool.isCooling(e, now + 1_000), false);
  assert.equal(e.cooldownUntil, 0);
});
