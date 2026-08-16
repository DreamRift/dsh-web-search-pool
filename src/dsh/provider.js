/**
 * DSH 搜索 provider 封装：一个 `WebSearchProvider`（id `search-pool`），内部实现
 * key 池 + 限流 + 调度 + Tavily/Exa 适配 + 429 换 key + 供应商 failover。
 * 仿照 `@deepseek-ai/dsh-web-search-deepseek` 的 provider 结构。
 * @module dsh-web-search-pool/provider
 */

import { WebError } from '@deepseek-ai/dsh-web';
import { KeyPool } from '../core/key-pool.js';
import { TokenBucketLimiter } from '../core/rate-limiter.js';
import { Scheduler } from '../core/scheduler.js';
import { RateLimitError, ProviderHttpError, isAbortError } from '../core/errors.js';
import { PROVIDER_TAVILY, PROVIDER_EXA, DEFAULTS } from '../core/constants.js';
import { withTimeout } from '../core/http-utils.js';
import { parseQueryIntent } from '../core/query-intent.js';
import { resolveTavilyParams, resolveExaParams } from '../core/resolve-params.js';
import { TavilyAdapter } from '../adapters/tavily.js';
import { ExaAdapter } from '../adapters/exa.js';

/** 稳定 provider id：seam 通过 `searchProvider: search-pool` 选中它。 */
export const SEARCH_POOL_PROVIDER_ID = 'search-pool';

/**
 * Exa 官方托管 MCP 匿名免费层是共享配额：无论配置多少个匿名 Exa key，
 * 全局强制最多 1 次/秒。此限制不可被配置覆盖。
 */
const ANONYMOUS_EXA_MAX_PER_SECOND = 1;
const ANONYMOUS_EXA_LIMITER_KEY = 'exa-anonymous';
const ANONYMOUS_EXA_COOLDOWN_MS = 1_000;

/** Tavily 额度刷新单次总超时（毫秒），避免 Host 静默挂起导致设置页无反馈。 */
const USAGE_REFRESH_TIMEOUT_MS = 15_000;

/**
 * 从选项构建一次 key 池（KeyPool + 限流器 + 调度器 + 适配器）。
 * 状态（冷却/令牌）进程内持久，配置变化时由 provider 缓存重建。
 */
function buildPool(options) {
  const keyPool = new KeyPool(options.entries, {
    allowedFails: options.allowedFails,
    cooldownMs: options.cooldownMs,
  });
  const rateLimiter = new TokenBucketLimiter({
    capacityFor: (id) => keyPool.entryById(id)?.rpm ?? DEFAULTS.rpmFallback,
  });
  const scheduler = new Scheduler({
    keyPool,
    rateLimiter,
    providerPriority: options.providerPriority,
    strategy: options.strategy,
  });
  const adapters = {
    [PROVIDER_TAVILY]: new TavilyAdapter({ retryAfterFallbackMs: options.retryAfterFallbackMs }),
    [PROVIDER_EXA]: new ExaAdapter({ retryAfterFallbackMs: options.retryAfterFallbackMs }),
  };
  const anonymousExaLimiter = new TokenBucketLimiter({
    capacity: ANONYMOUS_EXA_MAX_PER_SECOND,
    refillPerSec: ANONYMOUS_EXA_MAX_PER_SECOND,
  });
  return { keyPool, scheduler, adapters, anonymousExaLimiter };
}

/** entries 数组元素逐字段比较（KeySpec 的全部静态字段；运行时状态不参与）。 */
function sameEntry(x, y) {
  return x === y || (
    x.id === y.id
    && x.provider === y.provider
    && x.credentialRef === y.credentialRef
    && x.rpm === y.rpm
    && x.anonymous === y.anonymous
    && (x.remark ?? undefined) === (y.remark ?? undefined)
  );
}

/**
 * 判断两份 options 是否描述同一个 key 池（决定 pool 缓存是否复用）。
 * 浅比较：五元组 + entries 逐项，O(n) 且无 JSON 序列化开销。
 */
