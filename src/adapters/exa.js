/**
 * Exa 搜索适配器。统一接口 `search({ query, apiKey, maxResults, signal, ...高级参数 }) => SearchResult`。
 * 不依赖 DSH，只依赖核心库错误类型与共享 HTTP 工具（宿主 fetch 可注入以便单测）。
 *
 * 两种模式：
 *   - 有 API key：走官方 REST `https://api.exa.ai/search`，支持高级功能
 *     （useAutoprompt / contents / includeDomains / startPublishedDate）。
 *   - 无 API key：走官方托管 MCP `https://mcp.exa.ai/mcp` 的匿名免费层，
 *     调用默认工具 `web_search_exa`（无需注册，免费但有 rate limit）。
 *
 * 高级功能（默认打开）：
 *   - `useAutoprompt: true`（Exa 自动优化 query）
 *   - `contents: { text: true, highlights: true, summary: true }`（深度提取）
 * 依赖 query 的参数由 provider 解析「auto」后传入：`includeDomains` / `startPublishedDate`。
 * 匿名 MCP 的 `web_search_exa` 只接收 `query` / `numResults`，高级参数忽略。
 * 字段映射：results[].url/title/text|summary|highlights/publishedDate → WebSearchSource；Exa 无答案。
 * 429 / MCP rate limit → RateLimitError（解析 Retry-After）。
 * @module search-pool/adapters/exa
 */

import { RateLimitError, ProviderHttpError } from '../core/errors.js';
import { parseRetryAfter, rethrowIfAborted, discardBody } from '../core/http-utils.js';

const EXA_ENDPOINT = 'https://api.exa.ai/search';
const EXA_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const USER_AGENT = 'dsh-web-search-pool/0.2.0';

