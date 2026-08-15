/**
 * DSH 封装层的配置 schema 与选项解析。
 * 仿照 `@deepseek-ai/dsh-web-search-deepseek` 的 `Config` + `resolveOptions` 结构。
 * 凭据引用（`apiKeyEnv`）走 `ctx.credentials`，每次操作 resolve，不缓存明文。
 *
 * 高级功能：Tavily 的 `answer`/`search_depth` 与 Exa 的 `useAutoprompt`/深度提取默认打开；
 * 日期/域名/主题等依赖 query 的参数默认 `auto`（AI 可选，按 query 语义决定），也可显式配值或 `off` 关闭。
 * @module dsh-web-search-pool/config
 */

import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { PROVIDER_TAVILY, PROVIDER_EXA } from '../core/constants.js';

/** 单个 key 的描述。`id` 可选（缺省用 `${provider}:${apiKeyEnv}`）。 */
const keySpec = z.object({
  id: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
  rpm: z.number().step(1).min(1).default(60),
  remark: z.string(),
});

/** Tavily 高级功能配置。 */
const tavilySpec = z.object({
  keys: z.array(keySpec).default([]),
  searchDepth: z.union(['basic', 'advanced']).default('advanced'),
  includeAnswer: z.boolean().default(true),
  includeRawContent: z.boolean().default(false),
  topic: z.union(['general', 'news', 'finance', 'auto']).default('auto'),
  timeRange: z.union(['day', 'week', 'month', 'year', 'auto', 'off']).default('auto'),
  includeDomains: z.union([z.array(z.string()), z.const('auto'), z.const('off')]).default('auto'),
  excludeDomains: z.array(z.string()).default([]),
});

/** Exa 高级功能配置。 */
const exaSpec = z.object({
  keys: z.array(keySpec).default([]),
  type: z.union(['auto', 'neural', 'keyword']).default('auto'),
  useAutoprompt: z.boolean().default(true),
  highlights: z.boolean().default(true),
  summary: z.boolean().default(true),
  includeDomains: z.union([z.array(z.string()), z.const('auto'), z.const('off')]).default('auto'),
  excludeDomains: z.array(z.string()).default([]),
  startPublishedDate: z.string().default('auto'), // 'auto' | 'off' | 'YYYY-MM-DD'
});

/** 运行时额度快照（Host 写入、Client 展示；不参与用户表单保存）。 */
const usageSpec = z.object({
  updatedAt: z.number(),
  totalUsed: z.number(),
  totalLimit: z.number(),
  keys: z.array(z.object({
    ref: z.string(),
    used: z.number(),
    limit: z.number(),
    remaining: z.number(),
    plan: z.string(),
  })).default([]),
}).default({ updatedAt: 0, totalUsed: 0, totalLimit: 0, keys: [] });

/** 插件的配置 schema（同时是 settings namespace 的 schema）。 */
export const Config = z.object({
  enabled: z.boolean().default(true),
  providers: z.object({
    tavily: tavilySpec,
    exa: exaSpec,
  }),
  strategy: z.union(['weighted-round-robin', 'least-used']).default('weighted-round-robin'),
  providerPriority: z.array(z.union(['tavily', 'exa'])).default(['tavily', 'exa']),
  allowedFails: z.number().step(1).min(1).default(3),
  cooldownMs: z.number().min(0).default(30_000),
  retryAfterFallbackMs: z.number().min(0).default(1_000),
  /** Tavily `/usage` 缓存刷新间隔（毫秒）。 */
  usageCacheMs: z.number().min(0).default(300_000),
  /** 判定“不够下一次使用”的保留额度（Tavily advanced search 为 2 credits）。 */
  quotaReserveCredits: z.number().min(0).default(2),
  /** 额度耗尽后的长冷却时长（毫秒），额度恢复并刷新后自动解除。 */
  quotaExhaustedCooldownMs: z.number().min(0).default(30 * 24 * 60 * 60 * 1000),
  /** 手动刷新计数：Client 点“立即刷新”时 +1，Host 检测变化后重新查 /usage。 */
  usageRefreshTick: z.number().step(1).min(0).default(0),
  /** 额度发布诊断（Host 写入；为空表示上次发布成功）。 */
  usageDiagnostic: z.string().default(''),
  /** 运行时额度快照（Host 写入，Client 展示）。 */
  usage: usageSpec,
});

