/**
 * 适配器共享的 HTTP 工具：Retry-After 解析、abort 判定重抛、错误响应体清理、
 * 外部 signal 与超时的组合。纯函数、不依赖 DSH；Node 18 兼容（不用 AbortSignal.any）。
 * @module search-pool/core/http-utils
 */

import { isAbortError } from './errors.js';

/**
 * 解析 Retry-After 响应头：优先秒数，其次 HTTP 日期；都不行回退默认值。
 * @param {Response} response
 * @param {number} fallbackMs 回退冷却时长（毫秒）。
 * @returns {number}
 */
export function parseRetryAfter(response, fallbackMs) {
  const header = response?.headers?.get?.('retry-after');
  if (header != null && header.length > 0) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return fallbackMs;
}

/**
 * 若错误是外部取消/中止（或外部 signal 已 abort）则原样重抛；否则返回，交由调用方包装。
 * 替代适配器里重复出现的 `if (isAbortError(error) || signal?.aborted === true) throw error`。
 * @param {unknown} error
 * @param {AbortSignal} [signal]
 */
export function rethrowIfAborted(error, signal) {
  if (signal?.aborted === true || isAbortError(error)) throw error;
}

/**
 * 防御式消费/取消错误响应体（429/非 OK 分支），避免 undici 连接复用下响应体积压。
 * 任何失败静默忽略（单测的 mock Response 可能没有 body.cancel）。
 * @param {Response} [response]
 */
export async function discardBody(response) {
  try {
    if (typeof response?.body?.cancel === 'function') await response.body.cancel();
    else if (typeof response?.text === 'function') await response.text();
  } catch {
    // 清理失败不影响错误处理主流程。
  }
}

/**
 * 把外部 signal 与超时组合成一个内部 signal：任一触发都会 abort 内部 signal。
 * Node 18 没有 `AbortSignal.any`，这里手写转发。
 * @param {AbortSignal} [external] 调用方（DSH web 层）传入的取消信号，可为空。
 * @param {number} [timeoutMs] 超时毫秒数；<= 0 或缺省表示不启用超时。
 * @returns {{ signal: AbortSignal, timedOut: () => boolean, cleanup: () => void }}
 *   - `signal`：传给下游请求；外部取消与内部超时都会触发它。
 *   - `timedOut()`：区分「内部超时」与「外部取消」——只有内部定时器触发过才为 true。
 *   - `cleanup()`：请求结束后清理定时器与外部监听，防止泄漏；必须在 finally 中调用。
 */
export function withTimeout(external, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const forward = () => controller.abort(external?.reason);
  if (external != null) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', forward, { once: true });
  }
  if (timeoutMs != null && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      if (timer != null) clearTimeout(timer);
      if (external != null) external.removeEventListener('abort', forward);
    },
  };
}
