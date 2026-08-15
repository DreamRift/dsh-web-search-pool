#!/usr/bin/env node
/**
 * 读取 `$DSH_HOME/.credentials.yaml` 中所有 `TAVILY_API_KEY_*`，查询 Tavily account 用量。
 * 只输出 plan / usage / limit / remaining，不输出 key 明文。
 *
 * 用法：node scripts/check-usage.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const file = join(homedir(), '.dsh', '.credentials.yaml');
let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error('未找到 ' + file);
  process.exit(1);
}

const refs = text
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^TAVILY_API_KEY_[A-Za-z0-9_]*\s*:/.test(line))
  .map((line) => line.split(':')[0].trim());

if (refs.length === 0) {
  console.error('未在 ' + file + ' 找到 TAVILY_API_KEY_*');
  process.exit(1);
}

const endpoint = 'https://api.tavily.com/usage';
for (const ref of refs) {
  const line = text.split('\n').find((candidate) => candidate.trim().startsWith(ref + ':'));
  if (line == null) {
    console.log(ref + ' -> 在凭据文件中未找到对应行');
    continue;
  }
  const value = line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '');
  if (value.length === 0) {
    console.log(ref + ' -> 未配置');
    continue;
  }
  try {
    const response = await fetch(endpoint, { headers: { authorization: 'Bearer ' + value } });
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
    console.log(ref + ' -> error: ' + String(error));
  }
}
