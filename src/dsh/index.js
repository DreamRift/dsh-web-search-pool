/**
 * DSH composition 插件入口：注册搜索池 provider 到 `ctx.web`。
 * `inject: ['web']`，不发布任何服务（provider 只消费 web 服务），可 loose 挂在 preset 或 host patch 里。
 *
 * 跨版本（0.1.1-rc.x / 0.1.2+）：
 * DSH 0.1.2 起 `@deepseek-ai/dsh-settings` 移除了 `installSettingsSection`、
 * `settingsNamespace`、`deepEqualJson` 导出，改为 `settings.installSection(owner, ns, schema, entry, hooks)`。
 * 因此本模块**不得静态导入**这两个旧符号：ESM 的静态命名导入在 0.1.2 上会在链接期直接抛
 * SyntaxError（does not provide an export named 'installSettingsSection'），使 loader 无法导入本插件，
 * 进而整棵插件树启动失败（fail-loud）。这里改为运行时能力探测（新 API 优先）+ 动态导入回退（旧 API），两代都能启动。
 * @module dsh-web-search-pool
 */

import { Config, resolveOptions } from './config.js';
import { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID } from './provider.js';

export { Config, resolveOptions } from './config.js';
export { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID };

/** Cordis 插件名，用于 loader 诊断。 */
export const name = 'web-search-pool';

/** 消费的 host 服务：web seam。 */
export const inject = ['web'];

/**
 * settings namespace：`web-search-pool`。
 * 0.1.2 起 namespace 就是普通小写连字符字符串（旧的 `settingsNamespace()` 只是类型品牌，
 * 运行时不改写值），所以直接用字符串常量，两代通用。
 */
export const SETTINGS_NAMESPACE = 'web-search-pool';

/** `web` 行在 include 子树里的完整 loader id（官方 bundle 把 web 行插在 include 组内）。 */
export const WEB_ROW_ID = 'include:web';

/**
 * `web` 行的完整 config 兜底值。
 * id 定位的 patch 是**整体替换**而不是深合并，所以必须 restate 全部字段；
 * 0.1.2 的官方 web 行新增了 `fetchProvider: http`，只写 searchProvider 会把它抹掉。
 * `fetchProvider` 在 0.1.1-rc.x 的 web seam 里同样存在（schema 相同），因此两代都安全。
 */
export const WEB_ROW_CONFIG = Object.freeze({
  searchProvider: SEARCH_POOL_PROVIDER_ID,
  fetchProvider: 'http',
});

/**
 * 注册 settings section（跨 DSH 版本）。
 * 0.1.2+：`settings.installSection(owner, ns, schema, entry, hooks)`（SettingsProvider 方法）。
 * 0.1.1-rc.x：只有顶层 helper `installSettingsSection(ctx, ns, schema, entry, hooks)`，
 * 且只能动态导入（静态导入在 0.1.2 会炸）。
 * @param {object} ctx 插件上下文（同时作为 section 的 owner）。
 * @param {object} settings settings 服务（SettingsProvider）。
 * @param {object} entry composition 配置，作为 section 的 base 层。
 * @param {{setSource: (source: () => object) => void, onChange: () => void}} hooks 旧 helper 的 hooks 形状。
 * @returns {boolean} 是否走了同步的新 API 路径。
 */
export function installSettingsSectionCompat(ctx, settings, entry, hooks) {
  if (settings != null && typeof settings.installSection === 'function') {
    settings.installSection(ctx, SETTINGS_NAMESPACE, Config, entry, hooks);
    return true;
  }
  import('@deepseek-ai/dsh-settings')
    .then((mod) => {
      if (typeof mod.installSettingsSection !== 'function') {
        ctx.logger?.warn?.(
          'search-pool: settings seam exposes neither installSection nor installSettingsSection; settings UI unavailable',
        );
        return;
      }
      mod.installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, entry, hooks);
    })
    .catch((error) => {
      ctx.logger?.warn?.('search-pool: legacy settings section install failed: ' + String(error?.message ?? error));
    });
  return false;
}

/**
 * 读取 `include:web` 行当前的 config（读不到时返回 null）。
 * 用于把 searchProvider 写回去时保留 fetchProvider 等其它字段。
 * @param {object} ctx 插件上下文。
 * @returns {object|null} 该行的 config 浅拷贝，或 null。
 */
