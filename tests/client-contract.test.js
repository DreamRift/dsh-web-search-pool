import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * client-contract.test.js
 * 
 * Test the rc.7 Client half contract:
 * - Uses window.__ModuleLoader__.load format
 * - Keyed slot registration with key: 'web-search-pool' (not id:)
 * - exports.apply and inject array present
 */

const clientPath = join(import.meta.dirname, '..', 'src', 'dsh', 'client.js');

test('client contract: uses rc.7 ModuleLoader format', () => {
  const content = readFileSync(clientPath, 'utf-8');
  
  assert.ok(content.includes('window.__ModuleLoader__.load'),
    'client must use window.__ModuleLoader__.load for rc.7 compatibility');
});

test('client contract: keyed slot with key: web-search-pool', () => {
  const content = readFileSync(clientPath, 'utf-8');
  
  // Must use key:, NOT id:
  assert.ok(/key:\s*["']web-search-pool["']/.test(content),
    'slots.register must use key: "web-search-pool" matching settings namespace');
    
  // Verify key: web-search-pool is used for settings.plugin.item
  const hasKeyedSlot = content.includes('key: "web-search-pool"');
  assert.ok(hasKeyedSlot, 'settings.plugin.item slot must use key: "web-search-pool"');
});

test('client contract: does not use legacy id: search-pool for slot', () => {
  const content = readFileSync(clientPath, 'utf-8');
  
  // The legacy rc.6 pattern was: { name: "settings.plugin.item", id: "search-pool", order: 21 }
  // rc.7 requires: { name: "settings.plugin.item", key: "web-search-pool", order: 21 }
  const legacyIdPattern = /register\s*\(\s*\{\s*name:\s*["']settings\.plugin\.item["'][^}]*id:\s*["']search-pool["']/;
  
  assert.ok(!legacyIdPattern.test(content),
    'client must NOT use id: "search-pool" for settings.plugin.item (rc.6 pattern)');
});

test('client contract: has exports.apply and inject', () => {
  const content = readFileSync(clientPath, 'utf-8');
  
  assert.ok(/exports\.apply\s*=/.test(content),
    'client must export apply function');
    
  assert.ok(/exports\.inject\s*=/.test(content),
    'client must export inject array');
    
  const injectMatch = /exports\.inject\s*=\s*\[([\s\S]*?)\]/m.exec(content);
  assert.ok(injectMatch, 'inject array must be defined');
  
  const injectArray = injectMatch[1];
  assert.ok(injectArray.includes('settingsScope'), 'inject must include settingsScope');
  assert.ok(injectArray.includes('slots'), 'inject must include slots');
  assert.ok(injectArray.includes('connection'), 'inject must include connection');
});

test('client contract: factory returns module.exports', () => {
  const content = readFileSync(clientPath, 'utf-8');
  
  assert.ok(/factory:\s*\((require)\)\s*=>\s*{/.test(content),
    'client must have factory function with require parameter');
    
  assert.ok(/return\s+module\.exports/m.test(content),
    'factory must return module.exports at the end');
});

test('client contract: no JSX in client code', () => {
  const content = readFileSync(clientPath, 'utf-8');
  
  // React.createElement calls are fine, but JSX syntax <div> is not
  const jsxPattern = /<[A-Z][a-zA-Z]+(?:\s[^>]*)?>/m;
  
  assert.ok(!jsxPattern.test(content),
    'client must NOT use JSX syntax (React.createElement instead)');
});