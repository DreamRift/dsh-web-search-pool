/**
 * DSH composition 插件入口：注册搜索池 provider 到 `ctx.web`。
 * `inject: ['web']`，不发布任何服务（provider 只消费 web 服务），可 loose 挂在 preset 或 host patch 里。
 * @module dsh-web-search-pool
 */

import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { Config, resolveOptions } from './config.js';
import { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID } from './provider.js';

export { Config, resolveOptions } from './config.js';
export { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID };

/** Cordis 插件名，用于 loader 诊断。 */
export const name = 'web-search-pool';

/** 消费的 host 服务：web seam。 */
export const inject = ['web'];

/** settings namespace：`web-search-pool`。 */
export const SETTINGS_NAMESPACE = settingsNamespace('web-search-pool');

/** 最近一次同步到 `include:web` 的 enabled 值，避免运行时 usage 写入重复触发 loader。 */
let lastSyncedEnabled = null;

/**
 * @param {object} ctx 插件上下文。
 * @param {object} config composition 配置（作为 settings section 的 base 层）。
 */
export function apply(ctx, config) {
  let current = () => config;
  let lastRefreshTick = null;
  let settingsService = null;
  let pendingUsage = null;
  lastSyncedEnabled = null;

  async function writeUsage(snapshot, diagnostic = '') {
    if (settingsService == null) return false;
    try {
      await settingsService.update(SETTINGS_NAMESPACE, { usage: snapshot, usageDiagnostic: diagnostic });
      return true;
    } catch (error) {
      const message = String(error?.message ?? error);
      ctx.logger?.warn?.(`search-pool: publish usage failed: ${message}`);
      try {
        await settingsService.update(SETTINGS_NAMESPACE, { usageDiagnostic: '额度发布失败: ' + message });
      } catch {
        // 诊断写入也失败时仅保留日志。
      }
      return false;
    }
  }

  const provider = new SearchPoolProvider(() => resolveOptions(ctx, current()), {
    publishUsage: async (snapshot, diagnostic) => {
      pendingUsage = { snapshot, diagnostic };
      if (settingsService == null) return false;
      return writeUsage(snapshot, diagnostic);
    },
  });

  // settings 服务经 inject 获取；若首次刷新时尚未就绪，pendingUsage 会在服务出现后补发。
  ctx.inject(['settings'], (sctx) => {
    settingsService = sctx.settings;
    if (pendingUsage != null) {
      const { snapshot, diagnostic } = pendingUsage;
      writeUsage(snapshot, diagnostic).catch((error) => {
        ctx.logger?.warn?.(`search-pool: deferred usage publish failed: ${String(error?.message ?? error)}`);
      });
    }
  });

  function handleSettingsChange(next) {
    syncSearchProvider(ctx, next?.enabled ?? true);
    const tick = next?.usageRefreshTick ?? 0;
    const options = resolveOptions(ctx, next);
    if (lastRefreshTick == null) {
      lastRefreshTick = tick;
      // 首次注册完成：settings namespace 已可用，立即刷新一次额度。
      provider.refreshUsage(options).catch((error) => {
        ctx.logger?.warn?.(`search-pool: initial Tavily usage refresh failed: ${String(error?.message ?? error)}`);
      });
      return;
    }
    if (tick !== lastRefreshTick) {
      lastRefreshTick = tick;
      provider.refreshUsage(options).catch((error) => {
        ctx.logger?.warn?.(`search-pool: manual usage refresh failed: ${String(error?.message ?? error)}`);
      });
    }
  }

  installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {
      handleSettingsChange(current());
    },
  });

  // installSettingsSection 的 scope.watch 在某些 include/loader 场景下可能因
  // 插件上下文状态而跳过回调；settings/updated 是更底层的广播，用它兜底，
  // 确保 Client 点击“立即刷新”递增 usageRefreshTick 后 Host 一定会刷新额度。
  ctx.on('settings/updated', (ns, next) => {
    if (ns !== SETTINGS_NAMESPACE) return;
    handleSettingsChange(next);
  });
  ctx.web.registerSearchProvider(provider);
  syncSearchProvider(ctx, config?.enabled ?? true);
}

/**
 * 根据开关同步 `web` 的 `searchProvider`：开启用 search-pool，关闭用 deepseek-official。
 * `web` row 在 include 子树里，完整 id 为 `include:web`；通过 loader 更新其 config。
 * 只在 enabled 值变化时同步，避免运行时 usage 写入 settings 时重复触发 loader。
 */
function syncSearchProvider(ctx, enabled) {
  if (lastSyncedEnabled === enabled) return;
  lastSyncedEnabled = enabled;
  const loader = ctx.get('loader');
  if (loader === undefined || typeof loader.update !== 'function') return;
  const providerId = enabled ? SEARCH_POOL_PROVIDER_ID : 'deepseek-official';
  Promise.resolve(loader.update('include:web', { config: { searchProvider: providerId } })).catch((error) => {
    ctx.logger?.warn?.(`search-pool: failed to sync web.searchProvider to "${providerId}": ${String(error?.message ?? error)}`);
  });
}
