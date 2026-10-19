/**
 * DeepSeek 官方搜索的运行时接管。
 *
 * 背景（2026-10-19，宿主 0.2.1-rc.2 源码核对 + 本机 profile 实测）：
 * - 官方搜索有两条链路，分别注册成两个 provider：
 *   - `deepseek-search-api`（`@deepseek-ai/dsh-web-deepseek-api`）：
 *     `POST https://api.deepseek.com/v1/tools/search`，body
 *     `{ query, count, need_content: false, ori_question? }`，凭据
 *     `DEEPSEEK_API_KEY`（Bearer）或 DeepSeek Account token。
 *   - `deepseek-official`（`@deepseek-ai/dsh-web-search-deepseek`）：
 *     `POST https://api.deepseek.com/anthropic/v1/messages`，Anthropic Messages
 *     body + 原生 `web_search_20250305` server tool，同样用 API key 或账号 token。
 * - `WebRuntime.search` 在**调用时**按 `web` 行的 `searchProvider`（volatile）
 *   或 `$DSH_WEB_SEARCH_PROVIDER` 选 provider；用户 profile 的
 *   `cordis.patch.yml` 在所有 bundle 层之后应用，官方 Web search 设置页也会写同一行。
 *   因此「在 apply 里改一次 web.searchProvider」必然会被覆盖——这正是 0.4.0
 *   看起来启用、实际仍走官方 API key 的根因。
 *
 * 0.5.0 的接管点改到 **`ctx.web.search` 服务方法本身**：
 * - 启动时在 web 服务实例上定义一个 own `search`，启用态直接委托给 key 池；
 * - 不依赖 provider id、不依赖官方 provider 的注册顺序、不改 web 行配置；
 * - 关闭时 wrapper 原地委托回原 `web.search`（官方 provider 原样可用）；
 *   插件卸载时才按 descriptor 把服务方法恢复；
 * - 池不可用/失败时默认**不回退官方**（`fallbackToOfficial: false`），
 *   抛中性的 `WEB_PROVIDER_UNAVAILABLE`，模型不会看到 Tavily / key 池字样；
 * - 结果只保留官方 seam 同形的 `{ content?, sources, truncated }`，去掉
 *   `query` / `provider` 等池内部字段，并对 `maxResults` 做与宿主相同的截断。
 *
 * 宿主若把 `web.search` 冻结/设为不可配置（未来实现变化），降级为按官方
 * provider id 替换 provider 对象的 `search` / `available`（`deepseek-search-api`
 * / `deepseek-official`）。若连 provider 注册表也不可检查，再降级为配置同步
 * （`onFallbackSync`，由入口注入 loader.update）。
 *
 * @module dsh-web-search-pool/takeover
 */

import { WebError } from '@deepseek-ai/dsh-web';

/** 要接管的 DeepSeek 官方搜索 provider id（降级路径与官方委托使用，顺序即偏好）。 */
export const OFFICIAL_SEARCH_PROVIDER_IDS = Object.freeze([
  'deepseek-search-api',
  'deepseek-official',
]);

/** 读取 volatile 字段的当前值（Ref 取 `.get()`，普通值原样返回）。 */
function refValue(field) {
  return field != null && typeof field.get === 'function' ? field.get() : field;
}

/** 读取 web 服务的 provider 注册表；不是 Map 时返回 null（走降级路径）。 */
export function searchRegistryOf(web) {
  const registry = web?.searchProviders;
  return registry instanceof Map ? registry : null;
}

/** 日志里的错误摘要：只进 logger，不进模型可见文本。 */
function describeError(error) {
  return String(error?.message ?? error);
}

/**
 * 可逆的官方搜索接管器。
 *
 * 只操作 web 服务实例和 provider 对象的实例属性，不修改 host 包、不写 profile 配置；
 * 所有替换都记录原 descriptor，`dispose()` / `setEnabled(false)` 可完整恢复。
 */
