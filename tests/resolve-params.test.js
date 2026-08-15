import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTavilyParams, resolveExaParams } from '../src/core/resolve-params.js';
import { parseQueryIntent } from '../src/core/query-intent.js';

test('resolveTavilyParams: 缺省打开 advanced + answer', () => {
  const params = resolveTavilyParams({}, {});
  assert.equal(params.searchDepth, 'advanced');
  assert.equal(params.includeAnswer, true);
  assert.equal(params.includeRawContent, false);
});

test('resolveTavilyParams: auto topic/timeRange 结合 query 意图', () => {
  const intent = parseQueryIntent('本周股市行情');
  const params = resolveTavilyParams({ topic: 'auto', timeRange: 'auto' }, intent);
  assert.equal(params.topic, 'finance');
  assert.equal(params.timeRange, 'week');
});

test('resolveTavilyParams: auto 域名结合 site: 语法', () => {
  const intent = parseQueryIntent('react 教程 site:react.dev');
  const params = resolveTavilyParams({ includeDomains: 'auto' }, intent);
  assert.deepEqual(params.includeDomains, ['react.dev']);
});

test('resolveTavilyParams: 显式配置覆盖 auto', () => {
  const intent = parseQueryIntent('本周新闻');
  const params = resolveTavilyParams({ topic: 'finance', timeRange: 'month', includeDomains: ['a.com'] }, intent);
  assert.equal(params.topic, 'finance'); // 显式值优先
  assert.equal(params.timeRange, 'month');
  assert.deepEqual(params.includeDomains, ['a.com']);
});

test('resolveTavilyParams: off 禁用日期过滤（同时禁用 days）', () => {
  const intent = parseQueryIntent('最近3天新闻');
  const params = resolveTavilyParams({ timeRange: 'off' }, intent);
  assert.equal(params.timeRange, undefined);
  assert.equal(params.days, undefined);
});

test('resolveExaParams: 缺省打开 useAutoprompt 与深度提取', () => {
  const params = resolveExaParams({}, {});
  assert.equal(params.useAutoprompt, true);
  assert.deepEqual(params.contents, { text: true, highlights: true, summary: true });
});

test('resolveExaParams: highlights/summary 可关闭', () => {
  const params = resolveExaParams({ highlights: false, summary: false }, {});
  assert.deepEqual(params.contents, { text: true });
});

test('resolveExaParams: startPublishedDate 由意图 days 推导', () => {
  const intent = parseQueryIntent('最近7天的 AI');
  const now = new Date('2026-03-10T00:00:00Z');
  const params = resolveExaParams({ startPublishedDate: 'auto' }, intent, now);
  assert.equal(params.startPublishedDate, '2026-03-03'); // 2026-03-10 - 7 天
});

test('resolveExaParams: startPublishedDate off 禁用', () => {
  const intent = parseQueryIntent('本周新闻');
  const params = resolveExaParams({ startPublishedDate: 'off' }, intent);
  assert.equal(params.startPublishedDate, undefined);
});

test('resolveExaParams: 显式 startPublishedDate 透传', () => {
  const params = resolveExaParams({ startPublishedDate: '2025-01-01' }, {});
  assert.equal(params.startPublishedDate, '2025-01-01');
});