/** 校验 apiKeyEnv 是否为合法的环境变量名（CredentialRef），防止误填 API key 明文。 */
function isValidCredentialRef(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

/**
 * 把一个 settings section 投影成 provider 服务下一次搜索所需的选项。
 * 每次 search 调用一次，所以一次搜索不会混用两个 section 的快照。
 * @param {object} ctx 插件上下文（提供 credentials / launchEnvironment / agents）。
 * @param {object} config 当前权威 section（已由 schema 默认值兜底）。
 */
export function resolveOptions(ctx, config) {
  const providers = config.providers ?? {};
  const tavily = providers.tavily ?? {};
  const exa = providers.exa ?? {};

  /** @type {import('../core/constants.js').KeySpec[]} */
  const entries = [];
  for (const key of tavily.keys ?? []) {
    if (!isValidCredentialRef(key?.apiKeyEnv)) continue;
    entries.push({
      id: key.id ?? `tavily:${key.apiKeyEnv}`,
      provider: PROVIDER_TAVILY,
      credentialRef: credentialRef(key.apiKeyEnv),
      rpm: key.rpm ?? 60,
      ...key.remark != null && key.remark.length > 0 ? { remark: key.remark } : {},
    });
  }
  const exaKeys = exa.keys ?? [];
  for (let index = 0; index < exaKeys.length; index++) {
    const key = exaKeys[index];
    const ref = typeof key?.apiKeyEnv === 'string' ? key.apiKeyEnv : '';
    // Exa 支持官方托管 MCP 匿名免费层：apiKeyEnv 留空时生成匿名 entry。
    if (ref.length > 0 && !isValidCredentialRef(ref)) continue;
    entries.push({
      id: key.id ?? (ref.length > 0 ? `exa:${ref}` : `exa:anonymous:${index}`),
      provider: PROVIDER_EXA,
      ...(ref.length > 0 ? { credentialRef: credentialRef(ref) } : { anonymous: true }),
      rpm: key.rpm ?? 60,
      ...key.remark != null && key.remark.length > 0 ? { remark: key.remark } : {},
    });
  }

  return {
    enabled: config.enabled ?? true,
    available: entries.length > 0 && (config.enabled ?? true),
    entries,
    strategy: config.strategy ?? 'weighted-round-robin',
    providerPriority: config.providerPriority ?? ['tavily', 'exa'],
    allowedFails: config.allowedFails ?? 3,
    cooldownMs: config.cooldownMs ?? 30_000,
    retryAfterFallbackMs: config.retryAfterFallbackMs ?? 1_000,
    usageCacheMs: config.usageCacheMs ?? 300_000,
    quotaReserveCredits: config.quotaReserveCredits ?? 2,
    quotaExhaustedCooldownMs: config.quotaExhaustedCooldownMs ?? 30 * 24 * 60 * 60 * 1000,
    /** Tavily 高级功能原始配置（保留 'auto'/'off' 标记，provider 结合 query 意图解析）。 */
    tavilyParams: {
      searchDepth: tavily.searchDepth ?? 'advanced',
      includeAnswer: tavily.includeAnswer ?? true,
      includeRawContent: tavily.includeRawContent ?? false,
      topic: tavily.topic ?? 'auto',
      timeRange: tavily.timeRange ?? 'auto',
      includeDomains: tavily.includeDomains ?? 'auto',
      excludeDomains: tavily.excludeDomains ?? [],
    },
    /** Exa 高级功能原始配置（同上）。 */
    exaParams: {
      type: exa.type ?? 'auto',
      useAutoprompt: exa.useAutoprompt ?? true,
      highlights: exa.highlights ?? true,
      summary: exa.summary ?? true,
      includeDomains: exa.includeDomains ?? 'auto',
      excludeDomains: exa.excludeDomains ?? [],
      startPublishedDate: exa.startPublishedDate ?? 'auto',
    },
    /** 解析某个 entry 的密钥；返回 undefined 表示缺失。 */
    resolveKey: async (entry, signal) => {
      if (signal?.aborted === true) throw new DOMException('search-pool search aborted', 'AbortError');
      if (entry.anonymous === true) return undefined;
      const ref = entry.credentialRef;
      const credentials = ctx.get('credentials');
      if (credentials !== undefined) {
        try {
          const resolved = await credentials.resolve(ref);
          if (resolved?.value != null && resolved.value.length > 0) return resolved.value;
        } catch {
          // 凭据服务异常时回退到环境变量，不因凭据层故障中断搜索。
        }
      }
      const ambient = launchEnvironmentOf(ctx).get(ref);
      if (ambient !== undefined && ambient.value.length > 0) return ambient.value;
      return undefined;
    },
    /** 可观测性：记录每次 key 尝试（不含密钥明文），不写核心不认识的自定义会话事件。 */
    recordRequest: (record) => {
      ctx.logger?.info?.(`search-pool attempt ${JSON.stringify(record)}`);
    },
  };
}

