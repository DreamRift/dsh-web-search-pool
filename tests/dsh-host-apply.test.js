/**
 * Host half 集成测试：用真实的 `@deepseek-ai/cordis` + vendored Loader +
 * schemastery（0.1.7-rc.2）驱动 `src/dsh/index.js`，守住 0.1.7 适配的关键契约：
 *
 * 1. loader 行能加载、apply 能跑、provider 注册进 web seam（旧版 crash 的第一现场）；
 * 2. Config 的 volatile 字段在 fiber config 里是 Ref（`config.enabled.get()`）；
 * 3. 配置变化走 volatile 就地提交（不重挂插件）并触发 web 行选择同步；
 * 4. `resolveOptions` 从 keys 生成 entries、凭据解析、搜索链路（假 fetch）。
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

/** 捕获 registerSearchProvider 的 web seam stub（行内 loader 行，与线上同构）。 */
const WEB_STUB_NAME = './tests/fixtures/web-stub.js';
const PLUGIN_ENTRY_NAME = './src/dsh/index.js';

async function bootTree(config) {
  const ctx = new Context();
  ctx.baseUrl = rootBaseUrl;
  await ctx.plugin(Loader);
  // 凭据服务由 root 提供（所有 entry 可见）；resolver 可被测试改写。
  const credentialStore = new Map();
  ctx.reflect.provide('credentials', {
    resolve: async (ref) => (credentialStore.has(String(ref)) ? { value: credentialStore.get(String(ref)) } : undefined),
  });
  await ctx.loader.create({ id: 'web', name: WEB_STUB_NAME, config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } });
  await ctx.loader.create({ id: 'web-search-pool', name: PLUGIN_ENTRY_NAME, config });
  await ctx.loader.await();
  return { ctx, credentialStore };
}

function searchPoolEntry(ctx) {
  const entry = ctx.loader.resolve('web-search-pool');
  assert.ok(entry?.fiber, 'web-search-pool row should have an active fiber');
  assert.equal(entry.fiber.state, 2, 'web-search-pool fiber should be ACTIVE');
  return entry;
}

test('host apply: 插件行加载、provider 注册进 web seam', async (t) => {
  const { ctx } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const entry = searchPoolEntry(ctx);
  assert.equal(entry.fiber.runtime.name, 'web-search-pool', 'plugin cordis name');
  assert.equal(entry.options.name, PLUGIN_ENTRY_NAME, 'loader row mounts the package entry');

  const web = ctx.loader.resolve('web');
  assert.equal(web.fiber.state, 2, 'web stub row should be active');
  const registered = web.fiber.ctx.get('web').registered;
  assert.equal(registered.length, 1, 'exactly one search provider registered');
  assert.equal(registered[0].id, 'search-pool');
  assert.equal(registered[0].available(), true, 'pool with a tavily key is available');

  // bundle patch 同款同步：web 行选择应被切到 search-pool。
  assert.equal(web.options.config.searchProvider, 'search-pool');
  assert.equal(web.options.config.fetchProvider, 'http', 'fetchProvider must be preserved');
});

test('host apply: volatile 字段在 fiber config 里是 Ref（0.1.7 配置形态）', async (t) => {
  const { ctx } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const config = searchPoolEntry(ctx).fiber.config;
  assert.equal(typeof config.enabled.get, 'function', 'enabled must be a volatile Ref');
  assert.equal(config.enabled.get(), true);
  assert.equal(typeof config.providers.get, 'function', 'providers must be a volatile Ref');
  assert.equal(config.providers.get().tavily.keys.length, 1);
  assert.equal(typeof config.strategy.get, 'function');
  assert.equal(config.strategy.get(), 'weighted-round-robin');
});

test('host apply: 配置变化就地提交（不重挂）并同步 web 行选择', async (t) => {
  const { ctx } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const entry = searchPoolEntry(ctx);
  const fiberBefore = entry.fiber;
  const uidBefore = fiberBefore.uid;

  await ctx.loader.update('web-search-pool', { config: { ...BASE_CONFIG, enabled: false } });
  await ctx.loader.await();

  assert.equal(entry.fiber, fiberBefore, 'volatile-only change must not remount the plugin');
  assert.equal(entry.fiber.uid, uidBefore, 'fiber identity preserved');
  assert.equal(entry.fiber.config.enabled.get(), false);

  const web = ctx.loader.resolve('web');
  assert.equal(web.options.config.searchProvider, 'deepseek-official', 'disabled switches back to official');
  assert.equal(web.options.config.fetchProvider, 'http');
});

test('host apply: resolveOptions 生成 entries（纯值快照投影）', () => {
  const fakeCtx = { get: () => undefined, logger: { info() {} } };
  const options = plugin.resolveOptions(fakeCtx, {
    enabled: true,
    providers: {
      tavily: { keys: [{ apiKeyEnv: 'TAVILY_API_KEY_1', rpm: 30 }] },
      exa: { keys: [] },
    },
  });
  assert.equal(options.available, true);
  assert.equal(options.entries.length, 1);
  assert.equal(options.entries[0].provider, 'tavily');
  assert.equal(options.entries[0].credentialRef, 'TAVILY_API_KEY_1');
  assert.equal(options.entries[0].rpm, 30);
  // 默认值兜底（未提供的字段走 schema 默认）。
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

test('host apply: 搜索链路走 key 池（假 fetch + 假凭据）', async (t) => {
  const { ctx, credentialStore } = await bootTree(BASE_CONFIG);
  t.after(() => ctx.fiber.dispose());
  const entry = searchPoolEntry(ctx);

  // credentials stub：TAVILY_API_KEY_1 → 测试 key。
  credentialStore.set('TAVILY_API_KEY_1', 'tvly-test-key');

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      query: 'dsl',
      answer: 'test answer',
      results: [{ title: 'T', url: 'https://example.com/1', content: 'C', score: 0.9 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const web = ctx.loader.resolve('web');
  const provider = web.fiber.ctx.get('web').registered[0];
  const result = await provider.search({ query: 'hello', maxResults: 5 });
  assert.equal(calls.length, 1, 'exactly one upstream request');
  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://example.com/1');
});

test('host apply: 关闭时 provider.available() 为 false', async (t) => {
  const { ctx } = await bootTree({ ...BASE_CONFIG, enabled: false });
  t.after(() => ctx.fiber.dispose());
  const web = ctx.loader.resolve('web');
  const provider = web.fiber.ctx.get('web').registered[0];
  assert.equal(provider.available(), false);
  assert.equal(web.options.config.searchProvider, 'deepseek-official');
});

