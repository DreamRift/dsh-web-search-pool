import { test } from 'node:test';
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

let usageCalls = 0;
let searchCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/usage')) {
    usageCalls += 1;
    // 第一次只剩 1 credit（< 保留值 2），之后刷新恢复 1000。
    const remaining = usageCalls === 1 ? 1 : 1000;
    return jsonResponse(200, {
      key: { usage: 1000 - remaining, limit: null },
      account: { current_plan: 'Researcher', plan_usage: 1000 - remaining, plan_limit: 1000 },
    });
  }
  if (String(url).includes('/search')) {
    searchCalls += 1;
    return jsonResponse(200, {
      results: [{ url: 'https://a.com', title: 'A', content: 'snippet' }],
    });
  }
  throw new Error('unexpected fetch url: ' + url);
};

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
    tavilyParams: {},
    exaParams: {},
    resolveKey: async () => 'tvly-test',
    recordRequest: () => {},
  };
}

test('SearchPoolProvider: Tavily 额度不足进入长冷却，刷新恢复后自动解除', async () => {
  usageCalls = 0;
  searchCalls = 0;
  const provider = new SearchPoolProvider(options);
  const first = await provider.search({ query: 'q', maxResults: 8 })
    .then(() => 'ok')
    .catch((error) => 'error:' + error.code);
  assert.equal(first, 'error:WEB_PROVIDER_ERROR');
  assert.equal(searchCalls, 0);
  assert.equal(usageCalls, 1);

  const second = await provider.search({ query: 'q', maxResults: 8 });
  assert.equal(second.sources.length, 1);
  assert.equal(searchCalls, 1);
  assert.equal(usageCalls, 2);
});

test('SearchPoolProvider: refreshUsage 发布总消耗/总可用快照', async () => {
  usageCalls = 0;
  const published = [];
  const provider = new SearchPoolProvider(options, {
    publishUsage: (snapshot) => { published.push(snapshot); },
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
    publishUsage: (snapshot, diagnostic) => { published.push({ snapshot, diagnostic }); },
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
    publishUsage: (snapshot, diagnostic) => { published.push({ snapshot, diagnostic }); },
  });
  const result = await provider.refreshUsage(provider.resolveOptions());
  assert.equal(published.length, 1);
  assert.equal(published[0].snapshot.keys.length, 0);
  assert.match(published[0].diagnostic, /没有可查询的 Tavily key/);
  assert.ok(result.updatedAt > 0);
});
