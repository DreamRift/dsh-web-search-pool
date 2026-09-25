/**
 * client-contract.test.js
 *
 * 0.1.7 的 client half 契约（0.3.0 起重写，替代 rc.7/0.1.2 的旧契约）：
 *
 * 背景事故：0.2.1 的 client half 在 `exports.inject` 里等 `settingsScope`
 *（0.1.2 的服务，0.1.7 已移除），浏览器端 loader entry 永远 pending，
 * web boot 直接失败（桌面版日志实证：
 * `dsh-web-search-pool: pending (waiting for service: settingsScope)`），
 * 表现为「重启 dsh 报错 + 设置页没有插件卡片」。
 *
 * 本测试把 `src/dsh/client.js` 当浏览器 bundle 真实执行：
 * 1. `vm` 编译通过（语法 + CJS factory 形态）；
 * 2. 在 stub 的 `window.__ModuleLoader__` 里以**包名**注册；
 * 3. 物化 factory（stub `require("react")` + stub `document`）；
 * 4. 用 stub ctx 跑 `apply(ctx)`，断言 0.1.7 注册面：
 *    - **`plugins.row.config`** keyed slot（key = `<包名>#<行 id>`），
 *      取代旧的 `settings.plugin.item` keyed slot；
 *    - 数据面 **`configForms`**（`get(ns)` + `whileServed`），取代 settingsScope；
 *    - `exports.inject` = slots / remote / remote.credentials / configForms；
 *    - 凭据走 Typert Remote（`remote.credentials` describe/set）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const clientPath = fileURLToPath(new URL('../src/dsh/client.js', import.meta.url));
const source = readFileSync(clientPath, 'utf8');
/** 去掉注释后的可执行代码（注释里可以提到历史机制名，不算违规）。 */
const code = source.split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line)).join('\n');

const SETTINGS_NS = 'web-search-pool';
const ROW_CONFIG_KEY = 'dsh-web-search-pool#web-search-pool';

