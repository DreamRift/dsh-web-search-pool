/**
 * KeyPool：管理一批搜索 key 的运行时状态（冷却、连续失败计数）。
 * 只持有凭据引用（credentialRef），不持有密钥明文。
 * 构造时建立 id / credentialRef / provider 三组索引，查找均为 O(1)。
 * 纯类、不依赖 DSH。
 * @module search-pool/core/key-pool
 */

/**
 * @param {import('./constants.js').KeySpec[]} entries key 静态描述数组。
 * @param {{ allowedFails?: number, cooldownMs?: number }} [options]
 *   - allowedFails：连续失败多少次后熔断（进入冷却）。默认 3。
 *   - cooldownMs：默认冷却时长（毫秒），429 的 Retry-After 会覆盖它（取较大者）。默认 30000。
 */
export class KeyPool {
  constructor(entries, options = {}) {
    this.allowedFails = options.allowedFails ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.entries = entries.map((e) => ({
      id: e.id,
      provider: e.provider,
      credentialRef: e.credentialRef,
      rpm: e.rpm,
      // ── 运行时状态（进程内，可序列化，未来可映射到 Redis） ──
      cooldownUntil: 0,
      failCount: 0,
    }));
    /** @type {Map<string, object>} */
    this._byId = new Map();
    /** @type {Map<string, object>} */
    this._byRef = new Map();
    /** @type {Map<string, object[]>} */
    this._byProvider = new Map();
    for (const entry of this.entries) {
      this._byId.set(entry.id, entry);
      if (entry.credentialRef != null) this._byRef.set(entry.credentialRef, entry);
      const group = this._byProvider.get(entry.provider);
      if (group == null) this._byProvider.set(entry.provider, [entry]);
      else group.push(entry);
    }
  }

  /** key 总数（provider 用它计算单次搜索的重试上限）。 */
  get totalKeys() {
    return this.entries.length;
  }

  /** 按 id 取 entry（不存在返回 undefined）。 */
  entryById(id) {
    return this._byId.get(id);
  }

  /** 按凭据引用取 entry（不存在或 ref 为空返回 undefined）。 */
  entryByRef(ref) {
    return ref == null ? undefined : this._byRef.get(ref);
  }

  /**
   * 某供应商的所有 entry。返回内部数组引用（调用方只读，不要修改），
   * 调度器每次 acquire 都会取用，避免重复 filter。
   */
  entriesForProvider(provider) {
    return this._byProvider.get(provider) ?? [];
  }

  /** 该 entry 是否正在冷却（不可用）。 */
  isCooling(entry, now) {
    return now < entry.cooldownUntil;
  }

  /**
   * 进入冷却。冷却时长 = max(cooldownMs, retryAfterMs)。
   * @param {object} entry
   * @param {number} retryAfterMs 429 的 Retry-After（毫秒），可为 0。
   * @param {number} now 当前时间戳（毫秒）。
   */
  markCooldown(entry, retryAfterMs, now) {
    const duration = Math.max(this.cooldownMs, retryAfterMs ?? 0);
    entry.cooldownUntil = now + duration;
  }

  /**
   * 记录一次非限流失败。连续失败达到 allowedFails 时熔断（进入默认冷却）并清零计数，
   * 冷却恢复后重新计数（半开状态）。
   * @param {object} entry
   * @param {number} now
   */
  markFailure(entry, now) {
    entry.failCount += 1;
    if (entry.failCount >= this.allowedFails) {
      this.markCooldown(entry, 0, now);
      entry.failCount = 0;
    }
  }

  /** 成功：清零失败计数（冷却状态由时间自然到期，不在此处干预）。 */
  markSuccess(entry) {
    entry.failCount = 0;
  }

  /** 手动解除冷却（额度刷新恢复后清除长冷却）。 */
  clearCooldown(entry) {
    entry.cooldownUntil = 0;
  }
}
