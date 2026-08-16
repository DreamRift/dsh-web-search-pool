import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, rethrowIfAborted, discardBody, withTimeout } from '../src/core/http-utils.js';

function mockResponse({ headers = {} } = {}) {
  return { headers: { get: (k) => headers[k.toLowerCase()] ?? null } };
}

test('parseRetryAfter: 秒数直读', () => {
  assert.equal(parseRetryAfter(mockResponse({ headers: { 'retry-after': '5' } }), 1_500), 5_000);
  assert.equal(parseRetryAfter(mockResponse({ headers: { 'retry-after': '0' } }), 1_500), 0);
});

test('parseRetryAfter: HTTP 日期格式换算为剩余毫秒', () => {
  const future = new Date(Date.now() + 60_000).toUTCString();
  const ms = parseRetryAfter(mockResponse({ headers: { 'retry-after': future } }), 1_500);
  assert.ok(ms >= 59_000 && ms <= 60_000, `应接近 60000，实际 ${ms}`);
});

test('parseRetryAfter: 无头/非法值回退默认', () => {
  assert.equal(parseRetryAfter(mockResponse({}), 1_500), 1_500);
  assert.equal(parseRetryAfter(mockResponse({ headers: { 'retry-after': '' } }), 2_000), 2_000);
  assert.equal(parseRetryAfter(mockResponse({ headers: { 'retry-after': 'not-a-date' } }), 2_500), 2_500);
  assert.equal(parseRetryAfter(null, 3_000), 3_000);
});

test('rethrowIfAborted: 外部 signal 已 abort 时原样重抛', () => {
  const controller = new AbortController();
  controller.abort();
  const error = new Error('boom');
  assert.throws(() => rethrowIfAborted(error, controller.signal), /boom/);
});

test('rethrowIfAborted: AbortError 一律重抛（即使 signal 未 abort）', () => {
  const abortError = new DOMException('aborted', 'AbortError');
  assert.throws(() => rethrowIfAborted(abortError, undefined), (e) => e === abortError);
});

test('rethrowIfAborted: 普通错误且未 abort 时不抛出', () => {
  rethrowIfAborted(new Error('normal'), undefined);
  rethrowIfAborted(new Error('normal'), new AbortController().signal);
});

test('discardBody: 有 body.cancel 时调用并 await', async () => {
  let cancelled = false;
  await discardBody({ body: { cancel: async () => { cancelled = true; } } });
  assert.equal(cancelled, true);
});

test('discardBody: 无 body 时回退 text()，都没有则静默', async () => {
  let read = false;
  await discardBody({ text: async () => { read = true; return 'x'; } });
  assert.equal(read, true);
  await discardBody({});
  await discardBody({ body: { cancel: async () => { throw new Error('cancel failed'); } } });
});

test('withTimeout: 超时触发后 signal abort 且 timedOut 为 true', async () => {
  const guard = withTimeout(undefined, 30);
  assert.equal(guard.signal.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(guard.signal.aborted, true);
  assert.equal(guard.timedOut(), true);
  guard.cleanup();
});

test('withTimeout: 外部 abort 转发且 timedOut 保持 false', async () => {
  const controller = new AbortController();
  const guard = withTimeout(controller.signal, 10_000);
  controller.abort();
  assert.equal(guard.signal.aborted, true);
  assert.equal(guard.timedOut(), false);
  guard.cleanup();
});

test('withTimeout: cleanup 后定时器不再触发', async () => {
  const guard = withTimeout(undefined, 20);
  guard.cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(guard.signal.aborted, false);
  assert.equal(guard.timedOut(), false);
});

test('withTimeout: timeoutMs <= 0 表示不启用超时', async () => {
  const guard = withTimeout(undefined, 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(guard.signal.aborted, false);
  assert.equal(guard.timedOut(), false);
  guard.cleanup();
});

test('withTimeout: 外部 signal 已 abort 时构造即生效', () => {
  const controller = new AbortController();
  controller.abort();
  const guard = withTimeout(controller.signal, 10_000);
  assert.equal(guard.signal.aborted, true);
  guard.cleanup();
});