export class SearchTakeover {
  /**
   * @param {object} provider 池 provider（需有 `id` / `search` / `available` /
   *   `setDelegate(resolve)`）。
   * @param {object} [options]
   * @param {boolean} [options.enabled] 初始启用状态。
   * @param {boolean} [options.fallbackToOfficial] 池不可用/失败时是否回退官方。
   * @param {(enabled: boolean) => void} [options.onFallbackSync] 注册表不可检查时的
   *   降级同步回调（入口用 `loader.update` 实现）。
   * @param {{ warn?: Function, info?: Function }} [options.logger] 诊断出口。
   */
  constructor(provider, options = {}) {
    this.provider = provider;
    this.enabled = options.enabled ?? true;
    this.fallbackToOfficial = options.fallbackToOfficial === true;
    this.onFallbackSync = typeof options.onFallbackSync === 'function' ? options.onFallbackSync : null;
    this.logger = options.logger ?? null;
    /** @type {object|null} 当前接管的 web 服务实例。 */
    this.web = null;
    /** @type {(() => void)|null} `registerSearchProvider` 返回的注销函数。 */
    this.registration = null;
    /** @type {{ descriptor: PropertyDescriptor|undefined, original: Function, patched: Function }|null} */
    this.servicePatch = null;
    /** @type {Map<object, { search: PropertyDescriptor|undefined, available: PropertyDescriptor|undefined }>} */
    this.patches = new Map();
    /** 被冻结/不可 patch 的对象，避免每次 sync 重试刷屏。 */
    this.unpatchable = new WeakSet();
    /** 降级路径的防重入标记。 */
    this._fallbackPending = false;
    /** 已 dispose：阻止延迟重试/服务事件把补丁重新装回去。 */
    this.disposed = false;
    /** 已接管的模式：service | registry | config | none。 */
    this.mode = 'none';
    /** 禁用态委托的官方 provider id。 */
    this.delegateId = null;

    // 池 provider 在禁用态通过该 resolver 找回官方实现；启用态返回 null。
    this.provider.setDelegate?.(() => this._delegate());
  }

  /** 当前是否走服务级接管（默认路径）。 */
  get serviceMode() {
    return this.mode === 'service';
  }

  /** 当前是否走 provider 级降级接管。 */
  get registryMode() {
    return this.mode === 'registry';
  }

  /**
   * 绑定（或重新绑定）web 服务实例：实例变化时先恢复旧实例上的替换，
   * 再注册池 provider 并安装接管。幂等，可在事件回调里反复调用。
   * @param {object|null|undefined} web `ctx.get('web')` 的当前实现。
   * @returns {boolean} 本次是否发生了替换/恢复。
   */
  attach(web) {
    if (this.disposed || web == null) return false;
    if (web !== this.web) {
      this.detach();
      this.web = web;
      this._register(web);
      this._install(web);
      return true;
    }
    if (this.servicePatch == null && this.patches.size === 0) this._install(web);
    return this.sync();
  }

  /**
   * 按当前 `enabled` 状态同步接管：
   * - 服务级接管已安装时无需按 provider 逐个处理；
   * - provider 级降级时启用→替换、禁用→恢复。幂等。
   * @returns {boolean} 是否发生变化。
   */
  sync() {
    if (this.disposed || this.web == null) return false;
    if (this.servicePatch != null) {
      this.mode = 'service';
      return false;
    }
    const registry = searchRegistryOf(this.web);
    if (registry == null) {
      this._scheduleFallback();
      return false;
    }
    this.mode = 'registry';
    return this._syncRegistry(registry);
  }

  /**
   * 切换启用状态。服务级接管的 wrapper 每次调用都读该字段，无需重装。
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    if (this.disposed) return;
    const next = enabled !== false;
    if (this.enabled === next) {
      this.sync();
      return;
    }
    this.enabled = next;
    this.sync();
  }

  /**
   * 切换「池不可用时回退官方」。wrapper 每次调用都读该字段。
   * @param {boolean} value
   */
  setFallbackToOfficial(value) {
    if (this.disposed) return;
    this.fallbackToOfficial = value === true;
  }

  /** 恢复全部替换并注销池 provider（插件卸载时调用）。 */
  dispose() {
    this.disposed = true;
    this.detach();
  }

  /** 恢复全部替换、注销池 provider，但保留 `enabled` 状态（重挂到新实例前调用）。 */
  detach() {
    this._restoreService();
    this._restoreAll();
    this._unregister();
    this.web = null;
    this.mode = 'none';
    this.delegateId = null;
  }

  // ── 安装 ──────────────────────────────────────────────────────────────────

