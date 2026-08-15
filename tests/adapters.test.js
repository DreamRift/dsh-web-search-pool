import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TavilyAdapter } from '../src/adapters/tavily.js';
import { ExaAdapter } from '../src/adapters/exa.js';
import { RateLimitError, ProviderHttpError } from '../src/core/errors.js';

function mockResponse({ status = 200, headers = {}, body }) {
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => lowerHeaders[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function mockMcpResponse({ status = 200, headers = {}, text = '' }) {
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => lowerHeaders[k.toLowerCase()] ?? null },
    text: async () => text,
  };
}

test('TavilyAdapter: 映射 results 与 answer 到归一化结果', async () => {
  const adapter = new TavilyAdapter({
    fetchImpl: async () => mockResponse({
      body: {
        answer: '答案是 X',
        results: [
          { url: 'https://a.com', title: 'A', content: '摘要 A', published_date: '2026-01-01' },
        ],
      },
    }),
  });
  const result = await adapter.search({ query: 'q', apiKey: 'k', maxResults: 8 });
  assert.equal(result.content, '答案是 X');
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.sources[0], { url: 'https://a.com', title: 'A', snippet: '摘要 A', publishedAt: '2026-01-01' });
});

test('TavilyAdapter: 请求体默认打开高级功能（advanced + answer）', async () => {
  let captured = null;
  const adapter = new TavilyAdapter({
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return mockResponse({ body: { results: [] } });
    },
  });
  await adapter.search({ query: 'q', apiKey: 'k', maxResults: 8 });
  assert.equal(captured.api_key, 'k');
  assert.equal(captured.max_results, 8);
  assert.equal(captured.query, 'q');
  assert.equal(captured.search_depth, 'advanced');
  assert.equal(captured.include_answer, true);
});

test('TavilyAdapter: 高级参数 topic/time_range/include_domains 映射', async () => {
  let captured = null;
  const adapter = new TavilyAdapter({
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return mockResponse({ body: { results: [] } });
    },
  });
  await adapter.search({
    query: 'q', apiKey: 'k',
    topic: 'finance', timeRange: 'week', includeDomains: ['a.com', 'b.com'],
  });
  assert.equal(captured.topic, 'finance');
  assert.equal(captured.time_range, 'week');
  assert.deepEqual(captured.include_domains, ['a.com', 'b.com']);
});

test('TavilyAdapter: days 在无 timeRange 时透传', async () => {
  let captured = null;
  const adapter = new TavilyAdapter({
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return mockResponse({ body: { results: [] } });
    },
  });
  await adapter.search({ query: 'q', apiKey: 'k', days: 3 });
  assert.equal(captured.days, 3);
  assert.equal(captured.time_range, undefined);
});

test('TavilyAdapter: 429 → RateLimitError 并解析 Retry-After 秒数', async () => {
  const adapter = new TavilyAdapter({
    fetchImpl: async () => mockResponse({ status: 429, headers: { 'retry-after': '5' }, body: {} }),
  });
  await assert.rejects(
    adapter.search({ query: 'q', apiKey: 'k' }),
    (err) => err instanceof RateLimitError && err.retryAfterMs === 5_000,
  );
});

test('TavilyAdapter: getUsage 查询账号剩余额度', async () => {
  let captured = null;
  const adapter = new TavilyAdapter({
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return mockResponse({
        body: {
          key: { usage: 20, limit: null, search_usage: 19 },
          account: { current_plan: 'Researcher', plan_usage: 20, plan_limit: 1000 },
        },
      });
    },
  });
  const usage = await adapter.getUsage('tvly-test');
  assert.equal(captured.url, 'https://api.tavily.com/usage');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers.authorization, 'Bearer tvly-test');
  assert.deepEqual(usage, { plan: 'Researcher', used: 20, limit: 1000, remaining: 980 });
});

test('TavilyAdapter: getUsage 无限额度时 remaining 为 null', async () => {
  const adapter = new TavilyAdapter({
    fetchImpl: async () => mockResponse({
      body: { account: { current_plan: 'Pay as you go', plan_usage: 25, plan_limit: null } },
    }),
  });
  const usage = await adapter.getUsage('tvly-test');
  assert.deepEqual(usage, { plan: 'Pay as you go', used: 25, limit: null, remaining: null });
});

test('TavilyAdapter: 429 无 Retry-After 时回退默认值', async () => {
  const adapter = new TavilyAdapter({
    retryAfterFallbackMs: 1_500,
    fetchImpl: async () => mockResponse({ status: 429, body: {} }),
  });
  await assert.rejects(
    adapter.search({ query: 'q', apiKey: 'k' }),
    (err) => err instanceof RateLimitError && err.retryAfterMs === 1_500,
  );
});

test('TavilyAdapter: 非 2xx → ProviderHttpError 携带状态码', async () => {
  const adapter = new TavilyAdapter({
    fetchImpl: async () => mockResponse({ status: 500, body: {} }),
  });
  await assert.rejects(
    adapter.search({ query: 'q', apiKey: 'k' }),
    (err) => err instanceof ProviderHttpError && err.status === 500,
  );
});

test('ExaAdapter: 映射 results，无 provider 答案', async () => {
  const adapter = new ExaAdapter({
    fetchImpl: async () => mockResponse({
      body: {
        results: [
          { url: 'https://b.com', title: 'B', text: '正文 B', publishedDate: '2026-02-02' },
        ],
      },
    }),
  });
  const result = await adapter.search({ query: 'q', apiKey: 'k', maxResults: 8 });
  assert.equal(result.content, undefined);
  assert.deepEqual(result.sources[0], { url: 'https://b.com', title: 'B', snippet: '正文 B', publishedAt: '2026-02-02' });
});

