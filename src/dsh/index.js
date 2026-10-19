/**
 * DSH composition 插件入口：注册搜索池 provider，并在启用时接管 DeepSeek 官方搜索。
 * `inject: ['web']`，不发布任何服务（provider 只消费 web 服务），可 loose 挂在 preset 或 host patch 里。
 *
 * 0.5.0 接管机制（2026-10-19，宿主 0.2.1-rc.2 源码核对 + 本机 profile 实测）：
 * - 官方搜索在 `WebRuntime.search` 内部按 `web.searchProvider` 选 provider；用户
 *   profile 的 `cordis.patch.yml` 在 bundle 层之后应用，官方 Web search 设置页也会
 *   写同一行。只在 `apply` 里改一次配置会被覆盖/回滚，0.4.0 因此“启用但没生效”。
 * - 改为在 **`ctx.web.search` 服务方法**上做可逆接管（见 `./takeover.js`）：启动即
 *   拦截所有 `web_search` 调用，启用态直接走 key 池；不依赖 provider id、不依赖
 *   官方 provider 注册顺序、不改 web 行配置。关闭时恢复原方法。
 * - 池不可用/失败默认**不回退官方**（`fallbackToOfficial: false`），抛中性错误；
 *   结果只保留 `{ content?, sources, truncated }`，模型看不到池内部字段。
 * - 宿主若把 `web.search` 冻结/设为不可配置，降级为按官方 provider id 替换对象方法；
 *   若连注册表也不可检查，再降级为配置同步（仅改 `web` 行）。
 * - `web` 服务重挂、profile reconcile 时重新 attach；`apply` 后做有限次重试，
 *   覆盖“web 服务比插件行晚激活”的启动竞态。
 *
 * 0.2.0 适配（2026-09-28，依据桌面版 0.2.0-rc.1 app.asar 提取源码实测）：
 * 宿主把 loader 拆成独立包 `@deepseek-ai/cordis-plugin-loader`（cordis 4.0.4 的 peer），
 * 但本入口依赖的契约逐项核对无破坏性变化：
 * - `ctx.web.registerSearchProvider`（dsh-web 的 `WebRuntime`）与 provider 面
 *   （`id` / `available()` / `search(request, signal)`）不变；
 * - `loader.resolve(id)` / `loader.update(id, {config})` 与事件 **`loader/volatile-update`**
 *   仍由 cordis-plugin-loader 提供（volatile-only 变更就地提交 Refs 并通知 owning fiber）；
 * - `WebError` / `credentialRef` / `launchEnvironmentOf` / volatile Ref 协议全部保留；
 * - `dsh-settings` 的表单投影（schema volatile → `SettingsForms.describe`）同样保留。
 *
 * 0.1.7 适配（2026-09-25，依据桌面版 0.1.7-rc.2 源码）：
 * - **settings section 注册接口已移除**：设置表单由 loader 行的 Config schema 自动投影
 *   （namespace = 行 id），本入口不注册任何 section。
 * - **config 运行形态变化**：volatile 字段在 `apply(ctx, config)` 里是 **Ref**，
 *   编辑经 `settings.mutate` 写入 profile patch 后就地提交，不重挂插件；
 *   变化通知事件是 `loader/volatile-update`。
 * - **web 行 id 变化**：0.1.1/0.1.2 官方 bundle 把 `web` 行插在 include 组内（`include:web`），
 *   0.1.7 起 dsh-base 直接把 `web` 行插在根组（`web`）。降级路径运行时探测两者。
 * - 运行时额度快照不再写 settings（0.1.7 的 settings 写入会持久化进 profile patch），
 *   Host 只做进程内刷新，观测走 `ctx.logger`。
 *
 * 历史兼容说明：0.4.0 起支持 DSH 0.1.7+ 与 0.2.0+ 两条线
 * （peer 范围 `^0.1.7-rc.1 || ^0.2.0-rc.1`，0.2.1-rc.x 落在 0.2.0 线内）。
 * @module dsh-web-search-pool
 */

import { Config, resolveOptions } from './config.js';
import { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID } from './provider.js';
import { SearchTakeover, OFFICIAL_SEARCH_PROVIDER_IDS } from './takeover.js';

export { Config, resolveOptions };
export { SearchPoolProvider, SEARCH_POOL_PROVIDER_ID };
export { SearchTakeover, OFFICIAL_SEARCH_PROVIDER_IDS };

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
 * `web` 行的 loader id：0.1.7 与 0.2.0 的 dsh-base 都插在根组（`web`）；
 * 旧版（0.1.1/0.1.2）在 include 子树里（`include:web`）。
 * 仅降级路径（注册表不可检查）使用。
 */
export const WEB_ROW_IDS = ['web', 'include:web'];

/**
 * `web` 行的配置兜底值（仅降级路径：注册表不可检查时写 `searchProvider`）。
 * id 定位的 patch 是**整体替换**而不是深合并，所以写回时必须先读出整行再合并；
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
    fallbackToOfficial: refValue(config?.fallbackToOfficial) === true,
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
 * 降级路径：注册表不可检查时，按 enabled 同步 `web` 行的 `searchProvider`。
 * 不再用“值未变化就跳过”的一次性守卫——每次都读实际 config，事件驱动可自愈。
 * @param {object} ctx 插件上下文。
 * @returns {(enabled: boolean) => void}
 */