  /** 优先服务级接管；不可行时退回 provider 级；再不行退回配置同步。 */
  _install(web) {
    if (this._patchService(web)) {
      this.mode = 'service';
      return;
    }
    const registry = searchRegistryOf(web);
    if (registry != null) {
      this.mode = 'registry';
      this._syncRegistry(registry);
      return;
    }
    this.mode = 'config';
    this._scheduleFallback();
  }

  /**
   * 在 web 服务实例上定义 own `search`。这是唯一需要拦截的入口：
   * `web_search` 工具只调用 `ctx.web.search`，provider 选择发生在它内部。
   * @returns {boolean} 是否安装成功。
   */
  _patchService(web) {
    if (this.servicePatch != null) return true;
    const original = web.search;
    if (typeof original !== 'function') return false;
    const descriptor = Object.getOwnPropertyDescriptor(web, 'search');
    const self = this;
    const patched = function search(request, signal) {
      return self._search(request, signal, {
        disabled: () => original.call(web, request, signal),
        official: () => self._officialSearch(request, signal),
      });
    };
    try {
      Object.defineProperty(web, 'search', {
        configurable: true,
        writable: true,
        value: patched,
      });
    } catch (error) {
      this._warn('web.search is not patchable; falling back to provider takeover: ' + describeError(error));
      return false;
    }
    this.servicePatch = { descriptor, original, patched };
    this._info('takeover installed at web.search (provider-id agnostic)');
    return true;
  }

  /** 恢复 web 服务原来的 `search`（原型方法或原有 own descriptor）。 */
  _restoreService() {
    if (this.servicePatch == null) return;
    const { descriptor } = this.servicePatch;
    const web = this.web;
    this.servicePatch = null;
    if (web == null) return;
    try {
      if (descriptor === undefined) delete web.search;
      else Object.defineProperty(web, 'search', descriptor);
    } catch (error) {
      this._warn('failed to restore web.search: ' + describeError(error));
    }
  }

  // ── 搜索路径 ──────────────────────────────────────────────────────────────

  /**
   * 统一搜索路径：启用→池；禁用→原实现；池不可用/失败→按 `fallbackToOfficial`
   * 决定回退官方还是抛中性错误。
   * @param {{ query: string, maxResults?: number }} request
   * @param {AbortSignal} [signal]
   * @param {{ disabled: () => Promise<object>, official: () => Promise<object> }} fallback
   */
  async _search(request, signal, fallback) {
    if (this.enabled !== true) return fallback.disabled();
    if (!this._poolAvailable()) {
      if (this.fallbackToOfficial) return fallback.official();
      throw this._unavailableError();
    }
    try {
      const result = await this.provider.search(request, signal);
      return this._normalize(result, request?.maxResults);
    } catch (error) {
      if (this._isAbort(error, signal)) throw this._abortError(error);
      if (this.fallbackToOfficial) {
        try {
          return await fallback.official();
        } catch (officialError) {
          if (this._isAbort(officialError, signal)) throw this._abortError(officialError);
          this._warn('official fallback failed: ' + describeError(officialError));
          throw this._neutralError(officialError);
        }
      }
      this._warn('pool search failed; official fallback disabled: ' + describeError(error));
      throw this._neutralError(error);
    }
  }

  /** 池是否可用（不发网络；配置/凭据缺失时返回 false）。 */
  _poolAvailable() {
    try {
      return this.provider.available() === true;
    } catch {
      return false;
    }
  }

  /**
   * 直接调用官方 provider（回退路径）。按当前 `searchProvider` 选择、再按已知
   * 官方 id 兜底，最后接受任意非池 provider；跳过已被降级 patch 的对象，避免递归。
   */
  async _officialSearch(request, signal) {
    const registry = searchRegistryOf(this.web);
    if (registry == null) throw this._unavailableError();
    const configured = refValue(this.web?.config?.searchProvider);
    const ids = [];
    if (typeof configured === 'string' && configured !== this.provider.id) ids.push(configured);
    for (const id of OFFICIAL_SEARCH_PROVIDER_IDS) {
      if (!ids.includes(id)) ids.push(id);
    }
    const usable = (provider) => provider != null
      && provider !== this.provider
      && !this.patches.has(provider)
      && typeof provider.search === 'function'
      && (typeof provider.available !== 'function' || provider.available() === true);
    for (const id of ids) {
      const provider = registry.get(id);
      if (usable(provider)) return provider.search(request, signal);
    }
    for (const provider of registry.values()) {
      if (usable(provider)) return provider.search(request, signal);
    }
    throw this._unavailableError();
  }

