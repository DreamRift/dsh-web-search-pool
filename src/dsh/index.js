/**
 * DSH composition 插件入口：注册搜索池 provider 到 `ctx.web`。
 * `inject: ['web']`，不发布任何服务（provider 只消费 web 服务），可 loose 挂在 preset 或 host patch 里。
 *
 * 0.1.7 适配（2026-09-25，依据桌面版 0.1.7-rc.2 源码）：
 * - **settings section 注册接口已移除**：`installSection` / `installSettingsSection`
 *   都不存在了。0.1.7 的设置表单由 loader 行的 Config schema 自动投影（namespace = 行 id），
 *   本入口不再注册任何 section，schema（`./config.js` 的 `Config`）就是设置面。
 * - **config 运行形态变化**：volatile 字段在 `apply(ctx, config)` 里是 **Ref**
 *   （`config.enabled.get()`），编辑经 `settings.mutate` 写入 profile patch 后就地提交，
 *   不重挂插件；变化通知事件是 `loader/volatile-update`（旧的 `settings/updated` 已移除）。
 * - **web 行 id 变化**：0.1.1/0.1.2 官方 bundle 把 `web` 行插在 include 组内（`include:web`），
 *   0.1.7 的 dsh-base 直接把 `web` 行插在根组（`web`）。本入口运行时探测两者，先新后旧。
 * - 运行时额度快照不再写 settings（0.1.7 的 settings 写入会持久化进 profile patch），
 *   Host 只做进程内刷新，观测走 `ctx.logger`。
 *
 * 历史兼容说明：0.3.0 起仅支持 DSH 0.1.7+（peer 范围 `^0.1.7-rc.1`）；
 * 0.1.1-rc.x / 0.1.2 的 settingsScope / installSection 路径已随版本线移除。
 * @module dsh-web-search-pool
 */

import { Config, resolveOptions } from './config.js';
import { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID } from './provider.js';

export { Config, resolveOptions };
export { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID };

/** Cordis 插件名，用于 loader 诊断。 */
export const name = 'web-search-pool';

/** 消费的 host 服务：web seam。 */
export const inject = ['web'];

/**
 * settings namespace：`web-search-pool`。
 * 0.1.7 起 namespace = loader 行 id（设置表单的 key），与 bundle patch 里 insert 的行 id 一致。
 */
export const SETTINGS_NAMESPACE = 'web-search-pool';

/**
 * `web` 行的 loader id：0.1.7 的 dsh-base 插在根组（`web`）；
 * 旧版（0.1.1/0.1.2）在 include 子树里（`include:web`）。
 * 运行时按当前宿主实际存在的行解析（见 {@link resolveWebRowId}）。
 */
export const WEB_ROW_IDS = ['web', 'include:web'];

/**
 * `web` 行的完整 config 兜底值。
 * id 定位的 patch 是**整体替换**而不是深合并，所以必须 restate 全部字段；
 * 官方 web 行带 `fetchProvider: http`，只写 searchProvider 会把它抹掉。
 */
export const WEB_ROW_CONFIG = Object.freeze({
  searchProvider: SEARCH_POOL_PROVIDER_ID,
  fetchProvider: 'http',
});

/** 读取 volatile 字段的当前值（Ref 取 `.get()`，普通值原样返回）。 */
function refValue(field) {
  return field != null && typeof field.get === 'function' ? field.get() : field;
}

/** 把 fiber config（volatile 为 Ref）投影成 resolveOptions 需要的纯值快照。 */
function snapshotConfig(config) {
  const providers = refValue(config?.providers) ?? {};
  return {
    enabled: refValue(config?.enabled) ?? true,
    providers,
    strategy: refValue(config?.strategy),
    providerPriority: refValue(config?.providerPriority),
    allowedFails: refValue(config?.allowedFails),
    cooldownMs: refValue(config?.cooldownMs),
    retryAfterFallbackMs: refValue(config?.retryAfterFallbackMs),
    usageCacheMs: refValue(config?.usageCacheMs),
    quotaReserveCredits: refValue(config?.quotaReserveCredits),
    quotaExhaustedCooldownMs: refValue(config?.quotaExhaustedCooldownMs),
    requestTimeoutMs: refValue(config?.requestTimeoutMs),
  };
}