function samePoolOptions(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.strategy !== b.strategy
    || a.allowedFails !== b.allowedFails
    || a.cooldownMs !== b.cooldownMs
    || a.retryAfterFallbackMs !== b.retryAfterFallbackMs) return false;
  const pa = a.providerPriority ?? [];
  const pb = b.providerPriority ?? [];
  if (pa.length !== pb.length || pa.some((v, i) => v !== pb[i])) return false;
  const ea = a.entries ?? [];
  const eb = b.entries ?? [];
  if (ea.length !== eb.length) return false;
  return ea.every((entry, i) => sameEntry(entry, eb[i]));
}

/**
 * 搜索池 provider。
 * `resolveOptions` 是 thunk：每次 search 取一次最新 section，避免一次搜索混用两个 section。
 */
export class SearchPoolProvider {
  /**
   * @param {() => object} resolveOptions 每次搜索取最新配置快照。
   * @param {{ publishUsage?: (snapshot: object) => Promise<unknown>|void }} [options]
   */
  constructor(resolveOptions, options = {}) {
    this.resolveOptions = resolveOptions;
    this.publishUsage = options.publishUsage;
    this.id = SEARCH_POOL_PROVIDER_ID;
    this._poolCache = null;
    /** 上一次建池时的 options 引用（配合 samePoolOptions 决定复用）。 */
    this._poolOptions = null;
    this._usageCache = null;
    this._usageRefreshPromise = null;
    this._quotaExhaustedRefs = new Set();
    this._disposed = false;
  }

  /** 本地可用性检查：至少声明了一个 key（不发网络）。 */
  available() {
    return !this._disposed && this.resolveOptions().available;
  }

  /** 配置快照变化时重建 pool，否则复用（保留冷却/令牌状态）。 */
  _getPool(options) {
    if (this._poolCache != null && samePoolOptions(this._poolOptions, options)) return this._poolCache;
    this._poolCache = buildPool(options);
    this._poolOptions = options;
    this._usageCache = null;
    return this._poolCache;
  }

  /**
   * 刷新所有 Tavily key 的额度快照并发布给设置页（单飞：并发调用复用同一次刷新）。
   * 只统计有凭据的 Tavily key；Exa 没有公开余额接口，不计入。
   * @param {object} options
   * @returns {Promise<object|null>}
   */
  refreshUsage(options) {
    if (this._usageRefreshPromise != null) return this._usageRefreshPromise;
    this._usageRefreshPromise = this._performUsageRefresh(options)
      .catch((error) => {
        options.recordRequest?.({ provider: PROVIDER_TAVILY, keyId: '*', ok: false, code: 'USAGE_REFRESH_FAILED', message: String(error?.message ?? error) });
        return this._usageCache;
      })
      .finally(() => {
        this._usageRefreshPromise = null;
      });
    return this._usageRefreshPromise;
  }