  /**
   * 把池结果投影成官方 seam 同形结构：只保留 `content?` / `sources` / `truncated`，
   * 并像 `WebRuntime.search` 一样按 `maxResults` 截断。
   */
  _normalize(result, maxResults) {
    if (result == null || typeof result !== 'object' || !Array.isArray(result.sources)) {
      throw new WebError('Web search returned an invalid result', 'WEB_PROVIDER_ERROR');
    }
    let sources = result.sources;
    let truncated = result.truncated === true;
    if (Number.isInteger(maxResults) && maxResults >= 0 && sources.length > maxResults) {
      sources = sources.slice(0, maxResults);
      truncated = true;
    }
    const normalized = { sources, truncated };
    if (typeof result.content === 'string' && result.content.length > 0) normalized.content = result.content;
    return normalized;
  }

  /** 判断取消（外部 signal 或池内部的 AbortError / WEB_ABORTED）。 */
  _isAbort(error, signal) {
    return signal?.aborted === true
      || error?.name === 'AbortError'
      || error?.code === 'WEB_ABORTED';
  }

  _abortError(error) {
    return new WebError('Web search was aborted', 'WEB_ABORTED', { cause: error });
  }

  /** 模型可见的中性错误：不出现 Tavily / Exa / key 池 / 官方端点等实现细节。 */
  _neutralError(error) {
    if (error instanceof WebError && error.code === 'WEB_ABORTED') return error;
    const rateLimited = error?.retryAfterMs != null || error?.status === 429;
    return new WebError(
      rateLimited
        ? 'Web search is temporarily rate limited; try again later.'
        : 'Web search is temporarily unavailable.',
      rateLimited ? 'WEB_PROVIDER_ERROR' : 'WEB_PROVIDER_UNAVAILABLE',
      { cause: error },
    );
  }

  _unavailableError() {
    return new WebError('Web search is temporarily unavailable.', 'WEB_PROVIDER_UNAVAILABLE');
  }

  // ── 注册 / 降级 ───────────────────────────────────────────────────────────

  /** 在 web 实例上注册池 provider（已存在则跳过）。 */
  _register(web) {
    const registry = searchRegistryOf(web);
    if (registry == null) {
      this._scheduleFallback();
      return;
    }
    if (registry.has(this.provider.id)) return;
    if (typeof web.registerSearchProvider !== 'function') {
      this._warn('web.registerSearchProvider is unavailable; provider not registered');
      return;
    }
    try {
      const disposer = web.registerSearchProvider(this.provider);
      this.registration = typeof disposer === 'function' ? disposer : null;
    } catch (error) {
      this._warn('failed to register provider: ' + describeError(error));
    }
  }

  /** 注销池 provider（如果当前实例仍持有它）。 */
  _unregister() {
    if (this.registration == null) return;
    try {
      this.registration();
    } catch {
      // 实例已随旧 fiber 释放时 disposer 可能已失效；忽略。
    }
    this.registration = null;
  }

  /** provider 级降级：按官方 id 替换 `search` / `available`。 */
  _syncRegistry(registry) {
    let changed = false;
    if (this.enabled) {
      for (const id of OFFICIAL_SEARCH_PROVIDER_IDS) {
        const provider = registry.get(id);
        if (provider == null) continue;
        changed = this._patchProvider(provider) || changed;
      }
      // 官方行重挂后旧对象可能已不在注册表：丢弃记录即可（对象随旧 fiber 释放）。
      for (const provider of [...this.patches.keys()]) {
        if (!this._isRegistered(registry, provider)) this.patches.delete(provider);
      }
    } else {
      changed = this._restoreAll() || changed;
    }
    return changed;
  }

