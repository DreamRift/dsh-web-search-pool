/**
 * dsh-version-compat.test.js
 *
 * 版本兼容与装配契约（0.3.0 重生，替代 0.1.2 时代的旧守卫）。
 *
 * 历史事故线：
 * - 0.1.2 删除 `@deepseek-ai/dsh-settings` 的 installSettingsSection 等导出，
 *   静态命名导入会在 ESM 链接期抛 SyntaxError，loader 无法导入插件、整棵树启动失败；
 * - 0.1.7 又删除了 `settings.installSection`（设置表单改由 loader 行 Config schema
 *   自动投影，namespace = 行 id）、client 的 `settingsScope` 服务（0.2.1 的 web boot
 *   崩溃根因）、`settings.plugin.item` slot（改 plugins.row.config）、`include:web`
 *   行 id（改根组 `web`）。
 *
 * 本测试守住四类不能靠手 review 保证的事实：
 * 1. peer 范围 vs 运行时（DSH 启动时的兼容门：不满足 → bundle 层被整体跳过）；
 * 2. bundle patch 的目标行 id 与 restate 语义；
 * 3. package.json 的 dsh 装配字段（bundle.patch / client.platform / client.inject）；
 * 4. Config schema 的 volatile 形态（0.1.7 表单投影 + Ref 运行期）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Config } from '../src/dsh/config.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (rel) => readFileSync(here + rel, 'utf8');
const pkg = JSON.parse(read('../package.json'));

/** 去掉注释后的可执行代码（YAML 的 # 注释与 JS 的 * // / * 注释；注释里可以提到被删符号，不算违规）。 */
function codeOf(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*|#)/.test(line))
    .join('\n');
}

/** 插件声明支持的 DSH 运行时（桌面版 0.1.7-rc.2 实测线）。 */
const RUNTIMES = ['0.1.7-rc.1', '0.1.7-rc.2', '0.1.7'];

// ── 迷你 semver：只覆盖本插件用到的范围形式（^ / ~ / 精确 / || 联合），
//    prerelease 按 DSH 的 includePrerelease 语义比较。 ──
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  assert.ok(match, `invalid semver in test: ${value}`);
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // 无 prerelease 的版本更大
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return Math.sign(diff);
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index++) {
    const diff = a.numbers[index] - b.numbers[index];
    if (diff !== 0) return Math.sign(diff);
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** 单个比较器（^ / ~ / 精确）的判定。 */
function satisfiesComparator(version, comparator) {
  const trimmed = comparator.trim();
  if (trimmed === '' || trimmed === '*') return true;
  const bound = parseVersion(trimmed.replace(/^[\^~]/, ''));
  const compare = compareVersions(parseVersion(version), bound);
  if (trimmed.startsWith('^')) {
    if (compare < 0) return false;
    const [major, minor] = bound.numbers;
    const upper = major > 0
      ? [major + 1, 0, 0]
      : minor > 0 ? [0, minor + 1, 0] : [0, 0, bound.numbers[2] + 1];
    return compareVersions(parseVersion(version), { numbers: upper, prerelease: [] }) < 0;
  }
  if (trimmed.startsWith('~')) {
    if (compare < 0) return false;
    const upper = [bound.numbers[0], bound.numbers[1] + 1, 0];
    return compareVersions(parseVersion(version), { numbers: upper, prerelease: [] }) < 0;
  }
  return compare === 0;
}

/** DSH `evaluatePluginCompatibility` 的 satisfies(range, version, {includePrerelease}) 最小实现。 */
function satisfies(version, range) {
  return range.split('||').some((part) => satisfiesComparator(version, part));
}

test('compat: 所有 dsh* peer 范围满足受支持的运行时', () => {
  const peers = Object.entries(pkg.peerDependencies)
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'));
  assert.ok(peers.length > 0, 'plugin must declare dsh peer dependencies');
  for (const [name, range] of peers) {
    for (const runtime of RUNTIMES) {
      assert.equal(satisfies(runtime, range), true, `${name}@${range} must satisfy dsh ${runtime}`);
    }
  }
  // 老化/越界运行时必须被拒绝（防止范围意外放宽）。
  assert.equal(satisfies('0.1.6', pkg.peerDependencies['@deepseek-ai/dsh-web']), false, '0.1.6 is below the declared floor');
  assert.equal(satisfies('0.2.0', pkg.peerDependencies['@deepseek-ai/dsh-web']), false, '0.2.0 is outside the declared range');
});

test('compat: bundle patch 目标为 0.1.7 的 web 行并 restate fetchProvider', () => {
  const patch = codeOf(read('../cordis.patch.yml'));
  assert.match(patch, /- id: web\n/, 'patch must target the root-level web row');
  assert.match(patch, /searchProvider: search-pool/, 'patch must select the search-pool provider');
  assert.match(patch, /fetchProvider: http/, 'patch must restate fetchProvider (id-targeted patch replaces the whole config)');
  assert.equal(patch.includes('include:web'), false, '0.1.7 no longer nests the web row in include:');
  assert.match(patch, /- id: web-search-pool\n/, 'patch must insert the provider row');
  assert.match(patch, /name: dsh-web-search-pool/, 'provider row mounts the package entry');
});

test('compat: package.json 的 dsh 装配字段', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  for (const required of [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
  ]) {
    assert.ok(pkg.dsh.client.inject.includes(required), `dsh.client.inject must list ${required}`);
  }
  assert.equal(pkg.exports['./client'], './src/dsh/client.js', 'client bundle export required by client-modules');
});

