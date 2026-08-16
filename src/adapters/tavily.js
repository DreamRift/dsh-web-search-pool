/**
 * Tavily 搜索适配器。统一接口 `search({ query, apiKey, maxResults, signal, ...高级参数 }) => SearchResult`。
 * 不依赖 DSH，只依赖核心库错误类型与共享 HTTP 工具（宿主 fetch 可注入以便单测）。
 *
 * 高级功能（默认打开，对齐官方文档与 agent 友好组合）：
 *   - `search_depth: advanced`（深度提取）
 *   - `include_answer: true`（总结答案 → result.content）
 * 依赖 query 的参数由 provider 解析「auto」后传入：`topic` / `time_range` / `days` / `include_domains`。
 * 字段映射：results[].url/title/content/published_date → WebSearchSource；answer → content。
 * 429 → RateLimitError（解析 Retry-After）。
 * @module search-pool/adapters/tavily
 */

import { RateLimitError, ProviderHttpError } from '../core/errors.js';
import { parseRetryAfter, rethrowIfAborted, discardBody } from '../core/http-utils.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const TAVILY_USAGE_ENDPOINT = 'https://api.tavily.com/usage';
const USER_AGENT = 'dsh-web-search-pool/0.2.0';

export class TavilyAdapter {
  /**
   * @param {{ endpoint?: string, usageEndpoint?: string, fetchImpl?: Function, retryAfterFallbackMs?: number }} [options]
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint ?? TAVILY_ENDPOINT;
    this.usageEndpoint = options.usageEndpoint ?? TAVILY_USAGE_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.retryAfterFallbackMs = options.retryAfterFallbackMs ?? 1_000;
  }

  /**
   * 查询当前 key 的账号用量与剩余额度（Tavily `GET /usage`）。
   * @param {string} apiKey
   * @param {AbortSignal} [signal]
   * @returns {Promise<{plan:string, used:number, limit:number|null, remaining:number|null}>}
   */
  async getUsage(apiKey, signal) {
    let response;
    try {
      response = await this.fetchImpl(this.usageEndpoint, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Tavily usage request failed: ${String(error)}`, 0, { cause: error });
    }

    if (response.status === 429) {
      await discardBody(response);
      throw new RateLimitError('Tavily usage rate limited (HTTP 429)', parseRetryAfter(response, this.retryAfterFallbackMs));
    }
    if (!response.ok) {
      await discardBody(response);
      throw new ProviderHttpError(`Tavily usage error (HTTP ${response.status})`, response.status);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Tavily returned an unprocessable usage body: ${String(error)}`, response.status, { cause: error });
    }
    const account = data.account ?? {};
    const limit = typeof account.plan_limit === 'number' && Number.isFinite(account.plan_limit) ? account.plan_limit : null;
    const used = typeof account.plan_usage === 'number' && Number.isFinite(account.plan_usage) ? account.plan_usage : 0;
    return {
      plan: typeof account.current_plan === 'string' ? account.current_plan : '',
      used,
      limit,
      remaining: limit != null ? Math.max(0, limit - used) : null,
    };
  }

  /**
   * @param {object} input
   * @param {string} input.query
   * @param {string} input.apiKey
   * @param {number} [input.maxResults]
   * @param {AbortSignal} [input.signal]
   * @param {string} [input.searchDepth] 'basic' | 'advanced'，默认 'advanced'
   * @param {boolean} [input.includeAnswer] 默认 true
   * @param {boolean} [input.includeRawContent] 默认 false
   * @param {string} [input.topic] general | news | finance
   * @param {string} [input.timeRange] day | week | month | year（优先于 days）
   * @param {number} [input.days] 最近 N 天
   * @param {string[]} [input.includeDomains]
   * @param {string[]} [input.excludeDomains]
   * @returns {Promise<import('../core/constants.js').SearchResult>}
   */
  async search(input) {
    const { query, apiKey, maxResults, signal } = input;
    const body = {
      api_key: apiKey,
      query,
      search_depth: input.searchDepth ?? 'advanced',
      include_answer: input.includeAnswer ?? true,
      ...(input.includeRawContent === true ? { include_raw_content: true } : {}),
      ...(input.topic != null && input.topic !== 'general' ? { topic: input.topic } : {}),
      ...(input.timeRange != null
        ? { time_range: input.timeRange }
        : input.days != null ? { days: input.days } : {}),
      ...(input.includeDomains != null && input.includeDomains.length > 0 ? { include_domains: input.includeDomains } : {}),
      ...(input.excludeDomains != null && input.excludeDomains.length > 0 ? { exclude_domains: input.excludeDomains } : {}),
      ...(maxResults != null ? { max_results: maxResults } : {}),
    };

    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Tavily request failed: ${String(error)}`, 0, { cause: error });
    }

    if (response.status === 429) {
      await discardBody(response);
      throw new RateLimitError('Tavily rate limited (HTTP 429)', parseRetryAfter(response, this.retryAfterFallbackMs));
    }
    if (!response.ok) {
      await discardBody(response);
      throw new ProviderHttpError(`Tavily API error (HTTP ${response.status})`, response.status);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Tavily returned an unprocessable body: ${String(error)}`, response.status, { cause: error });
    }
    return this._map(data);
  }

  _map(data) {
    const results = Array.isArray(data.results) ? data.results : [];
    const sources = results.map((r) => {
      const source = { url: String(r.url ?? '') };
      if (r.title != null && String(r.title).length > 0) source.title = String(r.title);
      if (r.content != null && String(r.content).length > 0) source.snippet = String(r.content);
      if (r.published_date != null && String(r.published_date).length > 0) source.publishedAt = String(r.published_date);
      return source;
    }).filter((s) => s.url.length > 0);

    const answer = data.answer != null && String(data.answer).length > 0 ? String(data.answer) : undefined;
    return {
      sources,
      truncated: false,
      ...(answer !== undefined ? { content: answer } : {}),
    };
  }
}
