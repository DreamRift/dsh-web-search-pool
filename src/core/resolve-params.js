/**
 * 高级参数解析：把配置里的 'auto'/'off' 结合 query 意图落成各供应商的最终请求参数。
 * 纯函数、不依赖 DSH，可独立单测。
 * @module search-pool/core/resolve-params
 */

/**
 * 解析 Tavily 高级参数：把配置里的 'auto'/'off' 结合 query 意图落成最终参数。
 * @param {object} params 原始配置（含 'auto'/'off' 标记）。
 * @param {object} intent parseQueryIntent 的结果。
 */
export function resolveTavilyParams(params, intent) {
  const timeRange = resolveChoice(params.timeRange, intent.timeRange, undefined);
  const timeFilterDisabled = params.timeRange === 'off';
  return {
    searchDepth: params.searchDepth ?? 'advanced',
    includeAnswer: params.includeAnswer ?? true,
    includeRawContent: params.includeRawContent ?? false,
    topic: resolveChoice(params.topic, intent.topic, 'general'),
    timeRange,
    days: timeRange != null || timeFilterDisabled ? undefined : intent.days,
    includeDomains: resolveDomains(params.includeDomains, intent.domains),
    excludeDomains: params.excludeDomains ?? [],
  };
}

/**
 * 解析 Exa 高级参数：把配置里的 'auto'/'off' 结合 query 意图落成最终参数。
 * @param {object} params 原始配置（含 'auto'/'off' 标记）。
 * @param {object} intent parseQueryIntent 的结果。
 * @param {Date} [now] 计算 startPublishedDate 的基准时间。
 */
export function resolveExaParams(params, intent, now = new Date()) {
  return {
    type: params.type ?? 'auto',
    useAutoprompt: params.useAutoprompt ?? true,
    contents: {
      text: true,
      ...(params.highlights !== false ? { highlights: true } : {}),
      ...(params.summary !== false ? { summary: true } : {}),
    },
    includeDomains: resolveDomains(params.includeDomains, intent.domains),
    excludeDomains: params.excludeDomains ?? [],
    startPublishedDate: resolveDate(params.startPublishedDate, intent, now),
  };
}

/** 三态选择：'off' → 禁用；'auto'/缺省 → 意图值或回退；其它 → 显式值。 */
function resolveChoice(config, intentValue, fallback) {
  if (config === 'off') return undefined;
  if (config === 'auto' || config == null) return intentValue ?? fallback;
  return config;
}

/** 域名三态：'off' → 禁用；'auto'/缺省 → 意图域名；数组 → 显式域名。 */
function resolveDomains(config, intentDomains) {
  if (config === 'off') return undefined;
  if (config === 'auto' || config == null) {
    return intentDomains != null && intentDomains.length > 0 ? intentDomains : undefined;
  }
  return Array.isArray(config) && config.length > 0 ? config : undefined;
}

/** Exa 日期：'off' → 禁用；'auto'/缺省 → 由意图的 days/timeRange 推导；其它 → 显式日期。 */
function resolveDate(config, intent, now) {
  if (config === 'off') return undefined;
  if (config === 'auto' || config == null) {
    const days = intent.days ?? timeRangeToDays(intent.timeRange);
    if (days == null) return undefined;
    return formatDate(new Date(now.getTime() - days * 86_400_000));
  }
  return config;
}

function timeRangeToDays(timeRange) {
  switch (timeRange) {
    case 'day': return 1;
    case 'week': return 7;
    case 'month': return 30;
    case 'year': return 365;
    default: return undefined;
  }
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