test('client contract: uses the ModuleLoader registration format', () => {
  assert.ok(source.includes('window.__ModuleLoader__.load'),
    'client must use window.__ModuleLoader__.load for the client module system');
  assert.ok(source.includes('id: "dsh-web-search-pool"'),
    'registration id must be the package name (client-modules graph row id)');
  assert.ok(/factory:\s*\((require)\)\s*=>\s*{/.test(source),
    'client must have factory function with require parameter');
  assert.ok(/return\s+module\.exports/m.test(source),
    'factory must return module.exports at the end');
});

test('client contract: no JSX in client code', () => {
  const jsxPattern = /<[A-Z][a-zA-Z]+(?:\s[^>]*)?>/m;
  assert.ok(!jsxPattern.test(source),
    'client must NOT use JSX syntax (React.createElement instead)');
});

test('client contract: registers into plugins.row.config with the row key', () => {
  assert.ok(code.includes('name: "plugins.row.config"'),
    'slot name must be plugins.row.config (0.1.7 plugin-manager slot)');
  assert.ok(code.includes('key: ROW_CONFIG_KEY'),
    'slot key must come from ROW_CONFIG_KEY');
  assert.equal(code.includes('settings.plugin.item'), false,
    'settings.plugin.item was replaced by plugins.item / plugins.row.config in 0.1.7');
});

test('client contract: data plane uses configForms, not settingsScope', () => {
  assert.ok(code.includes('ctx.configForms.get(SETTINGS_NS)'),
    'client must read the namespace form through configForms');
  assert.ok(code.includes('ctx.configForms.whileServed([SETTINGS_NS]'),
    'registration must be gated by whileServed (namespace served by the Host)');
  assert.ok(code.includes('scope.mutate('),
    'writes must go through the form mutate transaction');
  assert.equal(/ctx\.settingsScope/.test(code), false,
    'ctx.settingsScope was removed in 0.1.7 (the 0.2.1 crash root cause)');
});

test('client contract: inject declares the 0.1.7 services', () => {
  const injectMatch = /exports\.inject\s*=\s*\[([\s\S]*?)\]/m.exec(code);
  assert.ok(injectMatch, 'inject array must be defined');
  const injectArray = injectMatch[1];
  for (const required of ['slots', 'remote', 'remote.credentials', 'configForms']) {
    assert.ok(injectArray.includes(`"${required}"`), `inject must include ${required}`);
  }
  assert.equal(injectArray.includes('settingsScope'), false,
    'inject must not name the removed settingsScope service');
  assert.equal(injectArray.includes('connection'), false,
    'connection was removed with dsh-host-apiproxy in 0.1.2');
});

test('client contract: credentials go through the remote namespace', () => {
  assert.ok(code.includes('credentials.describe') && code.includes('credentials.set'),
    'client must describe/set credentials over Remote');
  assert.ok(!/ctx\.get\(["']remote["']\)/.test(code),
    'must not reach remote via ctx.get — cordis requires the namespace in inject');
  assert.ok(code.includes('ctx.inject(["remote", "remote.credentials"]'),
    'client must scoped-inject remote + remote.credentials');
});

test('client contract: vm 编译通过（浏览器 bundle 语法）', () => {
  const script = new vm.Script(source, { filename: 'client.js' });
  assert.ok(script, 'client.js compiles');
});

test('client contract: factory registers under the package name', () => {
  const registrations = [];
  const sandbox = {
    console,
    document: {
      createElement: () => ({ dataset: {}, style: {} }),
      head: { appendChild() {} },
      querySelector: () => null,
    },
    window: {
      __ModuleLoader__: { load: (registration) => registrations.push(registration) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  assert.equal(registrations.length, 1, 'exactly one module registration');
  assert.equal(registrations[0].id, 'dsh-web-search-pool');

  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
  };
  const clientExports = registrations[0].factory(() => reactStub);
  assert.equal(typeof clientExports.apply, 'function');
  assert.deepEqual([...clientExports.inject], ['slots', 'remote', 'remote.credentials', 'configForms']);
});

test('client contract: apply registers the settings card for the plugin row', () => {
  const registrations = [];
  const sandbox = {
    console,
    document: {
      createElement: () => ({ dataset: {}, style: {} }),
      head: { appendChild() {} },
      querySelector: () => null,
    },
    window: {
      __ModuleLoader__: { load: (registration) => registrations.push(registration) },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
  };
  const clientExports = registrations[0].factory(() => reactStub);

  const injected = [];
  const slotThunks = [];
  const whileServedCalls = [];
  const getCalls = [];
  let registerOptions = null;
  const scope = {
    getSnapshot: () => ({ status: 'loading', value: undefined, revision: 0, writable: true }),
    subscribe: () => () => {},
    mutate: async () => true,
  };
  const remote = {
    credentials: {
      describe: async () => ({ ok: true, value: {} }),
      set: async () => ({ ok: true }),
    },
    $on: () => () => {},
  };
  const ctx = {
    slots: {
      inject(name, thunk) { injected.push(name); slotThunks.push(thunk); },
      register(options) { registerOptions = options; return () => {}; },
    },
    configForms: {
      get(ns) { getCalls.push(ns); return scope; },
      whileServed(namespaces, register) {
        whileServedCalls.push(namespaces);
        register(new Set(namespaces));
        return () => {};
      },
    },
    remote,
    inject(names, callback) { callback({ remote }); },
    effect(fn) { return fn() ?? (() => {}); },
    logger: { warn() {} },
  };

  clientExports.apply(ctx);

  assert.deepEqual([...getCalls], [SETTINGS_NS], 'configForms.get must address the settings namespace');
  assert.equal(whileServedCalls.length, 1, 'registration is gated by whileServed');
  assert.deepEqual([...whileServedCalls[0]], [SETTINGS_NS]);
  assert.equal(injected.length, 1, 'one slot injection');
  assert.equal(injected[0], 'plugins.row.config');
  const dispose = slotThunks[0]();
  assert.ok(registerOptions, 'slots.register must be called');
  assert.equal(registerOptions.name, 'plugins.row.config');
  assert.equal(registerOptions.key, ROW_CONFIG_KEY);
  assert.equal(typeof dispose, 'function', 'registration returns a disposer');
});
