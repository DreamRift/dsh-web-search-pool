#!/usr/bin/env node
/**
 * 把 `web-search-pool` 加入 DSH api-proxy 的 settings 暴露白名单。
 *
 * 官方结论（0.1.0-rc.6 源码 + README）：settings.describe/update 只服务白名单内 namespace，
 * 插件仅注册 Settings 不会自动暴露；没有配置扩展点，必须改 `WEB_SETTINGS_NAMESPACES`。
 * DSH 升级会覆盖 npm 安装目录，升级后运行本脚本一次即可恢复。
 *
 * 用法：node scripts/patch-api-proxy-namespace.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const NS = '"web-search-pool"';

function findApiProxyIndex() {
  const candidates = [
    // Windows npm 全局安装
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js'),
    // 显式指定（若 DSH 安装在其他位置）
    process.env.DSH_API_PROXY_INDEX,
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const file = findApiProxyIndex();
if (file === null) {
  console.error('未找到 dsh-host-apiproxy/lib/index.js；可设置 DSH_API_PROXY_INDEX 指定完整路径后重跑。');
  process.exit(1);
}

const source = readFileSync(file, 'utf8');
if (source.includes(NS)) {
  console.log(`已包含 ${NS}，无需修改：${file}`);
  process.exit(0);
}

const anchor = '"web-search-deepseek"';
const idx = source.indexOf(anchor);
if (idx === -1) {
  console.error(`未找到 ${anchor} 白名单锚点，文件结构可能已变化：${file}`);
  process.exit(1);
}

const lineEnd = source.indexOf('\n', idx + anchor.length);
const indent = '\t';
const patched = source.slice(0, lineEnd) + ',' + `\n${indent}${NS}` + source.slice(lineEnd);
writeFileSync(file + '.bak', source, 'utf8');
writeFileSync(file, patched, 'utf8');
console.log(`已把 ${NS} 加入 WEB_SETTINGS_NAMESPACES：${file}`);
console.log('备份：' + file + '.bak');