function readWebRowConfig(ctx) {
  const loader = ctx.get?.('loader');
  if (loader == null || typeof loader.resolve !== 'function') return null;
  try {
    const config = loader.resolve(WEB_ROW_ID)?.options?.config;
    return config !== null && typeof config === 'object' ? { ...config } : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} ctx 插件上下文。
 * @param {object} config composition 配置（作为 settings section 的 base 层）。
 * @returns {() => void} dispose：插件停止时注销事件监听并释放 provider 状态。
 */
export function apply(ctx, config) {
  let current = () => config;
  let lastRefreshTick = null;
  let settingsService = null;
  let pendingUsage = null;
  // 最近一次同步到 `include:web` 的 enabled 值（apply 闭包内，避免模块级状态跨实例串扰）。
  let lastSyncedEnabled = null;

  async function writeUsage(snapshot, diagnostic = '') {
    if (settingsService == null) return false;
    try {
      await settingsService.update(SETTINGS_NAMESPACE, { usage: snapshot, usageDiagnostic: diagnostic });
      return true;
    } catch (error) {
      const message = String(error?.message ?? error);
      ctx.logger?.warn?.('search-pool: publish usage failed: ' + message);
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
    // section 注册与 settings 服务同源：新 API 同步注册，旧 API 动态导入后注册。
    installSettingsSectionCompat(ctx, sctx.settings, config, {
      setSource: (source) => {
        current = source;
      },
      onChange: () => {
        handleSettingsChange(current());
      },
    });
    if (pendingUsage != null) {
      const { snapshot, diagnostic } = pendingUsage;
      pendingUsage = null;
      writeUsage(snapshot, diagnostic).catch((error) => {
        ctx.logger?.warn?.('search-pool: deferred usage publish failed: ' + String(error?.message ?? error));
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
        ctx.logger?.warn?.('search-pool: initial Tavily usage refresh failed: ' + String(error?.message ?? error));
      });
      return;
    }
    if (tick !== lastRefreshTick) {
      lastRefreshTick = tick;
      provider.refreshUsage(options).catch((error) => {
        ctx.logger?.warn?.('search-pool: manual usage refresh failed: ' + String(error?.message ?? error));
      });
    }
  }

  // section 的 scope.watch 在某些 include/loader 场景下可能因插件上下文状态而跳过回调；
  // settings/updated 是更底层的广播，用它兜底，确保 Client 点击“立即刷新”递增
  // usageRefreshTick 后 Host 一定会刷新额度。
  const onSettingsUpdated = (ns, next) => {
    if (ns !== SETTINGS_NAMESPACE) return;
    handleSettingsChange(next);
  };
  ctx.on('settings/updated', onSettingsUpdated);
  ctx.web.registerSearchProvider(provider);
  syncSearchProvider(ctx, config?.enabled ?? true);

  /**
   * 根据开关同步 `web` 的 `searchProvider`：开启用 search-pool，关闭用 deepseek-official。
   * `web` row 在 include 子树里，完整 id 为 `include:web`；通过 loader 更新其 config。
   * 只在 enabled 值变化时同步，避免运行时 usage 写入 settings 时重复触发 loader。
   * 注意：loader 的 config 更新是整体替换，所以先把该行现有 config 读出来合并，
   * 否则会把官方新增的 `fetchProvider` 抹掉（0.1.2 起官方 web 行带 fetchProvider: http）。
   */
  function syncSearchProvider(ctx2, enabled) {
    if (lastSyncedEnabled === enabled) return;
    lastSyncedEnabled = enabled;
    const loader = ctx2.get('loader');
    if (loader === undefined || typeof loader.update !== 'function') return;
    const providerId = enabled ? SEARCH_POOL_PROVIDER_ID : 'deepseek-official';
    const nextConfig = { ...(readWebRowConfig(ctx2) ?? WEB_ROW_CONFIG), searchProvider: providerId };
    Promise.resolve(loader.update(WEB_ROW_ID, { config: nextConfig })).catch((error) => {
      ctx2.logger?.warn?.('search-pool: failed to sync web.searchProvider to "' + providerId + '": ' + String(error?.message ?? error));
    });
  }

  return function dispose() {
    ctx.off?.('settings/updated', onSettingsUpdated);
    provider.dispose();
  };
}