function createFallbackSync(ctx) {
  /** 最近一次见到的官方 provider id（用于关闭时恢复用户原来的选择）。 */
  let fallbackProviderId = null;
  let warned = false;
  return function fallbackSync(enabled) {
    const loader = ctx.get?.('loader');
    if (loader == null || typeof loader.update !== 'function') return;
    const rowId = resolveWebRowId(ctx);
    if (rowId == null) {
      if (!warned) {
        warned = true;
        ctx.logger?.warn?.('search-pool: web loader row not found; searchProvider sync skipped');
      }
      return;
    }
    const current = readWebRowConfig(ctx, rowId);
    if (current == null) return;
    const currentProvider = typeof current.searchProvider === 'string' ? current.searchProvider : null;
    // 记录用户/官方页选择过的非池 provider；关闭时用它恢复。
    if (currentProvider != null
        && currentProvider !== SEARCH_POOL_PROVIDER_ID
        && !OFFICIAL_SEARCH_PROVIDER_IDS.includes(currentProvider)) {
      fallbackProviderId = currentProvider;
    } else if (currentProvider != null && OFFICIAL_SEARCH_PROVIDER_IDS.includes(currentProvider)) {
      fallbackProviderId = currentProvider;
    }
    const desired = enabled
      ? SEARCH_POOL_PROVIDER_ID
      : fallbackProviderId ?? OFFICIAL_SEARCH_PROVIDER_IDS[OFFICIAL_SEARCH_PROVIDER_IDS.length - 1];
    if (currentProvider === desired) return;
    const nextConfig = { ...current, searchProvider: desired };
    Promise.resolve(loader.update(rowId, { config: nextConfig })).catch((error) => {
      ctx.logger?.warn?.('search-pool: failed to sync web.searchProvider to "' + desired + '": ' + String(error?.message ?? error));
    });
  };
}

/**
 * @param {object} ctx 插件上下文。
 * @returns {() => void} dispose：插件停止时恢复官方 provider 并释放状态。
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

  const fallbackSync = createFallbackSync(ctx);
  const takeover = new SearchTakeover(provider, {
    enabled: refValue(config?.enabled) ?? true,
    fallbackToOfficial: refValue(config?.fallbackToOfficial) === true,
    onFallbackSync: fallbackSync,
    logger: ctx.logger,
  });

  /** 绑定当前 web 服务实例（幂等；服务重挂/晚注册时反复调用）。 */
  const attach = () => {
    const web = ctx.get?.('web');
    if (web != null) takeover.attach(web);
  };

  attach();
  if (takeover.serviceMode) {
    ctx.logger?.info?.('search-pool takeover active (mode=service, provider-id agnostic; fallbackToOfficial=' + String(takeover.fallbackToOfficial) + ')');
  } else if (takeover.registryMode) {
    ctx.logger?.info?.('search-pool takeover active (mode=registry, ids=' + OFFICIAL_SEARCH_PROVIDER_IDS.join(',') + ')');
  } else {
    // 宿主没有可检查的 searchProviders：降级到配置同步。
    fallbackSync(takeover.enabled);
    ctx.logger?.warn?.('search-pool takeover: web service is not inspectable; using config sync fallback');
  }

  // 启动竞态：官方 provider 行可能晚于本插件激活；有限次重试即可覆盖。
  const retryTimers = [];
  for (const delay of [0, 50, 250, 1000, 3000]) {
    const timer = setTimeout(attach, delay);
    timer.unref?.();
    retryTimers.push(timer);
  }

  /**
   * volatile 配置变化（设置卡片保存 / patch 编辑）：切换接管状态，
   * 并尽快刷新 Tavily 额度缓存（增删 key 后立刻反映额度门禁）。
   * 注意：loader 的 volatile 提交不会重挂插件，Ref 值与这里的事件是权威来源。
   */
  const onVolatileUpdate = () => {
    const next = snapshotConfig(config);
    takeover.setEnabled(next.enabled);
    takeover.setFallbackToOfficial(next.fallbackToOfficial);
    provider.refreshUsage(resolveOptions(ctx, next)).catch((error) => {
      ctx.logger?.warn?.('search-pool: usage refresh after config change failed: ' + String(error?.message ?? error));
    });
  };
  ctx.on('loader/volatile-update', onVolatileUpdate);

  // web 服务重挂、官方 provider 重新注册、profile reconcile / 树写入时重新同步。
  const onService = (serviceName) => {
    if (serviceName === 'web') attach();
  };
  const onReload = () => attach();
  ctx.on('internal/service', onService);
  ctx.on('app-boot/config-reload', onReload);
  ctx.on('loader/config-update', onReload);
  ctx.on('loader/partial-dispose', onReload);

  // 启动后后台刷新一次 Tavily 额度（单飞；无 Tavily key 时仅记录“没有可查询的 key”）。
  provider.refreshUsage(resolveOptions(ctx, snapshotConfig(config))).catch((error) => {
    ctx.logger?.warn?.('search-pool: initial Tavily usage refresh failed: ' + String(error?.message ?? error));
  });

  // 清理必须走 ctx.effect：cordis 的 Loader 不会把 apply 的返回值当作 disposer
  // （2026-10-19 用 cordis 4.0.4 实测），只有 effect 收集的函数会在 fiber 卸载时执行。
  ctx.effect(() => () => {
    for (const timer of retryTimers) clearTimeout(timer);
    // ctx.on 注册的监听随 fiber 自动注销；这里不再显式 off——fiber 卸载途中
    // ctx.off 可能抛 INACTIVE_EFFECT，会打断后面的恢复逻辑。
    takeover.dispose();
    provider.dispose();
  }, 'dsh-web-search-pool: search takeover');
}
