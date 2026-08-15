import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPool } from '../src/core/key-pool.js';
import { TokenBucketLimiter } from '../src/core/rate-limiter.js';
import { Scheduler } from '../src/core/scheduler.js';

function buildScheduler({ rpm = {}, allowedFails = 3, cooldownMs = 30_000, strategy = 'weighted-round-robin', providerPriority = ['tavily', 'exa'], now = () => Date.now() } = {}) {
  const entries = [
    { id: 't1', provider: 'tavily', credentialRef: 'T1', rpm: rpm.t1 ?? 60 },
    { id: 't2', provider: 'tavily', credentialRef: 'T2', rpm: rpm.t2 ?? 60 },
    { id: 'e1', provider: 'exa', credentialRef: 'E1', rpm: rpm.e1 ?? 30 },
  ];
  const keyPool = new KeyPool(entries, { allowedFails, cooldownMs });
  const rateLimiter = new TokenBucketLimiter({ capacityFor: (id) => keyPool.entryById(id)?.rpm ?? 60 });
  const scheduler = new Scheduler({ keyPool, rateLimiter, strategy, providerPriority, now });
  return { keyPool, rateLimiter, scheduler };
}

test('Scheduler: 默认供应商优先级——先 tavily 后 exa', () => {
  const { scheduler } = buildScheduler();
  const e = scheduler.acquire();
  assert.equal(e.provider, 'tavily');
});

test('Scheduler: 供应商内 429 冷却后换下一个 key', () => {
  const { scheduler } = buildScheduler();
  const e1 = scheduler.acquire();
  scheduler.recordRateLimit(e1, 60_000);
  const e2 = scheduler.acquire();
  assert.notEqual(e2.id, e1.id);
});

test('Scheduler: 供应商内 key 全部冷却后 failover 到 exa', () => {
  const { scheduler } = buildScheduler();
  const t1 = scheduler.acquire();
  scheduler.recordRateLimit(t1, 60_000);
  const t2 = scheduler.acquire();
  scheduler.recordRateLimit(t2, 60_000);
  const e = scheduler.acquire();
  assert.equal(e.provider, 'exa');
});

test('Scheduler: 全部 key 冷却后 acquire 返回 null', () => {
  const { scheduler } = buildScheduler();
  const seen = new Set();
  let e;
  while ((e = scheduler.acquire()) != null) {
    seen.add(e.id);
    scheduler.recordRateLimit(e, 60_000);
  }
  assert.equal(seen.size, 3); // 三个 key 都被试过
  assert.equal(scheduler.acquire(), null);
});

test('Scheduler: 加权轮询——高 rpm 的 key 被选中更多', () => {
  const { scheduler } = buildScheduler({ rpm: { t1: 90, t2: 30 } });
  const counts = { t1: 0, t2: 0 };
  for (let i = 0; i < 60; i++) {
    const e = scheduler.acquire();
    counts[e.id] += 1;
  }
  assert.equal(counts.t1 + counts.t2, 60);
  assert.ok(counts.t1 > counts.t2, `t1(${counts.t1}) 应多于 t2(${counts.t2})`);
  assert.ok(counts.t1 >= counts.t2 * 2, `权重 3:1 下 t1(${counts.t1}) 应至少是 t2(${counts.t2}) 的两倍`);
});

test('Scheduler: least-used 策略选择剩余令牌最多的 key', () => {
  let now = 0;
  const { scheduler, rateLimiter } = buildScheduler({ strategy: 'least-used', now: () => now });
  // 预先消耗 t1 的令牌，使其剩余更少（固定时间，避免真实时钟 refill 干扰）
  for (let i = 0; i < 30; i++) rateLimiter.tryAcquire('t1', now);
  const e = scheduler.acquire();
  assert.equal(e.id, 't2'); // t2 剩余令牌更多
});

test('Scheduler: recordError 连续失败触发熔断，key 暂时不可用', () => {
  const { scheduler } = buildScheduler({ allowedFails: 3 });
  const e = scheduler.acquire();
  scheduler.recordError(e);
  scheduler.recordError(e);
  scheduler.recordError(e); // 第 3 次熔断
  const next = scheduler.acquire();
  assert.notEqual(next.id, e.id); // 熔断的 key 不再被选
});

test('Scheduler: recordSuccess 清零失败计数', () => {
  const { scheduler } = buildScheduler({ allowedFails: 2 });
  const e = scheduler.acquire();
  scheduler.recordError(e);
  scheduler.recordSuccess(e); // 清零
  scheduler.recordError(e);
  // 未达 2 次，不熔断：该 key 仍可用（token 足够时会被再选到）
  assert.ok(scheduler.keyPool.entryById(e.id).failCount < 2);
});
