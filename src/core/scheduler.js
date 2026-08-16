/**
 * Scheduler：核心调度器。
 * 候选 key = 未冷却 && 令牌可用的 key；在同一供应商内按策略选择，供应商间按优先级 failover。
 * 纯类、不依赖 DSH。
 * @module search-pool/core/scheduler
 */

import { PROVIDER_TAVILY, PROVIDER_EXA, STRATEGY_LEAST_USED } from './constants.js';

/**
 * @param {object} options
 * @param {import('./key-pool.js').KeyPool} options.keyPool key 池。
 * @param {{tryAcquire:Function, tokens:Function}} options.rateLimiter 限流器（鸭子类型）。
 * @param {string[]} [options.providerPriority] 供应商优先级，默认 ['tavily','exa']。
 * @param {string} [options.strategy] 'weighted-round-robin'（默认）| 'least-used'。
 * @param {() => number} [options.now] 时间源，测试注入用；默认 Date.now。
 */
export class Scheduler {
  constructor(options) {
    this.keyPool = options.keyPool;
    this.rateLimiter = options.rateLimiter;
    this.providerPriority = options.providerPriority ?? [PROVIDER_TAVILY, PROVIDER_EXA];
    this.strategy = options.strategy ?? 'weighted-round-robin';
    this._now = options.now ?? (() => Date.now());
    /** smooth weighted-round-robin 的当前权重累加器：entryId -> currentWeight。 */
    this._currentWeight = new Map();
  }

  now() {
    return this._now();
  }

  /**
   * 选一个可用 entry 并消费一个令牌；无可用返回 null。
   * 按 providerPriority 依次尝试供应商（failover）。
   * @returns {object|null}
   */
  acquire() {
    const now = this.now();
    for (const provider of this.providerPriority) {
      const entry = this._acquireFromProvider(provider, now);
      if (entry) return entry;
    }
    return null;
  }

  _acquireFromProvider(provider, now) {
    const entries = this.keyPool.entriesForProvider(provider);
    const candidates = entries.filter((e) => !this.keyPool.isCooling(e, now));
    if (candidates.length === 0) return null;

    if (this.strategy === STRATEGY_LEAST_USED) {
      // 剩余令牌最多的优先（即「最少使用」的 key 优先）。
      // 单遍选最大（相等取先出现者，与稳定降序排序语义一致），避免数组复制与排序分配。
      return this._acquireByRank(candidates, now, (id) => this.rateLimiter.tokens(id, now));
    }

    // weighted-round-robin：smooth WRR。
    // 每次给每个候选累加其权重（rpm），选 currentWeight 最大者；被选中（拿到令牌）后减去总权重。
    // 令牌不足的候选本轮不减 total，其 currentWeight 持续累积，令牌恢复后会被优先选中（平滑语义）。
    let total = 0;
    for (const e of candidates) {
      const weight = Math.max(1, e.rpm); // 下限 1：rpm 缺省/为 0 时仍保证公平参与轮转。
      this._currentWeight.set(e.id, (this._currentWeight.get(e.id) ?? 0) + weight);
      total += weight;
    }
    const entry = this._acquireByRank(candidates, now, (id) => this._currentWeight.get(id) ?? 0);
    if (entry != null) {
      this._currentWeight.set(entry.id, (this._currentWeight.get(entry.id) ?? 0) - total);
    }
    return entry;
  }

  /**
   * 按 `rankOf` 降序依次尝试 `tryAcquire`：单遍选出当前排名最高的候选，
   * 令牌不足则排除后重选。最坏 O(n²)（全部令牌耗尽时），常见路径首轮即命中。
   * @param {object[]} candidates 未冷却候选。
   * @param {number} now
   * @param {(id: string) => number} rankOf 排名值（越大越优先）。
   * @returns {object|null}
   */
  _acquireByRank(candidates, now, rankOf) {
    const excluded = new Set();
    while (excluded.size < candidates.length) {
      let best = null;
      let bestRank = -Infinity;
      for (const e of candidates) {
        if (excluded.has(e.id)) continue;
        const rank = rankOf(e.id);
        if (rank > bestRank) {
          bestRank = rank;
          best = e;
        }
      }
      if (best == null) return null;
      if (this.rateLimiter.tryAcquire(best.id, now)) return best;
      excluded.add(best.id);
    }
    return null;
  }

  /** 429 限流：进入冷却（Retry-After 覆盖默认冷却时长）。 */
  recordRateLimit(entry, retryAfterMs) {
    this.keyPool.markCooldown(entry, retryAfterMs, this.now());
  }

  /** 非限流失败：累加失败计数，达阈值自动熔断。 */
  recordError(entry) {
    this.keyPool.markFailure(entry, this.now());
  }

  /** 成功：清零失败计数。 */
  recordSuccess(entry) {
    this.keyPool.markSuccess(entry);
  }

  /** 手动解除冷却（额度刷新恢复后清除长冷却）。 */
  clearCooldown(entry) {
    this.keyPool.clearCooldown(entry);
  }
}
