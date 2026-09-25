#!/usr/bin/env node
/**
 * E2E 验证：用 DSH 桌面版自带的真实运行时（@deepseek-ai/dsh-app-boot + vendored
 * Loader + 运行时模块解析拦截）在一个**隔离的临时 profile** 里启动整棵宿主树，
 * 验证 0.1.7 适配的关键链路，不碰用户正在运行的 desktop profile。
 *
 * 验证点：
 *  1. profile 加载无 skippedBundles（peer 兼容门通过、bundle patch 层被应用）；
 *  2. 官方 `web` 行被 patch 改写：searchProvider=search-pool 且 fetchProvider 保留；
 *  3. `web-search-pool` loader 行 ACTIVE（host half apply 成功、provider 注册）；
 *  4. `settings.describe()` 出现 `web-search-pool` namespace 且投影出全部可编辑字段
 *     （0.1.7 的 Config schema 自动表单）；
 *  5. `settings.update(ns, {enabled:false})` 端到端：profile patch 写入 → volatile
 *     就地提交（不重挂）→ web 行选择同步回 deepseek-official。
 *
 * 用法：
 *   node scripts/e2e-boot.mjs <app.asar 提取目录> [插件 tgz] [--user-patch <cordis.patch.yml>]
 *   DSH_E2E_HOME=<目录> 可指定隔离 home（默认系统临时目录下的 dsh-e2e-<pid>）
 *
 * `--user-patch` 把一份真实的用户 patch 层（如桌面版 profile 的 cordis.patch.yml）
 * 复制为测试 profile 的用户层，验证它与 0.1.7 + 本插件的组合能干净编译并生效；
 * 此时会追加断言：用户层里的 `web-search-pool` 行配置完整覆盖 bundle 默认值。
 *
 * 前置：app.asar 提取目录（含 dsh/node_modules/@deepseek-ai/dsh-app-boot）。
 *       本机可用 resources/app.asar + python 侧的 asar 读取脚本自行提取；
 *       提取目录路径不含个人盘符假设，由参数传入。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..');

const asarExtract = process.argv[2];
if (!asarExtract) {
  console.error('usage: node scripts/e2e-boot.mjs <app.asar 提取目录> [插件 tgz]');
  process.exit(2);
}
const appBootModules = join(asarExtract, 'dsh', 'node_modules');
if (!existsSync(join(appBootModules, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'))) {
  console.error(`不是有效的 app.asar 提取目录: ${asarExtract}`);
  process.exit(2);
}

// ── 1. 隔离 home + profile ──
// 关键安全边界：DSH 运行时的 home 解析读 `$DSH_HOME`，必须在 import 任何 app 模块前
// 指向隔离目录，否则 E2E 会读写用户真实的 ~/.dsh。
const userPatchIndex = process.argv.indexOf('--user-patch');
const userPatchFile = userPatchIndex >= 0 ? process.argv[userPatchIndex + 1] : undefined;
if (userPatchIndex >= 0 && !userPatchFile) {
  console.error('--user-patch 需要一个 cordis.patch.yml 路径');
  process.exit(2);
}
const home = process.env.DSH_E2E_HOME ?? mkdtempSync(join(tmpdir(), 'dsh-e2e-'));
process.env.DSH_HOME = home;
const profileName = 'e2e';
const profileDir = join(home, 'profiles', profileName);
const { mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
mkdirSync(profileDir, { recursive: true });
writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n');
// 用户层：默认空数组（initProfile 的模板内容）；--user-patch 复制真实 patch 进来。
writeFileSync(join(profileDir, 'cordis.patch.yml'), userPatchFile ? readFileSync(userPatchFile, 'utf8') : '[]\n');
if (userPatchFile) console.log(`e2e: 使用真实用户 patch 层: ${userPatchFile}`);

// ── 2. 安装插件 tgz（官方安装方式：profile 内 pnpm add）──
// 位置参数：argv[2]=asar 提取目录，argv[3]=tgz（可省略，省略则现场 npm pack）；
// --user-patch 及其值不计入位置参数。
let tgz = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
if (!tgz) {
  const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', home, '--silent'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DSH_E2E_HOME: home },
  });
  if (pack.status !== 0) {
    console.error('npm pack 失败');
    process.exit(1);
  }
  const pkg = JSON.parse(spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DSH_E2E_HOME: home },
  }).stdout);
  const filename = JSON.parse(pkg)[0].filename;
  tgz = join(home, filename);
}
console.log(`e2e: 安装 ${tgz} -> ${profileDir}`);
// pnpm 定位顺序：DSH_E2E_PNPM 环境变量 → app resources 下的内置 pnpm（asar 提取目录的
// 兄弟目录）→ PATH 上的 pnpm（shell: true，Windows 的 .cmd 需要 shell 才能 spawn）。
const appResources = process.env.DSH_APP_RESOURCES ?? pathResolve(asarExtract, '..');
const pnpmCandidates = [
  process.env.DSH_E2E_PNPM,
  join(appResources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
].filter(Boolean);
let add;
for (const candidate of pnpmCandidates) {
  if (!existsSync(candidate)) continue;
  const useNode = candidate.endsWith('.mjs');
  add = useNode
    ? spawnSync(process.execPath, [candidate, 'add', tgz], { cwd: profileDir, stdio: 'inherit' })
    : spawnSync(candidate, ['add', tgz], { cwd: profileDir, stdio: 'inherit', shell: true });
  break;
}
add ??= spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['add', tgz], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: true,
});
if (add.status !== 0) {
  console.error('pnpm add 失败');
  process.exit(1);
}

// ── 3. bundles 登记（plugin-manager 的 selectBundle 等价物）──
const manifestPath = join(profileDir, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
// dsh-web-app 挂上 client 行（modules/connection/api-remotes…），用于验证
// client-modules 图谱会真正下发本插件的浏览器 bundle（“设置页有卡片”的端到端）。
manifest.dsh = { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-web-search-pool'] } };
writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n');

// ── 4. 启动真实宿主树 ──
const { loadProfile } = await import(pathToFileURL(join(appBootModules, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')).href);
const { runProfile } = await import(pathToFileURL(join(asarExtract, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'profile-boot.js')).href);
const { loadLayeredEnv } = await import(pathToFileURL(join(appBootModules, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')).href);

const loaded = loadProfile('e2e', profileName, join(asarExtract, 'dsh', 'package.json'), home);
console.log('e2e: skippedBundles =', JSON.stringify(loaded.skippedBundles));
assert.deepEqual(loaded.skippedBundles, [], 'bundle 层必须全部加载（peer 兼容门 + bundle.patch）');

console.log('e2e: booting profile...');
const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv('e2e'),
  profile: profileName,
  patchFiles: [],
  args: [],
});

const failures = [];
try {
  // ── 5. bundle patch 生效 ──
  // loader 行完整 id 在 0.1.7 是 include:web（root config 挂在 include 组下）；
  // bundle patch 按短 id `web` 匹配。两者都探测一次，防止版本漂移。
  const resolveRow = (ids) => {
    for (const id of ids) {
      try { return ctx.loader.resolve(id); } catch { /* 试下一个 */ }
    }
    throw new Error(`cannot resolve any of ${ids.join(', ')}`);
  };
  const webRow = resolveRow(['web', 'include:web']);
  console.log('e2e: web row config =', JSON.stringify(webRow.options.config));
  assert.equal(webRow.options.config.searchProvider, 'search-pool', 'web.searchProvider 必须被 patch 改写');
  assert.equal(webRow.options.config.fetchProvider, 'http', 'web.fetchProvider 必须保留');

  // ── 6. 插件行 ACTIVE ──
  const poolEntry = resolveRow(['web-search-pool', 'include:web-search-pool']);
  assert.ok(poolEntry?.fiber, 'web-search-pool 行必须有 fiber');
  assert.equal(poolEntry.fiber.state, 2, 'web-search-pool 行必须 ACTIVE');
  console.log('e2e: web-search-pool ACTIVE, enabled =', poolEntry.fiber.config.enabled.get());

  // ── 6b. --user-patch 模式：用户层完整覆盖 bundle 行配置 ──
  if (userPatchFile) {
    const config = poolEntry.options.config;
    const tavilyKeys = config.providers?.tavily?.keys ?? [];
    const exaKeys = config.providers?.exa?.keys ?? [];
    assert.equal(tavilyKeys.length, 3, '用户层必须带入 3 个 Tavily key');
    assert.deepEqual(tavilyKeys.map((k) => k.apiKeyEnv), ['TAVILY_API_KEY_1', 'TAVILY_API_KEY_2', 'TAVILY_API_KEY_3']);
    assert.equal(exaKeys.length, 1, '用户层必须带入 1 个匿名 Exa key');
    assert.equal(exaKeys[0].apiKeyEnv ?? '', '', 'Exa key 必须留空（匿名免费层）');
    assert.equal(config.strategy, 'weighted-round-robin');
    assert.equal(config.requestTimeoutMs, 20000);
    // 运行时字段（0.3.0 已从 schema 移除）不得混进行配置。
    for (const runtimeField of ['usage', 'usageDiagnostic', 'usageRefreshTick']) {
      assert.equal(Object.hasOwn(config, runtimeField), false, `行配置不得包含已移除的运行时字段 ${runtimeField}`);
    }
    console.log('e2e: 用户层 patch 编译通过并完整覆盖行配置（3 Tavily + 1 匿名 Exa）');
  }

  // ── 7. settings.describe 投影 ──
  const settingsEntry = resolveRow(['settings', 'include:settings']);
  const settings = settingsEntry.fiber.ctx.get('settings');
  const forms = settings.describe();
  const form = forms.find((row) => row.ns === 'web-search-pool');
  assert.ok(form, 'settings.describe 必须包含 web-search-pool namespace');
  console.log('e2e: settings form value =', JSON.stringify(form.value));
  for (const field of ['enabled', 'providers', 'strategy', 'providerPriority', 'allowedFails', 'requestTimeoutMs']) {
    assert.ok(Object.hasOwn(form.value, field), `form value must project ${field}`);
  }
  assert.equal(form.value.enabled, true);

  // ── 8. settings.update 端到端（patch 写入 + volatile 就地提交 + web 行同步）──
  const fiberBefore = poolEntry.fiber;
  await settings.update('web-search-pool', { enabled: false });
  await ctx.get('loader').await();
  assert.equal(poolEntry.fiber, fiberBefore, 'volatile 更新不得重挂插件');
  assert.equal(poolEntry.fiber.config.enabled.get(), false, 'volatile Ref 必须就地更新');
  assert.equal(resolveRow(['web', 'include:web']).options.config.searchProvider, 'deepseek-official', '关闭开关必须同步 web 行');
  const patchText = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.match(patchText, /id: web-search-pool/, 'profile patch 必须落盘 volatile 值');
  assert.match(patchText, /enabled: false/, 'profile patch 必须记录 enabled: false');
  console.log('e2e: settings.update 端到端通过（不重挂 + web 行同步 + patch 落盘）');

  // 恢复开启，验证反向同步。
  await settings.update('web-search-pool', { enabled: true });
  await ctx.get('loader').await();
  assert.equal(poolEntry.fiber.config.enabled.get(), true);
  assert.equal(resolveRow(['web', 'include:web']).options.config.searchProvider, 'search-pool', '重新开启必须同步回 search-pool');

  // ── 9. client-modules 图谱下发本插件的浏览器 bundle ──
  // 0.2.1 的“无插件页面/重启报错”最终的表现就是浏览器侧 entry 起不来；
  // 这里验证 0.1.7 的 client module 系统会把插件 bundle 编排进启动图谱。
  const modulesEntry = resolveRow(['modules', 'include:modules']);
  const clientModules = modulesEntry.fiber.ctx.get('clientModules');
  const graph = clientModules.graph();
  const clientRow = graph.entries.find((row2) => row2.id === 'dsh-web-search-pool');
  assert.ok(clientRow, 'client-modules graph must serve dsh-web-search-pool');
  console.log('e2e: client graph row =', JSON.stringify({ id: clientRow.id, inject: clientRow.inject }));
  assert.deepEqual([...clientRow.inject].sort(), [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
    '@deepseek-ai/dsh-client-ui-settings',
  ], 'client graph row must declare the official arrival inject list');

  console.log('\ne2e: ALL CHECKS PASSED');
} catch (error) {
  failures.push(error);
  console.error('\ne2e FAILED:', error?.message ?? error);
} finally {
  await shutdown.shutdown(0);
}

if (failures.length > 0) process.exit(1);
if (!process.env.DSH_E2E_HOME) rmSync(home, { recursive: true, force: true });
