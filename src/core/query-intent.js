/**
 * query 意图解析：从自然语言 query 提取日期/域名/主题等信号，
 * 用于高级功能的「auto（AI 可选）」模式。纯函数、不依赖 DSH，可独立单测。
 * @module search-pool/core/query-intent
 */

/**
 * 解析 query 意图，返回可能存在的语义信号（缺省字段 = 未命中）。
 * @param {string} query
 * @returns {{ days?: number, timeRange?: string, domains?: string[], topic?: string }}
 */
export function parseQueryIntent(query) {
  const q = String(query ?? '');
  const lower = q.toLowerCase();
  const intent = {};

  const days = matchDays(lower);
  if (days != null) intent.days = days;

  const timeRange = matchTimeRange(lower);
  if (timeRange != null) intent.timeRange = timeRange;

  const domains = matchDomains(q);
  if (domains.length > 0) intent.domains = domains;

  const topic = matchTopic(lower);
  if (topic != null) intent.topic = topic;

  return intent;
}

/** 时间范围词 → Tavily `time_range` 枚举（day/week/month/year）。中文不加 `\b`（对中文无效），英文保留。 */
const TIME_RANGE_RULES = [
  [/今天|今日|\btoday\b/, 'day'],
  [/本周|这周|最近一周|近一周|\bthis week\b/, 'week'],
  [/上周|\blast week\b/, 'week'],
  [/本月|这个月|最近一个月|近一个月|\bthis month\b/, 'month'],
  [/上月|\blast month\b/, 'month'],
  [/今年|最近一年|近一年|\bthis year\b/, 'year'],
  [/去年|\blast year\b/, 'year'],
];

function matchTimeRange(lower) {
  for (const [re, value] of TIME_RANGE_RULES) {
    if (re.test(lower)) return value;
  }
  return null;
}

/** 「最近 N 天 / last N days / N 天」→ 天数。 */
const DAYS_RULES = [
  [/最近\s*(\d+)\s*天/, 1],
  [/近\s*(\d+)\s*天/, 1],
  [/(\d+)\s*天(?:内|以来)/, 1],
  [/\blast\s+(\d+)\s+days?\b/, 1],
  [/\bpast\s+(\d+)\s+days?\b/, 1],
  [/\b(\d+)\s+days?\b/, 1],
];

function matchDays(lower) {
  for (const [re, group] of DAYS_RULES) {
    const m = re.exec(lower);
    if (m != null) return Number(m[group]);
  }
  return null;
}

/** `site:example.com` 或明确的 `https://…` 前缀 → 域名列表。 */
function matchDomains(q) {
  const domains = [];
  const siteRe = /site\s*[:：]\s*([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,})/g;
  let m;
  while ((m = siteRe.exec(q)) != null) domains.push(m[1]);
  const urlRe = /https?:\/\/([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,})/g;
  while ((m = urlRe.exec(q)) != null) domains.push(m[1]);
  return [...new Set(domains)];
}

/** 主题词 → Tavily `topic`（news / finance）。财经词更具体，优先判断。 */
function matchTopic(lower) {
  if (/股票|财经|金融|股价|股市|行情|证券|基金|\bstocks?\b|\bfinance\b|\bipo\b/.test(lower)) return 'finance';
  if (/新闻|资讯|头条|\bnews\b|\bheadlines?\b/.test(lower)) return 'news';
  return null;
}
