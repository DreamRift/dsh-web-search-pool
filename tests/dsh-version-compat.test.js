/**
 * dsh-version-compat.test.js
 *
 * 回归守卫：DSH 0.1.2 删除了 `@deepseek-ai/dsh-settings` 的 installSettingsSection /
 * settingsNamespace / deepEqualJson 导出，以及 `ctx.connection.api`（IApiClient，随
 * dsh-host-apiproxy 一并移除）。
 *
 * 静态命名导入被删符号会在 ESM 链接期抛 SyntaxError，使 loader 无法导入插件，
 * 整棵插件树启动失败 —— 2026-09 的 0.1.2 升级事故即由此产生。这里守住“不得静态导入”。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const hostPath = join(import.meta.dirname, '..', 'src', 'dsh', 'index.js');
const clientPath = join(import.meta.dirname, '..', 'src', 'dsh', 'client.js');

/** 去掉注释行后的可执行代码（注释里可以提到被删符号，不算违规）。 */
function codeOf(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

test('compat: host half must not statically import removed dsh-settings symbols', () => {
  const code = codeOf(readFileSync(hostPath, 'utf-8'));
  // 静态导入（`from '@deepseek-ai/dsh-settings'`）在 0.1.2 会抛 SyntaxError。
  assert.ok(!/from\s+['"]@deepseek-ai\/dsh-settings['"]/.test(code),
    'must not statically import @deepseek-ai/dsh-settings (0.1.2 removed its helpers)');
  assert.ok(!code.includes('import { installSettingsSection'),
    'must not name-import installSettingsSection');
  assert.ok(!code.includes('settingsNamespace('),
    'must not call settingsNamespace() (removed in 0.1.2)');
});

test('compat: host half uses the 0.1.2 installSection API with a legacy fallback', () => {
  const content = readFileSync(hostPath, 'utf-8');
  assert.ok(content.includes('settings.installSection('),
    'host must call settings.installSection() on 0.1.2+');
  assert.ok(/import\(['"]@deepseek-ai\/dsh-settings['"]\)/.test(content),
    'legacy helper must be reached through a dynamic import');
  assert.ok(content.includes('installSettingsSection'),
    'legacy 0.1.1-rc.x path must remain reachable');
});

test('compat: settings namespace is a plain string', () => {
  const content = readFileSync(hostPath, 'utf-8');
  assert.ok(content.includes("export const SETTINGS_NAMESPACE = 'web-search-pool'"),
    'SETTINGS_NAMESPACE must be a plain lowercase string');
});

test('compat: client half must not depend on ctx.connection.api', () => {
  const content = readFileSync(clientPath, 'utf-8');
  assert.ok(!content.includes('connection.api ? connection.api : null'),
    'must not hard-depend on connection.api (removed in 0.1.2)');
  assert.ok(content.includes('credentials.describe') && content.includes('credentials.set'),
    'client must describe/set credentials over Remote');
});

test('compat: client half must inject remote namespaces before touching them', () => {
  const content = readFileSync(clientPath, 'utf-8');
  // cordis 服务名是 `remote.<namespace>`：不 inject 直接访问会抛
  // `cannot get property "remote.credentials" without inject`（0.2.0 首版的线上报错）。
  assert.ok(!/ctx\.get\("remote"\)/.test(content),
    'must not reach remote via ctx.get — cordis requires the namespace in inject');
  assert.ok(content.includes('ctx.inject(["remote", "remote.credentials"]'),
    'client must scoped-inject remote + remote.credentials');
  assert.ok(!/exports\.inject\s*=\s*\[[^\]]*"remote"/.test(content),
    'remote must stay a scoped inject so 0.1.1-rc.x (no remote service) still loads');
});

test('compat: client half prefers settingsScope.mutate for writes', () => {
  const content = readFileSync(clientPath, 'utf-8');
  assert.ok(content.includes('typeof scope.mutate === "function"'),
    'client must feature-detect scope.mutate (0.1.2 transaction write path)');
  assert.ok(content.includes('scope.mutate(ops)'),
    'client must route settings writes through scope.mutate(ops)');
});

test('compat: web row sync preserves fetchProvider', () => {
  const content = readFileSync(hostPath, 'utf-8');
  assert.ok(content.includes('fetchProvider'),
    'host must restate fetchProvider when syncing the include:web row');
  assert.ok(content.includes('readWebRowConfig'),
    'host must merge the live web-row config instead of overwriting it');
});
