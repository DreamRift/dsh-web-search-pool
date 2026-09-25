#!/usr/bin/env node
/**
 * 把 DSH 0.1.7-rc.2（app.asar 提取副本）里插件测试需要的 @deepseek-ai peer 包
 * 按 import 传递闭包拷贝到工作区插件的 node_modules（node_modules 已 gitignore）。
 *
 * 用法：node scripts/sync-peer-deps.mjs <asar-extract-dir>
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'node_modules', '@deepseek-ai');
const asarRoot = process.argv[2];
if (!asarRoot) {
  console.error('usage: node scripts/sync-peer-deps.mjs <asar-extract-dir>');
  process.exit(1);
}
const asarModules = join(asarRoot, 'dsh', 'node_modules');
if (!existsSync(asarModules)) {
  console.error(`not a dsh asar extract: ${asarRoot}`);
  process.exit(1);
}

const SEEDS = ['cordis', 'cosmokit', 'schemastery', 'dsh-web', 'dsh-credentials', 'dsh-launch-environment'];

function packageDir(scope, name) {
  const candidates = [
    join(asarModules, '@deepseek-ai', name),
    join(asarModules, name),
  ];
  for (const dir of candidates) if (existsSync(join(dir, 'package.json'))) return dir;
  return undefined;
}

function importsOf(dir) {
  const found = new Set();
  const walk = (current) => {
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
      let text;
      try { text = readFileSync(full, 'utf8'); } catch { continue; }
      for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)['"](@deepseek-ai\/[a-z0-9._-]+)['"]/g)) {
        found.add(match[1].slice('@deepseek-ai/'.length));
      }
    }
  };
  walk(dir);
  return found;
}

const needed = new Set();
const queue = [...SEEDS];
while (queue.length > 0) {
  const name = queue.shift();
  if (needed.has(name)) continue;
  const dir = packageDir('@deepseek-ai', name);
  if (dir === undefined) { console.error(`missing in asar: @deepseek-ai/${name}`); continue; }
  needed.add(name);
  for (const dep of importsOf(dir)) if (!needed.has(dep)) queue.push(dep);
}

console.log(`closure (${needed.size}): ${[...needed].sort().join(', ')}`);

mkdirSync(srcRoot, { recursive: true });
for (const name of needed) {
  const src = packageDir('@deepseek-ai', name);
  const dest = join(srcRoot, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`  <- @deepseek-ai/${name}`);
}

// schemastery 依赖 @standard-schema/spec
const specSrc = join(asarModules, '@standard-schema', 'spec');
if (existsSync(specSrc)) {
  const specDest = join(here, '..', 'node_modules', '@standard-schema', 'spec');
  rmSync(specDest, { recursive: true, force: true });
  mkdirSync(dirname(specDest), { recursive: true });
  cpSync(specSrc, specDest, { recursive: true });
  console.log('  <- @standard-schema/spec');
}
console.log('done');