/** 当前宿主实际存在的 `web` 行 id（探测 loader 树，新 id 优先）。 */
export function resolveWebRowId(ctx) {
  const loader = ctx.get?.('loader');
  if (loader == null || typeof loader.resolve !== 'function') return undefined;
  for (const id of WEB_ROW_IDS) {
    try {
      loader.resolve(id);
      return id;
    } catch {
      // 该 id 不在树里，试下一个。
    }
  }
  return undefined;
}

/** 读取 `web` 行当前的 config（读不到时返回 null），用于回写时保留其它字段。 */
function readWebRowConfig(ctx, rowId) {
  const loader = ctx.get?.('loader');
  if (loader == null || typeof loader.resolve !== 'function' || rowId == null) return null;
  try {
    const config = loader.resolve(rowId)?.options?.config;
    return config !== null && typeof config === 'object' ? { ...config } : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} ctx 插件上下文。
 * @returns {() => void} dispose：插件停止时释放 provider 状态。
 */
export function apply(ctx, config) {
  const provider = new SearchPoolProvider(() => resolveOptions(ctx, snapshotConfig(config)), {
    // 0.1.7：额度快照不再走 settings（会落盘进 profile patch），改为日志观测。
    logUsage: (snapshot, diagnostic) => {
      const summary = snapshot == null
        ? 'no usage snapshot'
        : `used=${String(snapshot.totalUsed)} limit=${String(snapshot.totalLimit)} keys=${String(snapshot.keys?.length ?? 0)}`;
      ctx.logger?.info?.(`search-pool usage ${summary}${diagnostic != null && diagnostic.length > 0 ? `; ${diagnostic}` : ''}`);
    },
  });

  // settings 服务已与 provider 无关：Config schema 即设置面，无需 installSection。
  ctx.web.registerSearchProvider(provider);

  /**
   * 根据 enabled 开关同步 `web` 行的 `searchProvider`：开启用 search-pool，关闭用 deepseek-official。
   * 只在 enabled 变化时同步，避免运行时重复触发 loader 更新。
   * loader 的 config 更新是整体替换，所以先读该行现有 config 再合并，避免抹掉官方字段。
   */
  let lastSyncedEnabled = null;
  function syncSearchProvider(enabled) {
    if (lastSyncedEnabled === enabled) return;
    lastSyncedEnabled = enabled;
    const loader = ctx.get?.('loader');
    if (loader == null || typeof loader.update !== 'function') return;
    const rowId = resolveWebRowId(ctx);
    if (rowId == null) {
      ctx.logger?.warn?.('search-pool: web loader row not found; searchProvider sync skipped');
      return;
    }
    const providerId = enabled ? SEARCH_POOL_PROVIDER_ID : 'deepseek-official';
    const nextConfig = { ...(readWebRowConfig(ctx, rowId) ?? WEB_ROW_CONFIG), searchProvider: providerId };
    Promise.resolve(loader.update(rowId, { config: nextConfig })).catch((error) => {
      ctx.logger?.warn?.('search-pool: failed to sync web.searchProvider to "' + providerId + '": ' + String(error?.message ?? error));
    });
  }

  const enabledNow = refValue(config?.enabled) ?? true;
  syncSearchProvider(enabledNow);

  /**
   * volatile 配置变化（设置卡片保存 / patch 编辑）：同步 web 行选择，
   * 并尽快刷新 Tavily 额度缓存（增删 key 后立刻反映额度门禁）。
   * 注意：loader 的 volatile 提交不会重挂插件，Ref 值与这里的事件是权威来源。
   */
  const onVolatileUpdate = () => {
    const next = snapshotConfig(config);
    syncSearchProvider(next.enabled);
    provider.refreshUsage(resolveOptions(ctx, next)).catch((error) => {
      ctx.logger?.warn?.('search-pool: usage refresh after config change failed: ' + String(error?.message ?? error));
    });
  };
  ctx.on('loader/volatile-update', onVolatileUpdate);

  // 启动后后台刷新一次 Tavily 额度（单飞；无 Tavily key 时仅记录"没有可查询的 key"）。
  provider.refreshUsage(resolveOptions(ctx, snapshotConfig(config))).catch((error) => {
    ctx.logger?.warn?.('search-pool: initial Tavily usage refresh failed: ' + String(error?.message ?? error));
  });

  return function dispose() {
    ctx.off?.('loader/volatile-update', onVolatileUpdate);
    provider.dispose();
  };
}
