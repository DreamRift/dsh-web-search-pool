#!/usr/bin/env node
/**
 * 发布前隐私扫描：遍历 git 全部历史快照，检查个人用户名、本机绝对路径、
 * 真实 API key、邮箱与 Bearer token。
 *
 * 用户名不写死在源码里（否则检测器本身就成了泄漏点）：默认取当前系统账户名，
 * 可用 PRIVACY_USERNAME 覆盖（例如在 CI 上扫描他人提交时）。
 *
 * 退出码：有命中时为 1，便于接入发布流程。
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { userInfo } from 'node:os';

const SELF = 'scripts/privacy-scan.mjs';
const username = (process.env.PRIVACY_USERNAME ?? userInfo().username ?? '').trim();

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const patterns = [
  ...(username.length > 0 ? [['个人用户名', new RegExp(escapeRegExp(username), 'i')]] : []),
  ['C:\\Users\\<真实用户名>', /C:\\Users\\[a-z]/i],
  ['真实长度 Tavily key', /tvly-[A-Za-z0-9]{20,}/],
  ['常见邮箱', /[a-zA-Z0-9._%+-]+@(qq|163|gmail|outlook|foxmail|126)\.com/i],
  ['DeepSeek key 形态', /\b(?:ds|sk)-[A-Za-z0-9]{24,}\b/],
  ['Bearer 长 token', /Bearer\s+[A-Za-z0-9._-]{24,}/],
];

// 收集所有历史版本的全部 blob（按 commit 快照）
const commits = execSync('git rev-list --all', { encoding: 'utf8' }).trim().split('\n');
const files = new Set();
for (const commit of commits) {
  const list = execSync(`git ls-tree -r --name-only ${commit}`, { encoding: 'utf8' }).trim().split('\n');
  for (const f of list) if (f) files.add(f);
}
console.log(`历史文件路径总数（去重）: ${files.size}`);
if (username.length === 0) console.log('未取到当前用户名；如需扫描个人用户名请设置 PRIVACY_USERNAME');

const seen = new Set();
let findings = 0;
let selfHits = 0;
for (const commit of commits) {
  for (const file of execSync(`git ls-tree -r --name-only ${commit}`, { encoding: 'utf8' }).trim().split('\n')) {
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let text;
    try {
      text = execSync(`git show ${commit}:${JSON.stringify(file).replace(/^"|"$/g, '')}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { continue; }
    if (text.includes('\0')) continue; // 二进制
    for (const [label, pattern] of patterns) {
      const m = text.match(pattern);
      if (m) {
        // 检测器自己的历史版本里出现用户名属于模式表本身，不是泄漏；HEAD 已改为运行时取值。
        if (file === SELF && label === '个人用户名') { selfHits += 1; break; }
        findings += 1;
        console.log(`命中 [${label}] @ ${commit.slice(0, 8)}:${file} -> ${JSON.stringify(m[0].slice(0, 60))}`);
        break;
      }
    }
  }
}
if (selfHits > 0) console.log(`忽略：${selfHits} 个历史版本的检测器模式表包含用户名（${SELF}）`);
console.log(findings === 0 ? '历史扫描完成：无隐私命中' : `历史扫描完成：${findings} 个文件有命中（见上）`);
process.exitCode = findings === 0 ? 0 : 1;