export class ExaAdapter {
  /**
   * @param {{ endpoint?: string, mcpEndpoint?: string, fetchImpl?: Function, retryAfterFallbackMs?: number }} [options]
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint ?? EXA_ENDPOINT;
    this.mcpEndpoint = options.mcpEndpoint ?? EXA_MCP_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.retryAfterFallbackMs = options.retryAfterFallbackMs ?? 1_000;
    /** JSON-RPC 请求 id 自增序号（并发匿名搜索也各自唯一）。 */
    this._nextRpcId = 0;
  }

  /** 无 key 时可走 Exa 官方托管 MCP 的匿名免费层。 */
  get supportsAnonymous() {
    return true;
  }

  /**
   * @param {object} input
   * @param {string} input.query
   * @param {string} [input.apiKey]
   * @param {number} [input.maxResults]
   * @param {AbortSignal} [input.signal]
   * @param {string} [input.type] auto | neural | keyword，默认 'auto'（Exa 语义）
   * @param {boolean} [input.useAutoprompt] 默认 true
   * @param {object} [input.contents] 默认 { text: true, highlights: true, summary: true }
   * @param {string[]} [input.includeDomains]
   * @param {string[]} [input.excludeDomains]
   * @param {string} [input.startPublishedDate] YYYY-MM-DD
   * @param {string} [input.endPublishedDate] YYYY-MM-DD
   * @returns {Promise<import('../core/constants.js').SearchResult>}
   */
  async search(input) {
    if (input.apiKey == null || String(input.apiKey).length === 0) {
      return this._searchAnonymous(input);
    }
    return this._searchRest(input);
  }

  async _searchRest(input) {
    const { query, apiKey, maxResults, signal } = input;
    const body = {
      query,
      type: input.type ?? 'auto',
      ...(maxResults != null ? { numResults: maxResults } : {}),
      useAutoprompt: input.useAutoprompt ?? true,
      contents: input.contents ?? { text: true, highlights: true, summary: true },
      ...(input.includeDomains != null && input.includeDomains.length > 0 ? { includeDomains: input.includeDomains } : {}),
      ...(input.excludeDomains != null && input.excludeDomains.length > 0 ? { excludeDomains: input.excludeDomains } : {}),
      ...(input.startPublishedDate != null ? { startPublishedDate: input.startPublishedDate } : {}),
      ...(input.endPublishedDate != null ? { endPublishedDate: input.endPublishedDate } : {}),
    };

    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'x-api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Exa request failed: ${String(error)}`, 0, { cause: error });
    }

    if (response.status === 429) {
      await discardBody(response);
      throw new RateLimitError('Exa rate limited (HTTP 429)', parseRetryAfter(response, this.retryAfterFallbackMs));
    }
    if (!response.ok) {
      await discardBody(response);
      throw new ProviderHttpError(`Exa API error (HTTP ${response.status})`, response.status);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Exa returned an unprocessable body: ${String(error)}`, response.status, { cause: error });
    }
    return this._map(data);
  }

  /** 匿名 MCP 模式：initialize → initialized → tools/call web_search_exa。 */
  async _searchAnonymous(input) {
    const { query, maxResults, signal } = input;
    try {
      const sessionId = await this._mcpInitialize(signal);
      if (sessionId != null) await this._mcpNotifyInitialized(sessionId, signal);
      const payload = await this._mcpToolsCall(sessionId, {
        name: 'web_search_exa',
        arguments: {
          query,
          ...(maxResults != null ? { numResults: maxResults } : {}),
        },
      }, signal);
      const result = payload.result;
      if (result == null || result.isError === true) {
        throw new ProviderHttpError('Exa MCP call failed: no result', 0);
      }
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((item) => item?.type === 'text' ? String(item.text ?? '') : '')
        .filter((item) => item.length > 0)
        .join('\n\n');
      return this._mapMcpText(text);
    } catch (error) {
      rethrowIfAborted(error, signal);
      if (error instanceof RateLimitError || error instanceof ProviderHttpError) throw error;
      throw new ProviderHttpError(`Exa MCP request failed: ${String(error)}`, 0, { cause: error });
    }
  }

  async _mcpInitialize(signal) {
    const { response, payload } = await this._mcpPost({
      id: ++this._nextRpcId,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dsh-web-search-pool', version: '0.2.0' },
      },
      signal,
    });
    this._throwMcpHttp(response, payload);
    return response.headers?.get?.('mcp-session-id') ?? null;
  }

  async _mcpNotifyInitialized(sessionId, signal) {
    await this._mcpPost({
      id: null,
      method: 'notifications/initialized',
      params: {},
      sessionId,
      signal,
    });
  }

  async _mcpToolsCall(sessionId, params, signal) {
    const { response, payload } = await this._mcpPost({
      id: ++this._nextRpcId,
      method: 'tools/call',
      params,
      sessionId,
      signal,
    });
    this._throwMcpHttp(response, payload);
    return payload;
  }

  _throwMcpHttp(response, payload) {
    if (response.status === 429) {
      throw new RateLimitError('Exa MCP rate limited (HTTP 429)', parseRetryAfter(response, this.retryAfterFallbackMs));
    }
    if (!response.ok) {
      throw new ProviderHttpError(`Exa MCP error (HTTP ${response.status})`, response.status);
    }
    if (payload.error != null) throw this._mcpError(payload.error);
  }

  _mcpError(error) {
    const message = String(error?.message ?? error ?? 'unknown MCP error');
    if (/rate limit|too many requests/i.test(message)) {
      return new RateLimitError(message, this.retryAfterFallbackMs);
    }
    return new ProviderHttpError(`Exa MCP error: ${message}`, 0);
  }

  async _mcpPost({ id, method, params, sessionId, signal }) {
    let response;
    try {
      response = await this.fetchImpl(this.mcpEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'user-agent': USER_AGENT,
          ...(sessionId != null ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Exa MCP request failed: ${String(error)}`, 0, { cause: error });
    }

    const text = await this._mcpResponseText(response, signal);
    let payload = {};
    if (text.trim().length > 0) {
      try {
        payload = JSON.parse(extractSseData(text) ?? text);
      } catch (error) {
        throw new ProviderHttpError(`Exa MCP returned an unprocessable body: ${String(error)}`, response.status, { cause: error });
      }
    }
    return { response, payload };
  }

  async _mcpResponseText(response, signal) {
    try {
      return await response.text();
    } catch (error) {
      rethrowIfAborted(error, signal);
      throw new ProviderHttpError(`Exa MCP returned an unprocessable body: ${String(error)}`, response.status, { cause: error });
    }
  }

  /** 匿名 MCP 文本格式：多个块以 `Title:` 开头、`---` 分隔，块内含 URL/Published/Highlights。 */
  _mapMcpText(text) {
    const blocks = String(text ?? '')
      .split(/^Title:\s*/m)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);
    const sources = [];
    for (const block of blocks) {
      const url = matchField(block, 'URL');
      if (url == null) continue;
      const source = { url };
      const firstLine = block.split('\n')[0].trim();
      if (firstLine.length > 0) source.title = firstLine;
      const published = matchField(block, 'Published');
      if (published != null) source.publishedAt = published;
      const snippet = extractHighlights(block);
      if (snippet != null) source.snippet = snippet;
      sources.push(source);
    }
    return { sources, truncated: false };
  }

  _map(data) {
    const results = Array.isArray(data.results) ? data.results : [];
    const sources = results.map((r) => {
      const source = { url: String(r.url ?? '') };
      if (r.title != null && String(r.title).length > 0) source.title = String(r.title);
      const snippet = pickSnippet(r);
      if (snippet != null) source.snippet = snippet;
      if (r.publishedDate != null && String(r.publishedDate).length > 0) source.publishedAt = String(r.publishedDate);
      return source;
    }).filter((s) => s.url.length > 0);

    return { sources, truncated: false };
  }
}

/**
 * 按 SSE 规范从响应文本提取事件数据：收集全部 `data:` 行（去字段名后可选的一个前导空格），
 * 以 `\n` 拼接。无 `data:` 行时返回 null（调用方回退用原文解析），多帧/单行/无空格写法都兼容。
 * @param {string} text
 * @returns {string|null}
 */
function extractSseData(text) {
  const lines = text.split('\n');
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, '').replace(/\r$/, ''));
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

function matchField(block, name) {
  const match = block.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  if (match == null) return undefined;
  const value = match[1].trim();
  return value.length > 0 ? value : undefined;
}

/** Highlights 之后的所有非空行合并为摘要，限制长度避免污染上下文。 */
function extractHighlights(block) {
  const marker = 'Highlights:';
  const index = block.indexOf(marker);
  if (index === -1) return undefined;
  const lines = block
    .slice(index + marker.length)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '...' && !line.startsWith('---'));
  if (lines.length === 0) return undefined;
  const snippet = lines.join(' ').replace(/\s+/g, ' ').slice(0, 1_200);
  return snippet.length > 0 ? snippet : undefined;
}

/** 摘要字段优先级：text > summary > highlights 拼接。 */
function pickSnippet(r) {
  if (r.text != null && String(r.text).length > 0) return String(r.text);
  if (r.summary != null && String(r.summary).length > 0) return String(r.summary);
  if (Array.isArray(r.highlights) && r.highlights.length > 0) return r.highlights.map(String).join(' ');
  return undefined;
}
