/**
 * 核心调度库的错误类型。纯 JS、不依赖 DSH。
 * 错误带机器可路由的 `code`，DSH 封装层会把它转成 `WebError`（WEB_PROVIDER_ERROR）。
 * @module search-pool/core/errors
 */

/** 统一搜索池错误的基类。 */
export class SearchPoolError extends Error {
  /**
   * @param {string} message 人类可读信息。
   * @param {string} code 稳定的机器码。
   * @param {ErrorOptions} [options]
   */
  constructor(message, code, options) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * HTTP 429 限流错误。`retryAfterMs` 来自 `Retry-After` 头（有则用），
 * 否则回退到 `retryAfterFallbackMs`。
 */
export class RateLimitError extends SearchPoolError {
  /**
   * @param {string} message
   * @param {number} retryAfterMs 建议冷却时长（毫秒）。
   * @param {ErrorOptions} [options]
   */
  constructor(message, retryAfterMs, options) {
    super(message, 'RATE_LIMIT', options);
    this.retryAfterMs = retryAfterMs;
  }
}

/** 非 429 的上游 HTTP 错误（4xx/5xx 等）。 */
export class ProviderHttpError extends SearchPoolError {
  /**
   * @param {string} message
   * @param {number} status HTTP 状态码；网络失败时为 0。
   * @param {ErrorOptions} [options]
   */
  constructor(message, status, options) {
    super(message, 'PROVIDER_HTTP', options);
    this.status = status;
  }
}

/** 所有候选 key 均不可用（全部冷却或令牌耗尽），无可再试。 */
export class NoUsableKeyError extends SearchPoolError {
  constructor(message = 'no usable search key is available', options) {
    super(message, 'NO_USABLE_KEY', options);
  }
}

/** 判断一个错误是否为取消/中止错误（AbortError）。 */
export function isAbortError(error) {
  if (error == null) return false;
  return error.name === 'AbortError' || error.name === 'TimeoutError';
}
