/**
 * DSH 封装层的配置 schema 与选项解析（DSH 0.1.7+）。
 * 仿照 `@deepseek-ai/dsh-web-search-deepseek` 的 `Config` + `resolveOptions` 结构。
 * 凭据引用（`apiKeyEnv`）走 `ctx.credentials`，每次操作 resolve，不缓存明文。
 *
 * 0.1.7 的设置模型（2026-09-25 调研，依据桌面版 0.1.7-rc.2 源码）：
 * - `@deepseek-ai/dsh-settings` 只剩 `SettingsForms` 服务（`installSettingsSection` /
 *   `installSection` 均已移除）；设置表单由 loader 行的 **Config schema 自动投影**，
 *   namespace = loader 行 id（本项目 `web-search-pool`）。
 * - 表单可编辑的字段必须显式 `.volatile()`；运行时报错时会话里这些字段是 **Ref**
 *   （`config.enabled.get()`），编辑通过 `settings.mutate` 写入 profile patch 并
 *   就地提交（不重挂插件，事件 `loader/volatile-update`）。
 * - **运行时状态（额度快照/诊断/刷新 tick）不允许再进 settings**：settings 写入会持久化
 *   进 profile 的 `cordis.patch.yml`，Host 周期发布的运行时会话数据绝不能落盘。
 *   Host 侧额度刷新保留为进程内行为，观测走 `ctx.logger`。
 *
 * 高级功能：Tavily 的 `answer`/`search_depth` 与 Exa 的 `useAutoprompt`/深度提取默认打开；
 * 日期/域名/主题等依赖 query 的参数默认 `auto`（AI 可选，按 query 语义决定），也可显式配值或 `off` 关闭。
 * @module dsh-web-search-pool/config
 */

import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { PROVIDER_TAVILY, PROVIDER_EXA, DEFAULTS } from '../core/constants.js';

/**
 * 单个 key 的描述。`id` 不再进 schema（由 `resolveOptions` 派生）；
 * 全部字段给默认值，避免 0.1.7 的 settings 写入校验把"只填了一半"的 key 拒绝。
 */
const keySpec = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(''),
  rpm: z.number().step(1).min(1).default(60),
  remark: z.string().default(''),
});

/** Tavily 高级功能配置（patch 层配置，设置卡片不编辑这些字段）。 */
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

/** Exa 高级功能配置（同上）。 */
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

/**
 * 插件的配置 schema（= 0.1.7 自动设置表单的字段来源）。
 *
 * `providers` 整棵子树标记 volatile：表单 value 就是完整的 providers 对象
 * （含 keys 数组），卡片一次 mutate 写回 keys；其余标量字段逐字段 volatile。
 * 默认值统一取自 core 的 `DEFAULTS`。
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  providers: z.object({
    tavily: tavilySpec,
    exa: exaSpec,
  }).volatile(),
  strategy: z.union(['weighted-round-robin', 'least-used']).default(DEFAULTS.strategy).volatile(),
  providerPriority: z.array(z.union(['tavily', 'exa'])).default(DEFAULTS.providerPriority).volatile(),
  allowedFails: z.number().step(1).min(1).default(DEFAULTS.allowedFails).volatile(),
  cooldownMs: z.number().min(0).default(DEFAULTS.cooldownMs).volatile(),
  retryAfterFallbackMs: z.number().min(0).default(DEFAULTS.retryAfterFallbackMs).volatile(),
  /** Tavily `/usage` 缓存刷新间隔（毫秒）。 */
  usageCacheMs: z.number().min(0).default(DEFAULTS.usageCacheMs).volatile(),
  /** 判定"不够下一次使用"的保留额度（Tavily advanced search 为 2 credits）。 */
  quotaReserveCredits: z.number().min(0).default(DEFAULTS.quotaReserveCredits).volatile(),
  /** 额度耗尽后的长冷却时长（毫秒），额度恢复并刷新后自动解除。 */
  quotaExhaustedCooldownMs: z.number().min(0).default(DEFAULTS.quotaExhaustedCooldownMs).volatile(),
  /** 单次搜索请求（每个 key 尝试）的超时（毫秒）；0 表示禁用，超时按 key 失败处理并自动换 key。 */
  requestTimeoutMs: z.number().min(0).default(DEFAULTS.requestTimeoutMs).volatile(),
});

/** 校验 apiKeyEnv 是否为合法的环境变量名（CredentialRef），防止误填 API key 明文。 */
function isValidCredentialRef(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

/**
 * 把一个 settings 快照投影成 provider 服务下一次搜索所需的选项。
 * 每次 search 调用一次，所以一次搜索不会混用两个 section 的快照。
 * @param {object} ctx 插件上下文（提供 credentials / launchEnvironment）。
 * @param {object} config 当前权威 section（已由 schema 默认值兜底，纯值快照）。
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
      id: `tavily:${key.apiKeyEnv}`,
      provider: PROVIDER_TAVILY,
      credentialRef: credentialRef(key.apiKeyEnv),
      rpm: key.rpm ?? DEFAULTS.rpmFallback,
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
      id: ref.length > 0 ? `exa:${ref}` : `exa:anonymous:${index}`,
      provider: PROVIDER_EXA,
      ...(ref.length > 0 ? { credentialRef: credentialRef(ref) } : { anonymous: true }),
      rpm: key.rpm ?? DEFAULTS.rpmFallback,
      ...key.remark != null && key.remark.length > 0 ? { remark: key.remark } : {},
    });
  }

  return {
    enabled: config.enabled ?? true,
    available: entries.length > 0 && (config.enabled ?? true),
    entries,
    strategy: config.strategy ?? DEFAULTS.strategy,
    providerPriority: config.providerPriority ?? DEFAULTS.providerPriority,
    allowedFails: config.allowedFails ?? DEFAULTS.allowedFails,
    cooldownMs: config.cooldownMs ?? DEFAULTS.cooldownMs,
    retryAfterFallbackMs: config.retryAfterFallbackMs ?? DEFAULTS.retryAfterFallbackMs,
    usageCacheMs: config.usageCacheMs ?? DEFAULTS.usageCacheMs,
    quotaReserveCredits: config.quotaReserveCredits ?? DEFAULTS.quotaReserveCredits,
    quotaExhaustedCooldownMs: config.quotaExhaustedCooldownMs ?? DEFAULTS.quotaExhaustedCooldownMs,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
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
