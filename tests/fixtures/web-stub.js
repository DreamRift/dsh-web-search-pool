/**
 * 测试夹具：`web` seam 的最小 loader 行（与线上 `@deepseek-ai/dsh-web` 的
 * `WebRuntime` 同构：`searchProviders` Map、重复 id 抛错、按 config 选 provider、
 * `registerSearchProvider` 返回 disposer）。
 *
 * 只给 host apply / takeover 测试用，不进发布包（package.json 的 files 不含 tests/）。
 */
import z from '@deepseek-ai/schemastery';

export const name = 'web-stub';

export const Config = z.object({
  searchProvider: z.string(),
  fetchProvider: z.string(),
});

/** 与宿主 `WEB_DUPLICATE_PROVIDER` 同形的错误。 */
function duplicateProviderError(id) {
  return Object.assign(new Error('duplicate search provider "' + id + '"'), { code: 'WEB_DUPLICATE_PROVIDER' });
}

export function apply(ctx, config) {
  /** 与线上 `WebRuntime.searchProviders` 相同的注册表。 */
  const searchProviders = new Map();
  const calls = [];
  const web = {
    config,
    searchProviders,
    calls,
    registerSearchProvider(provider) {
      if (provider == null || typeof provider.id !== 'string') {
        throw Object.assign(new Error('invalid search provider'), { code: 'WEB_PROVIDER_INVALID' });
      }
      if (searchProviders.has(provider.id)) throw duplicateProviderError(provider.id);
      searchProviders.set(provider.id, provider);
      return () => {
        if (searchProviders.get(provider.id) === provider) searchProviders.delete(provider.id);
      };
    },
    /** 与线上 `WebRuntime.search` 相同的 provider 选择语义。 */
    async search(request, signal) {
      const id = config.searchProvider;
      const provider = searchProviders.get(id);
      calls.push(id);
      if (provider == null) {
        throw Object.assign(new Error('provider "' + id + '" is not registered'), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' });
      }
      if (provider.available() !== true) {
        throw Object.assign(new Error('provider "' + id + '" is unavailable'), { code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' });
      }
      return provider.search(request, signal);
    },
  };
  ctx.reflect.provide('web', web);
}
