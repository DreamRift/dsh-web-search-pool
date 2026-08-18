import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * bundle-contract.test.js
 * 
 * Test the rc.7 Bundle contract:
 * - package.json has dsh.bundle.patch field
 * - cordis.patch.yml exists and has correct structure
 * - provider id matches between patch and implementation
 */

const pkgJsonPath = join(import.meta.dirname, '..', 'package.json');
const patchYmlPath = join(import.meta.dirname, '..', 'cordis.patch.yml');
const providerIndexPath = join(import.meta.dirname, '..', 'src', 'dsh', 'index.js');
const providerPath = join(import.meta.dirname, '..', 'src', 'dsh', 'provider.js');

test('bundle contract: package.json has dsh.bundle.patch', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  
  assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'package.json must declare dsh.bundle.patch');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml', 'patch field must point to ./cordis.patch.yml');
});

test('bundle contract: cordis.patch.yml exists and has correct structure', () => {
  const content = readFileSync(patchYmlPath, 'utf-8');
  
  assert.ok(content.length > 0, 'cordis.patch.yml must exist and not be empty');
  assert.ok(content.includes('- id: web'), 'patch must override web row');
  assert.ok(content.includes('searchProvider: search-pool'), 'web row must set searchProvider to search-pool');
  assert.ok(content.includes('insert:'), 'patch must have insert section');
  assert.ok(content.includes('id: web-search-pool'), 'must insert web-search-pool provider row');
});

test('bundle contract: provider id consistency', () => {
  const patchContent = readFileSync(patchYmlPath, 'utf-8');
  const indexContent = readFileSync(providerIndexPath, 'utf-8');
  const providerContent = readFileSync(providerPath, 'utf-8');
  
  // 1. Plugin name must be web-search-pool (for settings namespace)
  assert.ok(indexContent.includes("export const name = 'web-search-pool'"),
    'plugin name must be web-search-pool (for settings namespace)');
  
  // 2. SEARCH_POOL_PROVIDER_ID must be defined in provider.js
  assert.ok(providerContent.includes("export const SEARCH_POOL_PROVIDER_ID = 'search-pool'"),
    'provider must export SEARCH_POOL_PROVIDER_ID = search-pool');
  
  // 3. Re-exported from index.js
  assert.ok(indexContent.includes('SEARCH_POOL_PROVIDER_ID'),
    'index.js must re-export SEARCH_POOL_PROVIDER_ID');
  
  // 4. Patch must agree on the same provider id
  assert.ok(patchContent.includes('searchProvider: search-pool'),
    'cordis.patch.yml must use searchProvider: search-pool');
});

test('bundle contract: peerDependencies must use specific versions', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const deps = pkg.peerDependencies || {};
  
  for (const [dep, version] of Object.entries(deps)) {
    assert.notEqual(version, '*',
      'peerDependency ' + dep + ' cannot use wildcard *, must specify exact version');
  }
});

test('bundle contract: files array includes cordis.patch.yml', () => {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  assert.ok(Array.isArray(pkg.files), 'files must be an array');
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files must include cordis.patch.yml');
});
