import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryIntent } from '../src/core/query-intent.js';

test('query-intent: 中文时间范围词', () => {
  assert.equal(parseQueryIntent('今天有什么新闻').timeRange, 'day');
  assert.equal(parseQueryIntent('本周 AI 进展').timeRange, 'week');
  assert.equal(parseQueryIntent('这个月的大事件').timeRange, 'month');
  assert.equal(parseQueryIntent('今年科技趋势').timeRange, 'year');
});

test('query-intent: 英文时间范围词', () => {
  assert.equal(parseQueryIntent('AI news this week').timeRange, 'week');
  assert.equal(parseQueryIntent('trends this year').timeRange, 'year');
});

test('query-intent: 最近 N 天 → days', () => {
  assert.equal(parseQueryIntent('最近3天的新闻').days, 3);
  assert.equal(parseQueryIntent('last 7 days crypto').days, 7);
});

test('query-intent: site: 语法 → 域名', () => {
  const intent = parseQueryIntent('react 教程 site:react.dev');
  assert.deepEqual(intent.domains, ['react.dev']);
});

test('query-intent: https:// 前缀 → 域名', () => {
  const intent = parseQueryIntent('看下 https://github.com/deepseek-ai 的介绍');
  assert.deepEqual(intent.domains, ['github.com']);
});

test('query-intent: 主题词 → news / finance', () => {
  assert.equal(parseQueryIntent('今天的头条新闻').topic, 'news');
  assert.equal(parseQueryIntent('英伟达股价走势').topic, 'finance');
});

test('query-intent: 无信号时返回空对象', () => {
  assert.deepEqual(parseQueryIntent('如何学习 Rust'), {});
});