test('compat: host half 不得静态导入已删除的 settings API', () => {
  const code = codeOf(read('../src/dsh/index.js'));
  assert.equal(code.includes("from '@deepseek-ai/dsh-settings'"), false,
    'must not statically import @deepseek-ai/dsh-settings (0.1.2 link-time SyntaxError)');
  assert.equal(code.includes('installSettingsSection'), false,
    'installSettingsSection/installSection were removed (0.1.2 / 0.1.7)');
  assert.match(code, /loader\/volatile-update/, 'host must observe volatile config updates');
  assert.match(code, /export const SETTINGS_NAMESPACE = 'web-search-pool'/,
    'SETTINGS_NAMESPACE must be the loader row id (0.1.7 form namespace)');
});

test('compat: web 行同步保留 fetchProvider 且探测两个行 id', () => {
  const code = codeOf(read('../src/dsh/index.js'));
  assert.ok(code.includes('fetchProvider'), 'host must restate fetchProvider when syncing the web row');
  assert.ok(code.includes('readWebRowConfig'), 'host must merge the live web-row config instead of overwriting it');
  assert.ok(code.includes("WEB_ROW_IDS"), 'host must probe the web row id (web for 0.1.7, include:web for older hosts)');
});

test('compat: Config schema 的 volatile 形态（表单投影 + Ref 运行期）', () => {
  for (const field of ['enabled', 'providers', 'strategy', 'providerPriority', 'allowedFails', 'cooldownMs', 'retryAfterFallbackMs', 'usageCacheMs', 'quotaReserveCredits', 'quotaExhaustedCooldownMs', 'requestTimeoutMs']) {
    assert.equal(Config.dict[field].meta.volatile, true, `${field} must be volatile for the settings form`);
  }
  // 0.1.7 的运行期投影：validate 后 volatile 字段是 Ref（cosmokit volatile 协议）。
  const result = Config['~standard'].validate({});
  assert.equal(result.issues, undefined, 'empty config must validate through defaults');
  const value = result.value;
  assert.equal(typeof value.enabled.get, 'function', 'enabled resolves to a Ref');
  assert.equal(value.enabled.get(), true);
  assert.equal(typeof value.providers.get, 'function', 'providers resolves to a Ref');
  assert.deepEqual(value.providers.get().tavily.keys, []);
  assert.equal(value.strategy.get(), 'weighted-round-robin');
  assert.equal(value.requestTimeoutMs.get(), 20000);
});


