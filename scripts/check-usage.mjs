#!/usr/bin/env node
/**
 * 查询所有 Tavily key 的账号用量（CLI 诊断工具）。只输出 plan / usage / limit / remaining，
 * 不输出 key 明文。
 *
 * 凭据来源（与 DSH 的解析顺序对齐）：进程环境变量 > `$DSH_HOME/.credentials.yaml` > `$DSH_HOME/.env`。
 * `DSH_HOME` 未设置时默认 `~/.dsh`。
 *
 * 用法：node scripts/check-usage.mjs
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

/** 单个 key 的用量查询超时（毫秒）。 */
const REQUEST_TIMEOUT_MS = 10_000;
const ENDPOINT = 'https://api.tavily.com/usage';
const REF_PATTERN = /^TAVILY_API_KEY_[A-Za-z0-9_]*$/;

/**
 * 纯函数：解析 `.credentials.yaml` 文本中的 `TAVILY_API_KEY_*: value` 行（一次扫描，O(n)）。
 * @param {string} text
 * @returns {Map<string, string>} ref -> 明文值（可为空字符串）。
 */
export function parseCredentialsYaml(text) {
  const map = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.trim().match(/^(TAVILY_API_KEY_[A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (match == null) continue;
    map.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
  }
  return map;
}

/**
 * 纯函数：解析 `.env` 文本中的 `TAVILY_API_KEY_*=value` 行（支持 `export ` 前缀与引号，忽略注释）。
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseEnvFile(text) {
  const map = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?(TAVILY_API_KEY_[A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match == null) continue;
    map.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
  }
  return map;
}

/**
 * 汇总三级凭据来源（优先级：环境变量 > credentials.yaml > .env）。
 * @returns {Map<string, string>} ref -> 明文值。
 */
export function collectCredentialRefs({ env = process.env, dshHome, readFile = readFileSync } = {}) {
  const merged = new Map();
  const tryRead = (path) => {
    try {
      return readFile(path, 'utf8');
    } catch {
      return null;
    }
  };
  const dotenv = tryRead(join(dshHome, '.env'));
  if (dotenv != null) {
    for (const [ref, value] of parseEnvFile(dotenv)) merged.set(ref, value);
  }
  const yaml = tryRead(join(dshHome, '.credentials.yaml'));
  if (yaml != null) {
    for (const [ref, value] of parseCredentialsYaml(yaml)) merged.set(ref, value);
  }
  for (const [key, value] of Object.entries(env)) {
    if (REF_PATTERN.test(key)) merged.set(key, String(value ?? ''));
  }
  return merged;
}

/** 查询单个 key 的用量并打印（不打印明文）。 */
async function reportUsage(ref, value) {
  if (value == null || value.length === 0) {
    console.log(ref + ' -> 未配置');
    return;
  }
  try {
    const response = await fetch(ENDPOINT, {
      headers: { authorization: 'Bearer ' + value },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      data = { raw: body.slice(0, 200) };
    }
    console.log(ref + ' -> HTTP ' + response.status);
    const keyView = data.key ?? {};
    const account = data.account ?? {};
    if (typeof keyView.usage === 'number' || typeof keyView.limit === 'number') {
      console.log('  key.usage=' + keyView.usage + ' key.limit=' + keyView.limit);
    }
    if (typeof keyView.search_usage === 'number') {
      console.log('  key.search_usage=' + keyView.search_usage);
    }
    if (typeof account.current_plan === 'string') {
      const limit = account.plan_limit;
      const used = account.plan_usage;
      console.log('  plan=' + account.current_plan);
      console.log('  plan_usage=' + used + ' plan_limit=' + limit);
      if (typeof limit === 'number' && typeof used === 'number') {
        console.log('  remaining=' + Math.max(0, limit - used));
      }
    }
    if (Object.keys(keyView).length === 0 && Object.keys(account).length === 0) {
      console.log('  body=' + JSON.stringify(data).slice(0, 400));
    }
  } catch (error) {
    console.log(ref + ' -> error: ' + String(error?.message ?? error));
  }
}

async function main() {
  const dshHome = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh');
  const refs = collectCredentialRefs({ dshHome });
  if (refs.size === 0) {
    console.error(`未在环境变量、${join(dshHome, '.credentials.yaml')} 或 ${join(dshHome, '.env')} 中找到 TAVILY_API_KEY_*`);
    process.exitCode = 1;
    return;
  }
  // 并行查询全部 key（各自带超时，单个失败不影响其余）。
  await Promise.all([...refs.entries()].map(([ref, value]) => reportUsage(ref, value)));
}

// 仅作为主模块时执行 CLI；被测试 import 时只暴露纯函数。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
