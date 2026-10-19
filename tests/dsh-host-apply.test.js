/**
 * Host half 集成测试：用真实的 `@deepseek-ai/cordis` + Loader + schemastery
 * （0.2.1-rc.2 同构接口）驱动 `src/dsh/index.js`，守住 0.5.0 接管契约：
 *
 * 1. 行能加载、apply 能跑、provider 注册进 web seam；
 * 2. Config 的 volatile 字段在 fiber config 里是 Ref（`config.enabled.get()`）；
 * 3. 启用时不改 `web` 行配置，而是在 **`ctx.web.search` 服务方法**上接管：
 *    无论 `searchProvider` 是 deepseek-official / deepseek-search-api / 未来 id，
 *    调用都走 key 池；官方 provider 对象本身不被修改；
 * 4. 关闭时 wrapper 委托回原 `web.search`，官方 provider 原样可用；
 * 5. 池不可用/失败默认不回退官方，抛中性错误；`fallbackToOfficial: true` 才回退；
 * 6. 结果只保留官方 seam 同形的 `{ content?, sources, truncated }` 并按 maxResults 截断；
 * 7. 官方 provider 晚注册 / web 服务重挂时无需重新接管；dispose 完整恢复。
 *
 * 依赖说明：`@deepseek-ai/cordis`、`cordis-plugin-loader`、`schemastery`、
 * `dsh-web`、`dsh-credentials`、`dsh-launch-environment` 都是插件 peerDependencies
 * 里声明的 DSH 运行时包（本地 node_modules 由 `node scripts/sync-peer-deps.mjs
 * <app.asar 提取目录>` 同步，node_modules 不入库）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import * as plugin from '../src/dsh/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const rootBaseUrl = pathToFileURL(here + '../').href;

const BASE_CONFIG = {
  enabled: true,
  fallbackToOfficial: false,
  providers: {
    tavily: { keys: [{ apiKeyEnv: 'TAVILY_API_KEY_1', rpm: 30 }] },
    exa: { keys: [] },
  },
  strategy: 'weighted-round-robin',
  providerPriority: ['tavily', 'exa'],
  allowedFails: 3,
  cooldownMs: 30000,
  retryAfterFallbackMs: 1000,
  usageCacheMs: 300000,
  quotaReserveCredits: 2,
  quotaExhaustedCooldownMs: 2592000000,
  requestTimeoutMs: 20000,
};

const WEB_STUB_NAME = './tests/fixtures/web-stub.js';
const PLUGIN_ENTRY_NAME = './src/dsh/index.js';

/** 官方 provider 的假实现（与 `@deepseek-ai/dsh-web-search-deepseek` 同形）。 */
function officialProvider(id = 'deepseek-official', { available = true } = {}) {
  const calls = [];
  const provider = {
    id,
    calls,
    available: () => available,
    search: async () => {
      calls.push(id);
      return {
        query: 'official',
        sources: [{ title: 'official', url: 'https://official.example/' }],
        truncated: false,
        provider: id,
      };
    },
  };
  provider.originalSearch = provider.search;
  return provider;
}

/**
 * 建一棵 loader 树：web stub 行 → 官方 provider（直接注册到 stub）→ 插件行。
 * @returns {{ ctx: Context, credentialStore: Map, official: object|null, web: object, originalSearch: Function }}
 */
async function bootTree(config, {
  official = officialProvider(),
  searchProvider = 'deepseek-official',
  patchable = true,
} = {}) {
  const ctx = new Context();
  ctx.baseUrl = rootBaseUrl;
  await ctx.plugin(Loader);
  const credentialStore = new Map();
  credentialStore.set('TAVILY_API_KEY_1', 'test-tavily-key');
  ctx.reflect.provide('credentials', {
    resolve: async (ref) => (credentialStore.has(String(ref)) ? { value: credentialStore.get(String(ref)) } : undefined),
  });
  await ctx.loader.create({ id: 'web', name: WEB_STUB_NAME, config: { searchProvider, fetchProvider: 'http' } });
  const web = ctx.loader.resolve('web').fiber.ctx.get('web');
  const originalSearch = web.search;
  if (patchable === false) {
    Object.defineProperty(web, 'search', {
      configurable: false,
      writable: false,
      value: originalSearch,
    });
  }
  if (official != null) web.registerSearchProvider(official);
  await ctx.loader.create({ id: 'web-search-pool', name: PLUGIN_ENTRY_NAME, config });
  await ctx.loader.await();
  return { ctx, credentialStore, official, web, originalSearch };
}

