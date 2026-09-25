import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const patterns = [
  ['个人用户名', /cty05/],
  ['C:\\Users\\<真实用户名>', /C:\\Users\\[a-z]/i],
  ['真实长度 Tavily key', /tvly-[A-Za-z0-9]{20,}/],
  ['常见邮箱', /[a-zA-Z0-9._%+-]+@(qq|163|gmail|outlook|foxmail|126)\.com/i],
  ['DeekSeek key 形态', /\b(?:ds|sk)-[A-Za-z0-9]{24,}\b/],
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

const seen = new Set();
let findings = 0;
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
        findings += 1;
        console.log(`命中 [${label}] @ ${commit.slice(0, 8)}:${file} -> ${JSON.stringify(m[0].slice(0, 60))}`);
        break;
      }
    }
  }
}
console.log(findings === 0 ? '历史扫描完成：无隐私命中' : `历史扫描完成：${findings} 个文件有命中（见上）`);
