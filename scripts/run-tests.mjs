#!/usr/bin/env node
/**
 * 同一进程内按文件名顺序运行全部 tests/*.test.js。
 *
 * 背景：`node --test tests/`（npm test）在 Windows 沙箱下会因 test runner 需要
 * spawn 子进程而报 `spawn EPERM`；本 runner 不 spawn 任何子进程，跨平台可用。
 *
 * 说明：node:test 的 inline runner 对 test() 按注册顺序串行执行，跨文件只需
 * 顺序 import 即可保证执行顺序；各测试文件自身的 fetch 猴补丁有保存/恢复。
 *
 * 用法：node scripts/run-tests.mjs
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const testsDir = join(scriptsDir, '..', 'tests');

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error('未找到任何 tests/*.test.js');
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  console.log(`▶ ${name}`);
  try {
    await import(pathToFileURL(join(testsDir, name)).href);
  } catch (error) {
    failed += 1;
    console.error(`✖ ${name} 加载失败: ${error?.stack ?? error}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} 个测试文件加载失败`);
  process.exitCode = 1;
}