function searchPoolEntry(ctx) {
  const entry = ctx.loader.resolve('web-search-pool');
  assert.ok(entry?.fiber, 'web-search-pool row should have an active fiber');
  assert.equal(entry.fiber.state, 2, 'web-search-pool fiber should be ACTIVE');
  return entry;
}

function stubFetch(t, results = [{ title: 'T', url: 'https://example.com/1', content: 'C', score: 0.9 }]) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (target.endsWith('/usage')) {
      return new Response(JSON.stringify({ account: { current_plan: 'dev', plan_limit: 1000, plan_usage: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      query: 'dsl',
      answer: 'test answer',
      results,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

/** 只保留真正的搜索请求（过滤后台额度刷新 /usage）。 */
function searchCalls(calls) {
  return calls.filter((call) => call.url.endsWith('/search'));
}

test('host apply: 插件行加载、provider 注册进 web seam，且 web 行配置不变', async (t) => {
  const { ctx, web, official, originalSearch } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const entry = searchPoolEntry(ctx);
  assert.equal(entry.fiber.runtime.name, 'web-search-pool', 'plugin cordis name');
  assert.equal(entry.options.name, PLUGIN_ENTRY_NAME, 'loader row mounts the package entry');
  assert.ok(web.searchProviders.has('search-pool'), 'pool provider registered');
  assert.equal(web.searchProviders.get('search-pool').available(), true, 'pool with a tavily key is available');
  // 接管不改 web 行配置：官方设置页/用户 patch 仍显示原选择。
  assert.equal(ctx.loader.resolve('web').options.config.searchProvider, 'deepseek-official');
  assert.equal(ctx.loader.resolve('web').options.config.fetchProvider, 'http', 'fetchProvider preserved');
  // 服务级接管：web.search 被替换，官方 provider 对象保持原样。
  assert.notEqual(web.search, originalSearch, 'web.search must be intercepted at the service level');
  assert.equal(web.searchProviders.get('deepseek-official').search, official.search, 'official provider search untouched');
});

test('host apply: volatile 字段在 fiber config 里是 Ref（含 fallbackToOfficial）', async (t) => {
  const { ctx } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const config = searchPoolEntry(ctx).fiber.config;
  assert.equal(typeof config.enabled.get, 'function', 'enabled must be a volatile Ref');
  assert.equal(config.enabled.get(), true);
  assert.equal(typeof config.fallbackToOfficial.get, 'function', 'fallbackToOfficial must be a volatile Ref');
  assert.equal(config.fallbackToOfficial.get(), false);
  assert.equal(typeof config.providers.get, 'function', 'providers must be a volatile Ref');
  assert.equal(config.providers.get().tavily.keys.length, 1);
  assert.equal(typeof config.strategy.get, 'function');
  assert.equal(config.strategy.get(), 'weighted-round-robin');
});

test('host apply: 启用时无论 web.searchProvider 选谁，web.search 都走 key 池', async (t) => {
  const calls = stubFetch(t);
  const { ctx, web, official } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());

  const result = await web.search({ query: 'hello', maxResults: 5 });
  assert.equal(searchCalls(calls).length, 1, 'exactly one upstream request');
  assert.equal(searchCalls(calls)[0].url, 'https://api.tavily.com/search', 'request went to Tavily, not DeepSeek official');
  assert.equal(official.calls.length, 0, 'official provider must not be called');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://example.com/1');
  // 结果投影成官方 seam 同形结构：不含池内部字段。
  assert.equal(Object.hasOwn(result, 'provider'), false, 'provider field stripped');
  assert.equal(Object.hasOwn(result, 'query'), false, 'query field stripped');
});

test('host apply: 未知/未来官方 provider id 也照样接管', async (t) => {
  const calls = stubFetch(t);
  const lateOfficial = officialProvider('deepseek-search-v9');
  const { ctx, web } = await bootTree(BASE_CONFIG, {
    official: lateOfficial,
    searchProvider: 'deepseek-search-v9',
  });
  t.after(() => ctx.fiber.dispose());

  const result = await web.search({ query: 'hello', maxResults: 5 });
  assert.equal(searchCalls(calls)[0].url, 'https://api.tavily.com/search');
  assert.equal(lateOfficial.calls.length, 0);
  assert.equal(result.sources[0].url, 'https://example.com/1');
});

test('host apply: 关闭时 wrapper 委托回官方，官方 provider 原样可用', async (t) => {
  const calls = stubFetch(t);
  const { ctx, web, official, originalSearch } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const pool = web.searchProviders.get('search-pool');

  await ctx.loader.update('web-search-pool', { config: { ...BASE_CONFIG, enabled: false } });
  await ctx.loader.await();

  assert.equal(web.search !== originalSearch, true, 'wrapper remains installed while disabled');
  assert.equal(web.searchProviders.get('deepseek-official').search, official.search, 'official untouched');
  assert.equal(pool.available(), true, 'pool delegates availability to official when disabled');

  const result = await web.search({ query: 'hello' });
  assert.equal(searchCalls(calls).length, 0, 'Tavily must not be called while disabled');
  assert.equal(official.calls.length, 1, 'official provider called through the original seam');
  assert.equal(result.sources[0].url, 'https://official.example/', 'disabled path uses official provider');
});

test('host apply: 重新启用后继续走池（不重挂插件）', async (t) => {
  const calls = stubFetch(t);
  const { ctx, web } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const entry = searchPoolEntry(ctx);
  const uidBefore = entry.fiber.uid;

  await ctx.loader.update('web-search-pool', { config: { ...BASE_CONFIG, enabled: false } });
  await ctx.loader.await();
  await ctx.loader.update('web-search-pool', { config: { ...BASE_CONFIG, enabled: true } });
  await ctx.loader.await();

  assert.equal(entry.fiber.uid, uidBefore, 'volatile-only change must not remount the plugin');
  await web.search({ query: 'hello' });
  assert.equal(searchCalls(calls)[0].url, 'https://api.tavily.com/search', 'pool used again');
});

test('host apply: 官方 provider 晚注册不影响服务级接管', async (t) => {
  const calls = stubFetch(t);
  const { ctx, web, originalSearch } = await bootTree(BASE_CONFIG, { official: null });
  t.after(() => ctx.fiber.dispose());
  const late = officialProvider('deepseek-search-api');
  web.registerSearchProvider(late);
  ctx.emit('internal/service', 'web', web);

  assert.notEqual(web.search, originalSearch, 'service patch stays installed');
  const result = await web.search({ query: 'hello' });
  assert.equal(searchCalls(calls)[0].url, 'https://api.tavily.com/search');
  assert.equal(late.calls.length, 0);
  assert.equal(result.sources[0].url, 'https://example.com/1');
});

test('host apply: dispose 完整恢复 web.search', async (t) => {
  const { ctx, web, originalSearch } = await bootTree(BASE_CONFIG);
  assert.notEqual(web.search, originalSearch);
  ctx.loader.remove('web-search-pool');
  await ctx.loader.await();
  assert.equal(web.search, originalSearch, 'web.search restored on dispose');
  assert.equal(web.searchProviders.has('search-pool'), false, 'pool provider unregistered on dispose');
  ctx.fiber.dispose();
});

test('host apply: 池不可用且默认不回退时抛中性错误，官方不被调用', async (t) => {
  const { ctx, web, official } = await bootTree({
    ...BASE_CONFIG,
    providers: { tavily: { keys: [] }, exa: { keys: [] } },
  });
  t.after(() => ctx.fiber.dispose());

  await assert.rejects(
    () => web.search({ query: 'x' }),
    (error) => {
      assert.equal(error?.code, 'WEB_PROVIDER_UNAVAILABLE');
      assert.doesNotMatch(String(error?.message), /tavily|exa|key|deepseek|official/i);
      return true;
    },
  );
  assert.equal(official.calls.length, 0, 'official must not be called when fallback is off');
});

test('host apply: fallbackToOfficial=true 时池不可用回退官方', async (t) => {
  const { ctx, web, official } = await bootTree({
    ...BASE_CONFIG,
    fallbackToOfficial: true,
    providers: { tavily: { keys: [] }, exa: { keys: [] } },
  });
  t.after(() => ctx.fiber.dispose());

  const result = await web.search({ query: 'x' });
  assert.equal(official.calls.length, 1, 'official fallback called');
  assert.equal(result.sources[0].url, 'https://official.example/');
});

test('host apply: 池失败时默认中性错误（不泄露 Tavily/ key）', async (t) => {
  const { ctx, web } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const pool = web.searchProviders.get('search-pool');
  const originalPoolSearch = pool.search;
  pool.search = async () => {
    throw new Error('Tavily exploded: key TAVILY_API_KEY_1 invalid');
  };
  t.after(() => { pool.search = originalPoolSearch; });

  await assert.rejects(
    () => web.search({ query: 'x' }),
    (error) => {
      assert.equal(error?.code, 'WEB_PROVIDER_UNAVAILABLE');
      assert.doesNotMatch(String(error?.message), /tavily|key|search-pool/i);
      assert.match(String(error?.cause?.message), /Tavily exploded/, 'cause keeps diagnostics for logs');
      return true;
    },
  );
});

test('host apply: 按 maxResults 截断并标记 truncated', async (t) => {
  stubFetch(t, [
    { title: 'A', url: 'https://example.com/a', content: 'A' },
    { title: 'B', url: 'https://example.com/b', content: 'B' },
    { title: 'C', url: 'https://example.com/c', content: 'C' },
  ]);
  const { ctx, web } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());

  const result = await web.search({ query: 'hello', maxResults: 1 });
  assert.equal(result.sources.length, 1, 'capped to maxResults');
  assert.equal(result.truncated, true, 'truncated flag set');
});

test('host apply: web.search 不可 patch 时降级为 provider 级接管', async (t) => {
  const calls = stubFetch(t);
  const { ctx, web, official } = await bootTree(BASE_CONFIG, { patchable: false });
  t.after(() => ctx.fiber.dispose());

  assert.notEqual(web.searchProviders.get('deepseek-official').search, official.originalSearch, 'official provider patched');
  const result = await web.search({ query: 'hello' });
  assert.equal(searchCalls(calls)[0].url, 'https://api.tavily.com/search');
  assert.equal(result.sources[0].url, 'https://example.com/1');
});

test('host apply: resolveOptions 生成 entries（纯值快照投影）', () => {
  const fakeCtx = { get: () => undefined, logger: { info() {} } };
  const options = plugin.resolveOptions(fakeCtx, {
    enabled: true,
    fallbackToOfficial: true,
    providers: {
      tavily: { keys: [{ apiKeyEnv: 'TAVILY_API_KEY_1', rpm: 30 }] },
      exa: { keys: [] },
    },
  });
  assert.equal(options.available, true);
  assert.equal(options.fallbackToOfficial, true);
  assert.equal(options.entries.length, 1);
  assert.equal(options.entries[0].provider, 'tavily');
  assert.equal(options.entries[0].credentialRef, 'TAVILY_API_KEY_1');
  assert.equal(options.entries[0].rpm, 30);
  assert.equal(options.strategy, 'weighted-round-robin');
  assert.equal(options.allowedFails, 3);
  assert.equal(options.requestTimeoutMs, 20000);
});

test('host apply: resolveKey 优先凭据服务、回退启动环境', async () => {
  const fakeCtx = {
    get: (name) => (name === 'credentials'
      ? { resolve: async (ref) => (String(ref) === 'TAVILY_API_KEY_1' ? { value: 'from-credentials' } : undefined) }
      : undefined),
    logger: { info() {} },
  };
  const options = plugin.resolveOptions(fakeCtx, {
    providers: { tavily: { keys: [{ apiKeyEnv: 'TAVILY_API_KEY_1', rpm: 30 }] }, exa: { keys: [] } },
  });
  assert.equal(await options.resolveKey(options.entries[0]), 'from-credentials');
});

test('host apply: 匿名 Exa key（apiKeyEnv 留空）生成 anonymous entry', () => {
  const fakeCtx = { get: () => undefined, logger: { info() {} } };
  const options = plugin.resolveOptions(fakeCtx, {
    providers: { tavily: { keys: [] }, exa: { keys: [{ apiKeyEnv: '', rpm: 60 }] } },
  });
  assert.equal(options.entries.length, 1);
  assert.equal(options.entries[0].provider, 'exa');
  assert.equal(options.entries[0].anonymous, true);
  assert.equal(options.available, true);
});

test('host apply: 关闭且没有官方委托时 available() 为 false', async (t) => {
  const { ctx, web } = await bootTree({ ...BASE_CONFIG, enabled: false }, { official: null });
  t.after(() => ctx.fiber.dispose());
  assert.equal(web.searchProviders.get('search-pool').available(), false);
  await assert.rejects(
    () => web.search({ query: 'x' }),
    (error) => error?.code === 'WEB_PROVIDER_CONFIGURED_MISSING',
  );
});