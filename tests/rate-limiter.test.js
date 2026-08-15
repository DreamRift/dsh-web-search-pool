import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketLimiter, MemoryStore } from '../src/core/rate-limiter.js';

test('TokenBucketLimiter: 初始令牌数等于 capacity', () => {
  const limiter = new TokenBucketLimiter({ capacityFor: () => 60 });
  assert.equal(limiter.tokens('k1', 0), 60);
});

test('TokenBucketLimiter: tryAcquire 逐个消费，耗尽后拒绝', () => {
  const limiter = new TokenBucketLimiter({ capacityFor: () => 2 });
  assert.equal(limiter.tryAcquire('k1', 0), true);
  assert.equal(limiter.tryAcquire('k1', 0), true);
  assert.equal(limiter.tryAcquire('k1', 0), false);
});

test('TokenBucketLimiter: 时间推进后按 refill 速率补充', () => {
  const limiter = new TokenBucketLimiter({ capacityFor: () => 60 }); // refill 1 token/s
  for (let i = 0; i < 60; i++) assert.equal(limiter.tryAcquire('k1', 0), true);
  assert.equal(limiter.tryAcquire('k1', 0), false);
  // 推进 1 秒补充 1 个令牌
  assert.equal(limiter.tryAcquire('k1', 1_000), true);
});

test('TokenBucketLimiter: 补充不超过 capacity', () => {
  const limiter = new TokenBucketLimiter({ capacityFor: () => 60 });
  limiter.tryAcquire('k1', 0); // 剩 59
  assert.equal(limiter.tokens('k1', 100_000), 60); // 长时间后回满但封顶 60
});

test('TokenBucketLimiter: capacityFor 按 key 区分容量', () => {
  const caps = { a: 2, b: 5 };
  const limiter = new TokenBucketLimiter({ capacityFor: (id) => caps[id] });
  assert.equal(limiter.tokens('a', 0), 2);
  assert.equal(limiter.tokens('b', 0), 5);
});

test('TokenBucketLimiter: 使用注入的 store（可序列化状态）', () => {
  const store = new MemoryStore();
  const limiter = new TokenBucketLimiter({ capacityFor: () => 3, store });
  limiter.tryAcquire('k1', 0);
  const state = store.get('k1');
  assert.equal(state.tokens, 2);
  assert.ok(Number.isFinite(state.lastRefill));
});

test('TokenBucketLimiter: refillPerSec 可覆盖补充速率（严格 1 秒 1 次）', () => {
  const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 1 });
  assert.equal(limiter.tokens('k1', 0), 1);
  assert.equal(limiter.tryAcquire('k1', 0), true);
  assert.equal(limiter.tryAcquire('k1', 0), false);
  assert.equal(limiter.tryAcquire('k1', 999), false);
  assert.equal(limiter.tryAcquire('k1', 1_000), true);
  assert.equal(limiter.tryAcquire('k1', 1_000), false);
});

test('TokenBucketLimiter: refillPerSecFor 按 key 区分补充速率', () => {
  const limiter = new TokenBucketLimiter({
    capacityFor: () => 60,
    refillPerSecFor: (id) => (id === 'slow' ? 1 : 10),
  });
  for (let i = 0; i < 60; i++) assert.equal(limiter.tryAcquire('slow', 0), true);
  assert.equal(limiter.tryAcquire('slow', 999), false);
  assert.equal(limiter.tryAcquire('slow', 1_000), true);
});
