#!/usr/bin/env node
/**
 * 把 `web-search-pool` 加入 DSH api-proxy 的 settings 暴露白名单。
 *
 * 官方结论（0.1.0-rc.6 源码 + README）：settings.describe/update 只服务白名单内 namespace，
 * 插件仅注册 Settings 不会自动暴露；没有配置扩展点，必须改 `WEB_SETTINGS_NAMESPACES`。
 * DSH 升级会覆盖 npm 安装目录，升级后运行本脚本一次即可恢复（幂等）。
 *
 * 跨平台说明：按序探测 Windows（APPDATA npm）/ macOS（homebrew）/ Linux（/usr/local）
 * 等常见全局 node_modules 位置，并从当前 node 可执行文件推导；均未命中时可用
 * 环境变量 `DSH_API_PROXY_INDEX` 显式指定目标文件完整路径。
 *
 * 写入前用 `node --check` 做语法校验（仅用 Node 自身，无第三方依赖），校验失败不写入。
 * 改写逻辑自适应锚点行的缩进与换行风格（Tab/空格、CRLF/LF）。
 *
 * 用法：node scripts/patch-api-proxy-namespace.mjs
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** dsh-host-apiproxy 的入口文件相对全局 node_modules 的路径。 */
const API_PROXY_RELATIVE = join('@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js');

/**
 * 按序探测 dsh-host-apiproxy/lib/index.js 的候选路径（跨平台）。
 * @returns {string|null}
 */
export function findApiProxyIndex() {
  const candidates = [
    // 显式指定优先（DSH 安装在非默认位置时的逃生口）
    process.env.DSH_API_PROXY_INDEX,
    // Windows npm 全局安装（%APPDATA%\npm\node_modules）
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', API_PROXY_RELATIVE) : null,
    // 从当前 node 可执行文件推导全局 node_modules：
    //   win32（含 nvm-windows）→ node 同级的 node_modules；
    //   posix（系统/homebrew/nvm 安装）→ ../lib/node_modules。
    join(
      dirname(process.execPath),
      process.platform === 'win32' ? 'node_modules' : join('..', 'lib', 'node_modules'),
      API_PROXY_RELATIVE,
    ),
    // 常见全局位置兜底（homebrew Apple Silicon / Intel、系统安装）
    join('/opt/homebrew/lib/node_modules', API_PROXY_RELATIVE),
    join('/usr/local/lib/node_modules', API_PROXY_RELATIVE),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * 纯函数：构造把 `ns` 追加到 WEB_SETTINGS_NAMESPACES 的补丁内容。
 *
 * v3（2026-08-16 事故修复）：改为**数组末尾插入**——定位数组闭合 `]`，把新条目插在
 * 最后一个元素之后。旧版（含 v2）在锚点行 `"web-search-deepseek"` 之后插入，当本机
 * 其它插件（如 dsh-vision-bridge）的白名单脚本已在该行后插入过条目时，会把新条目
 * 插到中间且缺尾逗号（或双逗号），产生语法错误导致 dsh-host-apiproxy 加载失败、
 * DSH 启动失败。数组末尾插入对任意尾逗号状态都安全，多脚本先后运行互不影响。
 * 写入前仍由调用方做 `node --check` 语法校验兜底。
 *
 * @param {string} source 目标文件原文。
 * @param {string} ns 要加入白名单的 namespace。
 * @returns {{ ok: true, alreadyApplied: true } | { ok: true, output: string } | { ok: false, error: string }}
 */
export function buildPatchedSource(source, ns) {
  const NS = JSON.stringify(ns);
  if (source.includes(NS)) return { ok: true, alreadyApplied: true };

  const ARRAY_DECL = 'WEB_SETTINGS_NAMESPACES';
  const declIdx = source.indexOf(ARRAY_DECL);
  if (declIdx === -1) {
    return { ok: false, error: `未找到 ${ARRAY_DECL} 声明，文件结构可能已变化` };
  }
  const openIdx = source.indexOf('[', declIdx);
  const closeIdx = source.indexOf(']', openIdx);
  if (openIdx === -1 || closeIdx === -1) {
    return { ok: false, error: `${ARRAY_DECL} 数组结构异常` };
  }
  // 末条目的缩进与文件换行风格（CRLF/LF）。
  const lastLineStart = source.lastIndexOf('\n', closeIdx) + 1;
  const indentMatch = source.slice(lastLineStart, closeIdx).match(/^[ \t]*/);
  const indent = indentMatch != null && indentMatch[0].length > 0 ? indentMatch[0] : '\t';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const body = source.slice(openIdx + 1, closeIdx).replace(/\s+$/, '');
  const separator = body.length === 0 || body.endsWith(',') ? '' : ',';
  const insertion = separator + eol + indent + NS + eol;
  return { ok: true, output: source.slice(0, openIdx + 1) + body + insertion + source.slice(closeIdx) };
}

/** 用 node --check 校验补丁后代码的语法（临时文件与目标同目录，解析模式一致）。 */
function syntaxCheckOk(file, code) {
  const checkFile = file + '.patch-check.js';
  writeFileSync(checkFile, code, 'utf8');
  try {
    const result = spawnSync(process.execPath, ['--check', checkFile], { encoding: 'utf8' });
    if (result.status !== 0) {
      console.error('语法校验失败，已放弃写入（原文件未改动）：');
      console.error(result.stderr);
      return false;
    }
    return true;
  } finally {
    rmSync(checkFile, { force: true });
  }
}

async function main() {
  const file = findApiProxyIndex();
  if (file === null) {
    console.error([
      '未找到 dsh-host-apiproxy/lib/index.js。',
      '已尝试：DSH_API_PROXY_INDEX、Windows APPDATA npm、node 可执行文件推导、/opt/homebrew、/usr/local。',
      '可设置 DSH_API_PROXY_INDEX 指向完整路径后重跑，例如：',
      `  Windows:  set DSH_API_PROXY_INDEX=C:\\Users\\<you>\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai\\dsh-host-apiproxy\\lib\\index.js`,
      `  macOS/Linux: export DSH_API_PROXY_INDEX=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`,
    ].join('\n'));
    process.exitCode = 1;
    return;
  }

  const source = readFileSync(file, 'utf8');
  const result = buildPatchedSource(source, 'web-search-pool');
  if (!result.ok) {
    console.error(`${result.error}：${file}`);
    process.exitCode = 1;
    return;
  }
  if (result.alreadyApplied) {
    console.log(`已包含 "web-search-pool"，无需修改：${file}`);
    return;
  }

  if (!syntaxCheckOk(file, result.output)) {
    process.exitCode = 1;
    return;
  }
  writeFileSync(file + '.bak', source, 'utf8');
  writeFileSync(file, result.output, 'utf8');
  console.log(`已把 "web-search-pool" 加入 WEB_SETTINGS_NAMESPACES：${file}`);
  console.log('备份：' + file + '.bak');
}

// 仅作为主模块时执行 CLI；被测试 import 时只暴露纯函数。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
