import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SearchPoolProvider } from '../src/dsh/provider.js';

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  };
}

/** 模拟真实 fetch 的挂起行为：仅在 signal abort 时 reject AbortError。 */
function hangingResponse(init) {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

let usageCalls = 0;
let searchCalls = 0;
/** 这些 api_key 的 /search 请求将挂起（用于超时测试）。 */
let hangingApiKeys = new Set();
/** 这些 api_key 的 /search 请求返回 HTTP 500（用于 failover 测试）。 */
let failingApiKeys = new Set();
/** 每次上游搜索尝试按顺序记一条 `<provider>:<apiKey>`，用于断言「同一次搜索不重复试同一 key」。 */
let upstream = [];

/** 重置全部 mock 状态（新用例开头统一调用，避免跨用例串味）。 */
function resetUpstream() {
  usageCalls = 0;
  searchCalls = 0;
  hangingApiKeys = new Set();
  failingApiKeys = new Set();
  upstream = [];
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (target.includes('/usage')) {
    usageCalls += 1;
    // 第一次只剩 1 credit（< 保留值 2），之后刷新恢复 1000。
    const remaining = usageCalls === 1 ? 1 : 1000;
    return jsonResponse(200, {
      key: { usage: 1000 - remaining, limit: null },
      account: { current_plan: 'Researcher', plan_usage: 1000 - remaining, plan_limit: 1000 },
    });
  }
  // Exa REST（有 key）与 Tavily 都叫 /search，按 host 区分：Exa 用 x-api-key 头。
  if (target.includes('api.exa.ai/search')) {
    const apiKey = init.headers?.['x-api-key'];
    upstream.push('exa:' + apiKey);
    if (failingApiKeys.has(apiKey)) return jsonResponse(500, {});
    searchCalls += 1;
    return jsonResponse(200, {
      results: [{ url: 'https://e.com', title: 'E', text: 'exa snippet', publishedDate: '2026-01-02' }],
    });
  }
  if (target.includes('/search')) {
    const apiKey = JSON.parse(init.body).api_key;
    upstream.push('tavily:' + apiKey);
    if (hangingApiKeys.has(apiKey)) return hangingResponse(init);
    if (failingApiKeys.has(apiKey)) return jsonResponse(500, {});
    searchCalls += 1;
    return jsonResponse(200, {
      results: [{ url: 'https://a.com', title: 'A', content: 'snippet' }],
    });
  }
  throw new Error('unexpected fetch url: ' + url);
};
// 恢复全局 fetch：本文件若与其他测试同进程顺序运行，不污染后续文件。
after(() => {
  globalThis.fetch = originalFetch;
});

function options() {
  return {
    enabled: true,
    available: true,
    entries: [{ id: 't1', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_1', rpm: 60 }],
    strategy: 'weighted-round-robin',
    providerPriority: ['tavily'],
    allowedFails: 3,
    cooldownMs: 30000,
    retryAfterFallbackMs: 1000,
    usageCacheMs: 0,
    quotaReserveCredits: 2,
    quotaExhaustedCooldownMs: 1000,
    requestTimeoutMs: 5_000,
    tavilyParams: {},
    exaParams: {},
    resolveKey: async () => 'tvly-test',
    recordRequest: () => {},
  };
}

test('SearchPoolProvider: Tavily 额度不足进入长冷却，刷新恢复后自动解除', async () => {
  usageCalls = 0;
  searchCalls = 0;
  hangingApiKeys = new Set();
  const opts = { ...options(), usageCacheMs: 60_000 };
  const provider = new SearchPoolProvider(() => opts);
  // 先建立「剩余 1 credit」的额度缓存（第一次 /usage 返回 remaining=1）。
  await provider.refreshUsage(opts);
  assert.equal(usageCalls, 1);
  // 闸门拦截：不发 /search，key 进长冷却。
  const first = await provider.search({ query: 'q', maxResults: 8 })
    .then(() => 'ok')
    .catch((error) => 'error:' + error.code);
  assert.equal(first, 'error:WEB_PROVIDER_ERROR');
  assert.equal(searchCalls, 0);
  assert.equal(usageCalls, 1); // 缓存未过期，搜索路径不再触发刷新
  // 手动刷新（第二次 /usage 返回 remaining=1000）→ 额度恢复自动解除长冷却。
  await provider.refreshUsage(opts);
  const second = await provider.search({ query: 'q', maxResults: 8 });
  assert.equal(second.sources.length, 1);
  assert.equal(searchCalls, 1);
  assert.equal(usageCalls, 2);
});

test('SearchPoolProvider: 搜索不等待额度刷新（后台化），无缓存时直接放行', async () => {
  usageCalls = 0;
  searchCalls = 0;
  hangingApiKeys = new Set();
  const provider = new SearchPoolProvider(options); // usageCacheMs: 0 → 必发起后台刷新
  const result = await provider.search({ query: 'q', maxResults: 8 });
  assert.equal(result.sources.length, 1);
  assert.equal(searchCalls, 1);
  // 搜索已同步完成；后台刷新随后落地（等待微任务/定时器排空）。
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(usageCalls, 1);
});

test('SearchPoolProvider: refreshUsage 发布总消耗/总可用快照', async () => {
  usageCalls = 0;
  const published = [];
  const provider = new SearchPoolProvider(options, {
    logUsage: (snapshot) => { published.push(snapshot); },
  });
  await provider.refreshUsage(provider.resolveOptions());
  assert.equal(published.length, 1);
  const snapshot = published[0];
  assert.equal(snapshot.totalUsed, 999);
  assert.equal(snapshot.totalLimit, 1000);
  assert.equal(snapshot.keys.length, 1);
  assert.equal(snapshot.keys[0].ref, 'TAVILY_API_KEY_1');
  assert.equal(snapshot.keys[0].remaining, 1);
});

test('SearchPoolProvider: refreshUsage 部分失败时发布诊断并更新时间', async () => {
  usageCalls = 0;
  const published = [];
  const provider = new SearchPoolProvider(() => ({
    ...options(),
    entries: [
      { id: 't1', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_1', rpm: 60 },
      { id: 't2', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_2', rpm: 60 },
    ],
    resolveKey: async (entry) => entry.credentialRef === 'TAVILY_API_KEY_2' ? null : 'tvly-test',
  }), {
    logUsage: (snapshot, diagnostic) => { published.push({ snapshot, diagnostic }); },
  });
  const result = await provider.refreshUsage(provider.resolveOptions());
  assert.equal(published.length, 1);
  assert.equal(published[0].snapshot.totalUsed, 999);
  assert.equal(published[0].snapshot.keys.length, 1);
  assert.match(published[0].diagnostic, /TAVILY_API_KEY_2: 未配置凭据/);
  assert.ok(result.updatedAt > 0);
});

test('SearchPoolProvider: refreshUsage 无 Tavily key 时发布可见诊断', async () => {
  const published = [];
  const provider = new SearchPoolProvider(() => ({
    ...options(),
    entries: [{ id: 'e1', provider: 'exa', credentialRef: 'EXA_API_KEY_1', rpm: 30 }],
  }), {
    logUsage: (snapshot, diagnostic) => { published.push({ snapshot, diagnostic }); },
  });
  const result = await provider.refreshUsage(provider.resolveOptions());
  assert.equal(published.length, 1);
  assert.equal(published[0].snapshot.keys.length, 0);
  assert.match(published[0].diagnostic, /没有可查询的 Tavily key/);
  assert.ok(result.updatedAt > 0);
});

test('SearchPoolProvider: 并发 refreshUsage 复用同一次刷新（防重入）', async () => {
  usageCalls = 0;
  const provider = new SearchPoolProvider(options);
  const [a, b] = await Promise.all([
    provider.refreshUsage(provider.resolveOptions()),
    provider.refreshUsage(provider.resolveOptions()),
  ]);
  assert.equal(a, b); // 单飞：两次调用拿到同一个快照对象
  assert.equal(usageCalls, 1);
});

test('SearchPoolProvider: 单次请求超时按 key 失败处理并换 key', async () => {
  resetUpstream();
  hangingApiKeys = new Set(['tvly-slow']);
  // rpm 故意配成 60/10：smooth WRR 会连续偏向 t1，只有「排除已试 entry」才能推进到 t2。
  const provider = new SearchPoolProvider(() => ({
    ...options(),
    quotaReserveCredits: 0,
    entries: [
      { id: 't1', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_1', rpm: 60 },
      { id: 't2', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_2', rpm: 10 },
    ],
    requestTimeoutMs: 50,
    resolveKey: async (entry) => entry.id === 't1' ? 'tvly-slow' : 'tvly-fast',
  }));
  const started = Date.now();
  const result = await provider.search({ query: 'q', maxResults: 8 });
  const elapsed = Date.now() - started;
  assert.equal(result.sources.length, 1);
  assert.equal(searchCalls, 1); // 快 key 成功返回
  assert.deepEqual(upstream, ['tavily:tvly-slow', 'tavily:tvly-fast']); // 每个 key 只试一次
  assert.ok(elapsed < 4_000, `超时后应快速换 key，实际耗时 ${elapsed}ms`);
});

test('SearchPoolProvider: 同供应商 key 返回 HTTP 500 时换下一个 key（不重复试同一 key）', async () => {
  resetUpstream();
  failingApiKeys = new Set(['tvly-bad']);
  const requests = [];
  const provider = new SearchPoolProvider(() => ({
    ...options(),
    quotaReserveCredits: 0,
    entries: [
      { id: 't1', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_1', rpm: 60 },
      { id: 't2', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_2', rpm: 10 },
    ],
    resolveKey: async (entry) => entry.id === 't1' ? 'tvly-bad' : 'tvly-good',
    recordRequest: (record) => { requests.push(record); },
  }));
  const result = await provider.search({ query: 'q', maxResults: 8 });
  assert.equal(result.sources.length, 1);
  assert.deepEqual(upstream, ['tavily:tvly-bad', 'tavily:tvly-good']);
  assert.deepEqual(requests.map((r) => r.keyId), ['t1', 't2']);
});

test('SearchPoolProvider: 高优先级供应商 5xx 时 failover 到下一个供应商', async () => {
  resetUpstream();
  failingApiKeys = new Set(['tvly-bad']);
  const provider = new SearchPoolProvider(() => ({
    ...options(),
    quotaReserveCredits: 0,
    entries: [
      { id: 't1', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_1', rpm: 60 },
      { id: 'e1', provider: 'exa', credentialRef: 'EXA_API_KEY_1', rpm: 30 },
    ],
    providerPriority: ['tavily', 'exa'],
    resolveKey: async (entry) => entry.provider === 'tavily' ? 'tvly-bad' : 'exa-good',
  }));
  const result = await provider.search({ query: 'q', maxResults: 8 });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://e.com');
  assert.deepEqual(upstream, ['tavily:tvly-bad', 'exa:exa-good']);
});

test('SearchPoolProvider: 全部 key 失败时每个 key 只尝试一次', async () => {
  resetUpstream();
  failingApiKeys = new Set(['tvly-bad-1', 'tvly-bad-2']);
  const provider = new SearchPoolProvider(() => ({
    ...options(),
    quotaReserveCredits: 0,
    entries: [
      { id: 't1', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_1', rpm: 60 },
      { id: 't2', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_2', rpm: 10 },
    ],
    resolveKey: async (entry) => entry.id === 't1' ? 'tvly-bad-1' : 'tvly-bad-2',
  }));
  await assert.rejects(
    provider.search({ query: 'q', maxResults: 8 }),
    (error) => error.code === 'WEB_PROVIDER_ERROR',
  );
  assert.equal(upstream.length, 2);
  assert.equal(new Set(upstream).size, 2); // 没有重复尝试
});

test('SearchPoolProvider: resolveKey 抛错按 key 失败处理，不中断整个搜索', async () => {
  usageCalls = 0;
  searchCalls = 0;
  hangingApiKeys = new Set();
  const requests = [];
  const provider = new SearchPoolProvider(() => ({
    ...options(),
    entries: [
      { id: 't1', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_1', rpm: 60 },
      { id: 't2', provider: 'tavily', credentialRef: 'TAVILY_API_KEY_2', rpm: 60 },
    ],
    resolveKey: async (entry) => {
      if (entry.id === 't1') throw new Error('launch environment service down');
      return 'tvly-test';
    },
    recordRequest: (record) => { requests.push(record); },
  }));
  const result = await provider.search({ query: 'q', maxResults: 8 });
  assert.equal(result.sources.length, 1);
  assert.ok(requests.some((r) => r.code === 'KEY_RESOLVE_FAILED' && r.keyId === 't1'));
});

test('SearchPoolProvider: dispose 后搜索判定不可用', async () => {
  const provider = new SearchPoolProvider(options);
  assert.equal(provider.available(), true);
  provider.dispose();
  assert.equal(provider.available(), false);
  await assert.rejects(
    provider.search({ query: 'q' }),
    (error) => error.code === 'WEB_PROVIDER_UNAVAILABLE',
  );
});