  /**
   * 额度刷新的实现：并行查询全部 Tavily key 的 `/usage`（受 15 秒总超时保护）。
   * 写回缓存前校验 pool 未被重建（配置变化会重建 pool 并清缓存，避免旧数据错配新配置）。
   */
  async _performUsageRefresh(options) {
    const entries = (options.entries ?? []).filter((entry) => entry.provider === PROVIDER_TAVILY && entry.credentialRef != null);
    const pool = this._getPool(options);
    if (entries.length === 0) {
      const emptySnapshot = { updatedAt: Date.now(), totalUsed: 0, totalLimit: 0, keys: [] };
      if (this._poolCache === pool) this._usageCache = { fetchedAt: Date.now(), byRef: new Map() };
      this._recoverQuota(options, pool);
      this._publishUsage(emptySnapshot, '没有可查询的 Tavily key');
      return emptySnapshot;
    }

    const adapter = new TavilyAdapter({ retryAfterFallbackMs: options.retryAfterFallbackMs });
    const byRef = new Map();
    const errors = [];
    let totalUsed = 0;
    let totalLimit = 0;
    let hasLimit = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), USAGE_REFRESH_TIMEOUT_MS);
    try {
      // 并行查询（每个任务内部已捕获全部异常）；总超时经共享 controller 传播到所有请求。
      await Promise.all(entries.map(async (entry) => {
        try {
          const apiKey = await options.resolveKey(entry, controller.signal);
          if (apiKey == null) {
            errors.push(`${entry.credentialRef}: 未配置凭据`);
            return;
          }
          const usage = await adapter.getUsage(apiKey, controller.signal);
          byRef.set(entry.credentialRef, { ...usage, ref: entry.credentialRef });
          if (usage.limit != null) {
            hasLimit = true;
            totalUsed += usage.used;
            totalLimit += usage.limit;
          }
        } catch (error) {
          if (controller.signal.aborted === true) {
            errors.push(`${entry.credentialRef}: 刷新超时`);
            return;
          }
          errors.push(`${entry.credentialRef}: ${String(error?.message ?? error)}`);
          options.recordRequest?.({
            provider: entry.provider,
            keyId: entry.id,
            ok: false,
            code: 'USAGE_QUERY_FAILED',
            message: String(error?.message ?? error),
          });
        }
      }));
    } finally {
      clearTimeout(timeout);
    }

    const snapshot = {
      updatedAt: Date.now(),
      totalUsed,
      totalLimit: hasLimit ? totalLimit : 0,
      keys: [...byRef.values()].map((usage) => ({
        ref: usage.ref,
        used: usage.used,
        limit: usage.limit ?? 0,
        remaining: usage.remaining ?? -1,
        plan: usage.plan,
      })),
    };
    if (this._poolCache === pool) {
      // pool 未被重建才写回，避免刷新期间配置变化导致旧 byRef 错配新 entries。
      this._usageCache = { fetchedAt: Date.now(), byRef };
      this._recoverQuota(options, pool);
    }
    const diagnostic = errors.length > 0 ? 'Tavily 额度刷新部分失败: ' + errors.join('; ') : '';
    this._publishUsage(snapshot, diagnostic);
    return snapshot;
  }

  /**
   * 后台刷新入口：缓存未过期直接跳过；过期/为空时发起单飞刷新（不阻塞调用方）。
   * 搜索路径用它做「尽力而为」的额度闸门数据维护——额度刷新绝不拖慢搜索首字节。
   */
  _kickUsageRefresh(options) {
    if (this._usageCache != null && Date.now() - this._usageCache.fetchedAt < options.usageCacheMs) return;
    this.refreshUsage(options);
  }

  /**
   * 额度恢复后，在调度器选中 entry 前解除长冷却，否则 acquire 会一直跳过该 key。
   */
  _recoverQuota(options, pool) {
    if (this._quotaExhaustedRefs.size === 0 || this._usageCache == null) return;
    for (const ref of [...this._quotaExhaustedRefs]) {
      const usage = this._usageCache.byRef.get(ref);
      if (usage == null || usage.remaining == null || usage.remaining < options.quotaReserveCredits) continue;
      const entry = pool.keyPool.entryByRef(ref);
      if (entry != null) pool.scheduler.clearCooldown(entry);
      this._quotaExhaustedRefs.delete(ref);
    }
  }

  _publishUsage(snapshot, diagnostic = '') {
    if (this.publishUsage == null || snapshot == null) return;
    Promise.resolve(this.publishUsage(snapshot, diagnostic)).catch((error) => {
      this.resolveOptions()?.recordRequest?.({ provider: PROVIDER_TAVILY, keyId: '*', ok: false, code: 'USAGE_PUBLISH_FAILED', message: String(error?.message ?? error) });
    });
  }

  /** 插件卸载时释放缓存状态；此后搜索直接判定不可用（配合 index.js 的 dispose）。 */
  dispose() {
    this._disposed = true;
    this._poolCache = null;
    this._poolOptions = null;
    this._usageCache = null;
  }

  async search(request, signal) {
    if (this._disposed) {
      throw new WebError('search-pool provider is disposed', 'WEB_PROVIDER_UNAVAILABLE');
    }
    try {
      return await this._search(request, signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) {
        throw new WebError('search-pool search aborted', 'WEB_ABORTED', { cause: error });
      }
      if (error instanceof WebError) throw error;
      throw new WebError(`search-pool search failed: ${String(error?.message ?? error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
    }
  }

  async _search(request, signal) {
    const options = this.resolveOptions();
    if (!options.available) {
      throw new WebError('search-pool has no configured search key; add at least one key', 'WEB_PROVIDER_CREDENTIAL_MISSING');
    }
    const pool = this._getPool(options);
    const maxAttempts = pool.keyPool.totalKeys;
    const timeoutMs = options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;

    // 后台维护 Tavily 额度缓存（不阻塞搜索）：未过期直接复用，过期则单飞刷新，
    // 本轮闸门用旧缓存判断；完全无缓存时闸门先放行，靠上游错误兜底（刷新完成后自动恢复闸门）。
    if (pool.adapters[PROVIDER_TAVILY] != null) {
      this._kickUsageRefresh(options);
      this._recoverQuota(options, pool);
    }

    // 解析 query 意图 + 供应商高级参数（auto 模式结合 query 语义落定）。
    const intent = parseQueryIntent(request.query);
    const paramsByProvider = {
      [PROVIDER_TAVILY]: resolveTavilyParams(options.tavilyParams, intent),
      [PROVIDER_EXA]: resolveExaParams(options.exaParams, intent),
    };

    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      throwIfAborted(signal);
      const entry = pool.scheduler.acquire();
      if (entry == null) break;

      let apiKey;
      try {
        apiKey = await options.resolveKey(entry, signal);
      } catch (error) {
        // 凭据解析本身抛错（如启动环境服务故障）：按 key 失败处理并换下一个，不让整个搜索中断。
        if (signal?.aborted === true || isAbortError(error)) throw error;
        pool.scheduler.recordError(entry);
        options.recordRequest?.({ provider: entry.provider, keyId: entry.id, ok: false, code: 'KEY_RESOLVE_FAILED', message: String(error?.message ?? error) });
        if (lastError == null || lastError.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') {
          lastError = error;
        }
        continue;
      }
      const adapter = pool.adapters[entry.provider];
      if (apiKey == null && !(adapter != null && adapter.supportsAnonymous === true)) {
        // 凭据缺失：记一次失败（触发熔断冷却，避免反复空试）。
        pool.scheduler.recordError(entry);
        options.recordRequest?.({ provider: entry.provider, keyId: entry.id, ok: false, code: 'CREDENTIAL_MISSING' });
        if (lastError == null || lastError.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') {
          lastError = new WebError(`search-pool key "${entry.credentialRef ?? entry.id}" is not configured`, 'WEB_PROVIDER_CREDENTIAL_MISSING');
        }
        continue;
      }

      // Exa 匿名免费层是共享配额：所有匿名 Exa 搜索共用一个 1 次/秒的硬限流桶。
      if (entry.provider === PROVIDER_EXA && apiKey == null
          && !pool.anonymousExaLimiter.tryAcquire(ANONYMOUS_EXA_LIMITER_KEY, Date.now())) {
        pool.scheduler.recordRateLimit(entry, ANONYMOUS_EXA_COOLDOWN_MS);
        options.recordRequest?.({ provider: entry.provider, keyId: entry.id, ok: false, code: 'RATE_LIMIT', retryAfterMs: ANONYMOUS_EXA_COOLDOWN_MS });
        if (lastError == null || lastError.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') {
          lastError = new RateLimitError('Exa anonymous free layer allows 1 request per second', ANONYMOUS_EXA_COOLDOWN_MS);
        }
        continue;
      }

      // Tavily 额度检查：剩余额度不够下一次使用时进入长冷却；额度刷新恢复后自动解除。
      if (entry.provider === PROVIDER_TAVILY && apiKey != null && entry.credentialRef != null) {
        const usage = this._usageCache?.byRef.get(entry.credentialRef);
        if (usage != null && usage.remaining != null && usage.remaining < options.quotaReserveCredits) {
          pool.scheduler.recordRateLimit(entry, options.quotaExhaustedCooldownMs);
          this._quotaExhaustedRefs.add(entry.credentialRef);
          options.recordRequest?.({
            provider: entry.provider,
            keyId: entry.id,
            ok: false,
            code: 'QUOTA_EXHAUSTED',
            remaining: usage.remaining,
          });
          if (lastError == null || lastError.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') {
            lastError = new RateLimitError(`Tavily key "${entry.credentialRef}" quota exhausted`, options.quotaExhaustedCooldownMs);
          }
          continue;
        }
        if (this._quotaExhaustedRefs.has(entry.credentialRef)
            && usage != null && usage.remaining != null && usage.remaining >= options.quotaReserveCredits) {
          pool.scheduler.clearCooldown(entry);
          this._quotaExhaustedRefs.delete(entry.credentialRef);
        }
      }

      let guard = null;
      try {
        // per-attempt 超时：外部 signal 与内部定时器组合；超时按 key 失败处理并换 key，
        // 外部取消原样重抛（终止整个搜索）。
        guard = withTimeout(signal, timeoutMs);
        const result = await adapter.search({
          query: request.query,
          apiKey,
          maxResults: request.maxResults,
          signal: guard.signal,
          ...(paramsByProvider[entry.provider] ?? {}),
        });
        pool.scheduler.recordSuccess(entry);
        options.recordRequest?.({ provider: entry.provider, keyId: entry.id, ok: true, code: 'OK' });
        return result;
      } catch (error) {
        const timedOut = guard != null && guard.timedOut() && signal?.aborted !== true;
        if (!timedOut && (signal?.aborted === true || isAbortError(error))) throw error;
        if (timedOut) {
          pool.scheduler.recordError(entry);
          options.recordRequest?.({
            provider: entry.provider,
            keyId: entry.id,
            ok: false,
            code: 'TIMEOUT',
            message: `request timed out after ${timeoutMs}ms`,
          });
          if (lastError == null || lastError.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') {
            lastError = new ProviderHttpError(`search-pool key "${entry.credentialRef ?? entry.id}" request timed out after ${timeoutMs}ms`, 0, { cause: error });
          }
          continue;
        }
        if (error instanceof RateLimitError) {
          pool.scheduler.recordRateLimit(entry, error.retryAfterMs);
          options.recordRequest?.({
            provider: entry.provider,
            keyId: entry.id,
            ok: false,
            code: 'RATE_LIMIT',
            retryAfterMs: error.retryAfterMs,
          });
        } else {
          pool.scheduler.recordError(entry);
          options.recordRequest?.({
            provider: entry.provider,
            keyId: entry.id,
            ok: false,
            code: 'ERROR',
            message: String(error?.message ?? error),
          });
        }
        if (lastError == null || lastError.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') lastError = error;
      } finally {
        guard?.cleanup();
      }
    }

    if (lastError != null) {
      // RateLimitError 保留语义地转成 WebError（外层只认 WebError code 集合），message 携带 retry-after。
      if (lastError instanceof RateLimitError) {
        throw new WebError(
          `search-pool search failed: rate limited (${lastError.message}; retry after ${lastError.retryAfterMs}ms)`,
          'WEB_PROVIDER_ERROR',
          { cause: lastError },
        );
      }
      throw lastError;
    }
    throw new WebError('search-pool has no usable search key (all cooling or rate-limited)', 'WEB_PROVIDER_UNAVAILABLE');
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw new DOMException('search-pool search aborted', 'AbortError');
}
