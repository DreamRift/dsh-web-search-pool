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
import { RateLimitError, isAbortError } from '../core/errors.js';
import { PROVIDER_TAVILY, PROVIDER_EXA } from '../core/constants.js';
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
    capacityFor: (id) => keyPool.entryById(id)?.rpm ?? 60,
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
  return { keyPool, rateLimiter, scheduler, adapters, anonymousExaLimiter };
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
    this._poolKey = null;
    this._usageCache = null;
    this._usageRefreshPromise = null;
    this._quotaExhaustedRefs = new Set();
  }

  /** 本地可用性检查：至少声明了一个 key（不发网络）。 */
  available() {
    return this.resolveOptions().available;
  }

  /** 配置快照变化时重建 pool，否则复用（保留冷却/令牌状态）。 */
  _getPool(options) {
    const key = JSON.stringify(options.entries)
      + '|' + JSON.stringify([
        options.strategy,
        options.providerPriority,
        options.allowedFails,
        options.cooldownMs,
        options.retryAfterFallbackMs,
      ]);
    if (this._poolCache != null && this._poolKey === key) return this._poolCache;
    this._poolCache = buildPool(options);
    this._poolKey = key;
    this._usageCache = null;
    return this._poolCache;
  }

  /**
   * 刷新所有 Tavily key 的额度快照并发布给设置页。
   * 只统计有凭据的 Tavily key；Exa 没有公开余额接口，不计入。
   * @param {object} options
   * @returns {Promise<object|null>}
   */
  async refreshUsage(options) {
    const entries = (options.entries ?? []).filter((entry) => entry.provider === PROVIDER_TAVILY && entry.credentialRef != null);
    if (entries.length === 0) {
      const emptySnapshot = { updatedAt: Date.now(), totalUsed: 0, totalLimit: 0, keys: [] };
      const pool = this._getPool(options);
      this._usageCache = { fetchedAt: Date.now(), byRef: new Map() };
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
      for (const entry of entries) {
        if (controller.signal.aborted === true) {
          errors.push('刷新超时（' + USAGE_REFRESH_TIMEOUT_MS / 1000 + ' 秒）');
          break;
        }
        try {
          const apiKey = await options.resolveKey(entry, controller.signal);
          if (apiKey == null) {
            errors.push(`${entry.credentialRef}: 未配置凭据`);
            continue;
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
            break;
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
      }
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
    const pool = this._getPool(options);
    this._usageCache = { fetchedAt: Date.now(), byRef };
    this._recoverQuota(options, pool);
    const diagnostic = errors.length > 0 ? 'Tavily 额度刷新部分失败: ' + errors.join('; ') : '';
    this._publishUsage(snapshot, diagnostic);
    return snapshot;
  }

  /**
   * 返回当前 usage 缓存；未过期直接复用，过期或为空时串行刷新一次。
   * 查询失败不阻断搜索，保留旧缓存或空缓存。
   */
  _ensureUsage(options) {
    if (this._usageCache != null && Date.now() - this._usageCache.fetchedAt < options.usageCacheMs) {
      return Promise.resolve(this._usageCache);
    }
    if (this._usageRefreshPromise != null) return this._usageRefreshPromise;
    this._usageRefreshPromise = this.refreshUsage(options)
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
   * 额度恢复后，在调度器选中 entry 前解除长冷却，否则 acquire 会一直跳过该 key。
   */
  _recoverQuota(options, pool) {
    if (this._quotaExhaustedRefs.size === 0 || this._usageCache == null) return;
    for (const ref of [...this._quotaExhaustedRefs]) {
      const usage = this._usageCache.byRef.get(ref);
      if (usage == null || usage.remaining == null || usage.remaining < options.quotaReserveCredits) continue;
      const entry = pool.keyPool.entries.find((candidate) => candidate.credentialRef === ref);
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

  async search(request, signal) {
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

    // 先刷新/复用 Tavily 额度缓存，供本轮的额度耗尽判断使用。
    if (pool.adapters[PROVIDER_TAVILY] != null) {
      await this._ensureUsage(options);
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

      const apiKey = await options.resolveKey(entry, signal);
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
        pool.scheduler.recordRateLimit(entry, 1_000);
        options.recordRequest?.({ provider: entry.provider, keyId: entry.id, ok: false, code: 'RATE_LIMIT', retryAfterMs: 1_000 });
        if (lastError == null || lastError.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') {
          lastError = new RateLimitError('Exa anonymous free layer allows 1 request per second', 1_000);
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

      try {
        const result = await adapter.search({
          query: request.query,
          apiKey,
          maxResults: request.maxResults,
          signal,
          ...(paramsByProvider[entry.provider] ?? {}),
        });
        pool.scheduler.recordSuccess(entry);
        options.recordRequest?.({ provider: entry.provider, keyId: entry.id, ok: true, code: 'OK' });
        return result;
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw error;
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
      }
    }

    if (lastError != null) throw lastError;
    throw new WebError('search-pool has no usable search key (all cooling or rate-limited)', 'WEB_PROVIDER_UNAVAILABLE');
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw new DOMException('search-pool search aborted', 'AbortError');
}
