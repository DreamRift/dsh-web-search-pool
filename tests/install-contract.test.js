import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * install-contract.test.js
 * 
 * Test npm package installation contract:
 * - peerDependencies must use specific versions (not *)
 * - files array excludes tests/, .env, .credentials.yaml
 */

const pkgJsonPath = join(import.meta.dirname, '..', 'package.json');

test('install contract: peerDependencies cannot use wildcard', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const deps = pkg.peerDependencies || {};
  
  for (const [dep, version] of Object.entries(deps)) {
    if (version === '*') {
      assert.fail('peerDependency ' + dep + ' cannot use wildcard *, must specify exact version');
    }
    
    // Verify dual-line targeting: the rc.7 line plus the 0.1.2 line that removed
    // installSettingsSection/settingsNamespace and ctx.connection.api.
    if (dep.startsWith('@deepseek-ai/dsh-')) {
      assert.ok(version.includes('^0.1.2-rc.1'),
        'DSH dependency ' + dep + ' must accept the 0.1.2 line: ' + version);
    }
  }
});

test('install contract: removed packages must not be referenced', () => {
  // dsh-client-runtime and dsh-host-apiproxy stopped publishing after 0.1.1-rc.2;
  // naming them in peers or dsh.client.inject would break resolution on 0.1.2+.
  const raw = readFileSync(pkgJsonPath, 'utf-8');
  assert.ok(!raw.includes('dsh-client-runtime'),
    'package.json must not reference @deepseek-ai/dsh-client-runtime (removed in 0.1.2)');
  assert.ok(!raw.includes('dsh-host-apiproxy'),
    'package.json must not reference @deepseek-ai/dsh-host-apiproxy (removed in 0.1.2)');
});

test('install contract: files array must include cordis.patch.yml and client.js', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  
  assert.ok(Array.isArray(pkg.files), 'files must be an array');
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files must include cordis.patch.yml');
  
  // src/ is a directory containing client.js
  const includesClient = pkg.files.some(f => f.includes('client.js') || f === 'src/');
  assert.ok(includesClient, 'files must include src/dsh/client.js (via src/ directory or explicit path)');
});

test('install contract: files should NOT include credentials or env', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  
  for (const entry of pkg.files) {
    assert.ok(!entry.includes('.credentials'),
      'files must not include credentials file: ' + entry);
    assert.ok(!entry.includes('.env'),
      'files must not include .env file: ' + entry);
  }
});

test('install contract: exports field has ./client', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  
  assert.ok(pkg.exports && pkg.exports['./client'] === './src/dsh/client.js',
    "exports['./client'] must point to ./src/dsh/client.js");
});

test('install contract: dsh.bundle.patch field exists', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  
  assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'dsh.bundle.patch must exist in package.json');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml',
    'dsh.bundle.patch must point to ./cordis.patch.yml');
});

test('install contract: files should exclude tests directory', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  
  // Production package should not include tests/
  assert.ok(!pkg.files.some(f => f.startsWith('tests/')),
    'production package should exclude tests/');
});