  /** 替换一个官方 provider 的 `search` / `available`（仅降级路径）。 */
  _patchProvider(provider) {
    if (this.patches.has(provider) || this.unpatchable.has(provider)) return false;
    if (typeof provider.search !== 'function' || typeof provider.available !== 'function') {
      this.unpatchable.add(provider);
      this._warn('official provider "' + String(provider.id) + '" lacks search/available; takeover skipped');
      return false;
    }
    const search = Object.getOwnPropertyDescriptor(provider, 'search');
    const available = Object.getOwnPropertyDescriptor(provider, 'available');
    const originalSearch = provider.search;
    const self = this;
    const callOriginal = (request, signal) => originalSearch.call(provider, request, signal);
    try {
      Object.defineProperty(provider, 'search', {
        configurable: true,
        writable: true,
        value: function search(request, signal) {
          return self._search(request, signal, {
            disabled: () => callOriginal(request, signal),
            official: () => callOriginal(request, signal),
          });
        },
      });
      // available 恒为 true：让 seam 继续调用 search，由 _search 决定池/中性错误；
      // 否则 seam 会在调用前抛「configured provider unavailable」并泄露官方 id。
      Object.defineProperty(provider, 'available', {
        configurable: true,
        writable: true,
        value: function available() {
          return true;
        },
      });
    } catch (error) {
      this.unpatchable.add(provider);
      this._warn('failed to patch official provider "' + String(provider.id) + '": ' + describeError(error));
      return false;
    }
    this.patches.set(provider, { search, available });
    if (this.delegateId == null || provider.id === OFFICIAL_SEARCH_PROVIDER_IDS[0]) {
      this.delegateId = typeof provider.id === 'string' ? provider.id : this.delegateId;
    }
    this._info('takeover patched official provider "' + String(provider.id) + '" (fallback mode)');
    return true;
  }

  /** 恢复一个 provider 的原方法。 */
  _restore(provider, saved) {
    try {
      if (saved.search === undefined) delete provider.search;
      else Object.defineProperty(provider, 'search', saved.search);
      if (saved.available === undefined) delete provider.available;
      else Object.defineProperty(provider, 'available', saved.available);
    } catch (error) {
      this._warn('failed to restore official provider "' + String(provider.id) + '": ' + describeError(error));
    }
  }

  /** 恢复所有已替换的 provider。 */
  _restoreAll() {
    if (this.patches.size === 0) return false;
    for (const [provider, saved] of [...this.patches]) this._restore(provider, saved);
    this.patches.clear();
    return true;
  }

  /** provider 对象当前是否仍在注册表里。 */
  _isRegistered(registry, provider) {
    for (const value of registry.values()) {
      if (value === provider) return true;
    }
    return false;
  }

  /** 禁用态委托：从当前注册表取官方 provider 的实时方法（不缓存旧实例）。 */
  _delegate() {
    if (this.enabled) return null;
    const registry = searchRegistryOf(this.web);
    if (registry == null) return null;
    // 优先用户/官方设置页当前选中的官方 id，其次上一次 patch 的 id，最后按固定顺序。
    const selected = refValue(this.web?.config?.searchProvider);
    const preferred = typeof selected === 'string'
      && selected !== this.provider.id
      && OFFICIAL_SEARCH_PROVIDER_IDS.includes(selected)
      ? selected
      : this.delegateId;
    const ids = preferred == null
      ? OFFICIAL_SEARCH_PROVIDER_IDS
      : [preferred, ...OFFICIAL_SEARCH_PROVIDER_IDS.filter((id) => id !== preferred)];
    for (const id of ids) {
      const provider = registry.get(id);
      if (provider == null || this.patches.has(provider)) continue;
      if (typeof provider.search !== 'function' || typeof provider.available !== 'function') continue;
      return {
        search: (request, signal) => provider.search(request, signal),
        available: () => provider.available() === true,
      };
    }
    return null;
  }

  /** 注册表不可检查时，交给入口做一次配置同步（带防重入）。 */
  _scheduleFallback() {
    if (this.onFallbackSync == null) {
      this.mode = 'none';
      return;
    }
    this.mode = 'config';
    if (this._fallbackPending) return;
    this._fallbackPending = true;
    queueMicrotask(() => {
      this._fallbackPending = false;
      try {
        this.onFallbackSync(this.enabled);
      } catch (error) {
        this._warn('fallback config sync failed: ' + describeError(error));
      }
    });
  }

  _warn(message) {
    try {
      this.logger?.warn?.('search-pool: ' + message);
    } catch {
      // 日志失败不影响搜索。
    }
  }

  _info(message) {
    try {
      this.logger?.info?.('search-pool: ' + message);
    } catch {
      // 日志失败不影响搜索。
    }
  }
}
