/**
 * RateLimiter：每 key 一个令牌桶（token bucket，capacity=rpm，refill=rpm/60s）。
 * 存储后端抽象为 `{ get, set }`：当前提供内存实现；未来 Redis 实现（Lua 原子化）只需
 * 实现同一 `{ get, set }` 面，或另建实现同一 `tryAcquire/tokens` 接口的限流器。
 * 纯类、不依赖 DSH。
 * @module search-pool/core/rate-limiter
 */

/**
 * 内存后端：单实例场景足够；进程重启即清零（符合开发计划「内存限流」决策）。
 * 状态值 `{ tokens, lastRefill }` 是可序列化数据，未来可直接映射到 Redis key/TTL。
 */
export class MemoryStore {
  constructor() {
    this._map = new Map();
  }

  get(key) {
    return this._map.get(key);
  }

  set(key, value) {
    this._map.set(key, value);
  }
}

/**
 * 令牌桶限流器。每个 key 的容量（capacity）由其 rpm 决定，通过 `capacityFor(keyId)` 回调取得。
 */
export class TokenBucketLimiter {
  /**
   * @param {{ store?: {get:Function, set:Function}, capacityFor?: (keyId: string) => number, capacity?: number, refillPerSec?: number, refillPerSecFor?: (keyId: string) => number }} options
   *   - store：状态后端，默认 `MemoryStore`。
   *   - capacityFor：返回指定 key 的 rpm（每分钟上限）。缺省时所有 key 用 `capacity`（默认 60）。
   *   - refillPerSec：覆盖补充速率（每秒令牌数）。缺省按 `capacityFor/60` 推导（rpm 语义）。
   *   - refillPerSecFor：按 key 覆盖补充速率；优先于 `refillPerSec`。
   */
  constructor(options = {}) {
    this.store = options.store ?? new MemoryStore();
    this.capacityFor = options.capacityFor ?? (() => options.capacity ?? 60);
    if (options.refillPerSecFor != null) {
      this.refillPerSecFor = options.refillPerSecFor;
    } else if (options.refillPerSec != null) {
      this.refillPerSecFor = () => options.refillPerSec;
    } else {
      this.refillPerSecFor = (key) => this.capacityFor(key) / 60;
    }
  }

  /** 读取并推进某 key 的桶状态到 `now`。 */
  _state(key, now) {
    const capacity = this.capacityFor(key);
    const raw = this.store.get(key);
    const state = raw ?? { tokens: capacity, lastRefill: now };
    if (state.lastRefill == null) state.lastRefill = now;
    const refillPerSec = this.refillPerSecFor(key);
    const elapsedSec = Math.max(0, (now - state.lastRefill) / 1000);
    state.tokens = Math.min(capacity, state.tokens + elapsedSec * refillPerSec);
    state.lastRefill = now;
    return state;
  }

  /**
   * 尝试消费一个令牌。成功返回 true，并持久化扣减后的状态。
   * @param {string} key
   * @param {number} now
   * @returns {boolean}
   */
  tryAcquire(key, now) {
    const state = this._state(key, now);
    if (state.tokens >= 1) {
      state.tokens -= 1;
      this.store.set(key, state);
      return true;
    }
    this.store.set(key, state);
    return false;
  }

  /** 返回某 key 当前剩余令牌数（用于 least-used 策略）。 */
  tokens(key, now) {
    return this._state(key, now).tokens;
  }

  /** 重置某 key 的桶（测试/运维用）。 */
  reset(key) {
    this.store.set(key, { tokens: this.capacityFor(key), lastRefill: Date.now() });
  }
}