test('ExaAdapter: 请求头带 x-api-key 与默认高级功能（useAutoprompt + 深度提取）', async () => {
  let capturedInit = null;
  const adapter = new ExaAdapter({
    fetchImpl: async (_url, init) => {
      capturedInit = init;
      return mockResponse({ body: { results: [] } });
    },
  });
  await adapter.search({ query: 'q', apiKey: 'k', maxResults: 6 });
  assert.equal(capturedInit.headers['x-api-key'], 'k');
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.numResults, 6);
  assert.equal(body.useAutoprompt, true);
  assert.deepEqual(body.contents, { text: true, highlights: true, summary: true });
});

test('ExaAdapter: 高级参数 includeDomains/startPublishedDate 映射', async () => {
  let captured = null;
  const adapter = new ExaAdapter({
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return mockResponse({ body: { results: [] } });
    },
  });
  await adapter.search({
    query: 'q', apiKey: 'k',
    includeDomains: ['a.com'], startPublishedDate: '2026-03-01',
  });
  assert.deepEqual(captured.includeDomains, ['a.com']);
  assert.equal(captured.startPublishedDate, '2026-03-01');
});

test('ExaAdapter: 摘要优先级 text > summary > highlights', async () => {
  const adapter = new ExaAdapter({
    fetchImpl: async () => mockResponse({
      body: {
        results: [
          { url: 'https://a.com', title: 'A', text: '正文', summary: '总结', highlights: ['高亮'] },
          { url: 'https://b.com', title: 'B', summary: '总结B', highlights: ['高亮1', '高亮2'] },
          { url: 'https://c.com', title: 'C', highlights: ['只有高亮'] },
        ],
      },
    }),
  });
  const result = await adapter.search({ query: 'q', apiKey: 'k' });
  assert.equal(result.sources[0].snippet, '正文');
  assert.equal(result.sources[1].snippet, '总结B');
  assert.equal(result.sources[2].snippet, '只有高亮');
});

test('ExaAdapter: 429 → RateLimitError', async () => {
  const adapter = new ExaAdapter({
    fetchImpl: async () => mockResponse({ status: 429, body: {} }),
  });
  await assert.rejects(
    adapter.search({ query: 'q', apiKey: 'k' }),
    (err) => err instanceof RateLimitError,
  );
});

test('ExaAdapter: 无 apiKey 走匿名 MCP web_search_exa 并映射文本结果', async () => {
  const calls = [];
  const mcpText = [
    'Title: 第一个结果',
    'URL: https://a.com',
    'Published: 2026-08-01T00:00:00.000Z',
    'Author: A',
    'Highlights:',
    '摘要 A',
    '...',
    '---',
    '',
    'Title: 第二个结果',
    'URL: https://b.com',
    'Published: 2026-08-02T00:00:00.000Z',
    'Highlights:',
    '摘要 B',
  ].join('\n');
  const adapter = new ExaAdapter({
    fetchImpl: async (_url, init) => {
      calls.push(init);
      const body = JSON.parse(init.body);
      if (body.method === 'initialize') {
        return mockMcpResponse({
          headers: { 'mcp-session-id': 'sess-1' },
          text: 'event: message\ndata: {"result":{},"jsonrpc":"2.0","id":1}\n\n',
        });
      }
      if (body.method === 'notifications/initialized') {
        return mockMcpResponse({ text: '' });
      }
      if (body.method === 'tools/call') {
        assert.equal(body.params.name, 'web_search_exa');
        assert.deepEqual(body.params.arguments, { query: 'q', numResults: 5 });
        return mockMcpResponse({
          text: 'event: message\ndata: ' + JSON.stringify({
            result: { content: [{ type: 'text', text: mcpText }] },
            jsonrpc: '2.0',
            id: 2,
          }) + '\n\n',
        });
      }
      throw new Error('unexpected MCP method: ' + body.method);
    },
  });
  const result = await adapter.search({ query: 'q', maxResults: 5 });
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.sources[0], {
    url: 'https://a.com',
    title: '第一个结果',
    publishedAt: '2026-08-01T00:00:00.000Z',
    snippet: '摘要 A',
  });
  assert.equal(result.sources[1].snippet, '摘要 B');
  assert.ok(calls.every((init) => init.headers['x-api-key'] === undefined));
  assert.ok(calls.some((init) => init.headers['mcp-session-id'] === 'sess-1'));
});

test('ExaAdapter: 匿名 MCP rate limit → RateLimitError', async () => {
  const adapter = new ExaAdapter({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'initialize') {
        return mockMcpResponse({
          headers: { 'mcp-session-id': 'sess-1' },
          text: 'data: {"result":{},"jsonrpc":"2.0","id":1}',
        });
      }
      if (body.method === 'notifications/initialized') return mockMcpResponse({ text: '' });
      return mockMcpResponse({
        text: 'data: ' + JSON.stringify({
          error: { code: -32000, message: "You've hit Exa's free MCP rate limit." },
          jsonrpc: '2.0',
          id: 2,
        }),
      });
    },
  });
  await assert.rejects(
    adapter.search({ query: 'q' }),
    (err) => err instanceof RateLimitError,
  );
});
