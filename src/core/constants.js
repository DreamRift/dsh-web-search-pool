/**
 * 核心调度库的共享常量。纯数据、不依赖 DSH，可独立单测。
 * @module search-pool/core/constants
 */

/** 供应商标识。 */
export const PROVIDER_TAVILY = 'tavily';
export const PROVIDER_EXA = 'exa';

/** 调度策略。 */
export const STRATEGY_WEIGHTED_ROUND_ROBIN = 'weighted-round-robin';
export const STRATEGY_LEAST_USED = 'least-used';

/** 默认配置值（与 DSH 层的 config schema 默认值保持一致）。 */
export const DEFAULTS = {
  strategy: STRATEGY_WEIGHTED_ROUND_ROBIN,
  providerPriority: [PROVIDER_TAVILY, PROVIDER_EXA],
  allowedFails: 3,
  cooldownMs: 30_000,
  retryAfterFallbackMs: 1_000,
};

/**
 * 归一化搜索请求（与 DSH `WebSearchRequest` 同构，但核心库独立定义以避免依赖）。
 * @typedef {Object} SearchRequest
 * @property {string} query 搜索词。
 * @property {number} [maxResults] 返回结果上限。
 */

/**
 * 归一化搜索来源（与 DSH `WebSearchSource` 同构）。
 * @typedef {Object} SearchSource
 * @property {string} url 可引用的 URL。
 * @property {string} [title] 标题。
 * @property {string} [snippet] 摘要。
 * @property {string} [publishedAt] 发布/抓取时间（ISO-8601 字符串）。
 */

/**
 * 归一化搜索结果（与 DSH `WebSearchResult` 同构）。
 * @typedef {Object} SearchResult
 * @property {string} [content] provider 生成的答案/摘要文本。
 * @property {SearchSource[]} sources 可引用来源。
 * @property {boolean} truncated 是否被截断。
 */

/**
 * 一个搜索 key 的静态描述。
 * @typedef {Object} KeySpec
 * @property {string} id 稳定唯一标识。
 * @property {string} provider 所属供应商（tavily | exa）。
 * @property {string} credentialRef 凭据引用（环境变量名，密钥明文不在此处）。
 * @property {number} rpm 每分钟请求上限（限流值）。
 */
