import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPatchedSource } from '../scripts/patch-api-proxy-namespace.mjs';
import { parseCredentialsYaml, parseEnvFile, collectCredentialRefs } from '../scripts/check-usage.mjs';

// ── patch-api-proxy-namespace.mjs: buildPatchedSource ──

function sampleSource({ eol = '\n', indent = '\t', trailingComma = true } = {}) {
  const line = `${indent}"web-search-deepseek"${trailingComma ? ',' : ''}`;
  return [
    'const WEB_SETTINGS_NAMESPACES = [',
    `  "web-search-pool-disabled-placeholder",${eol}`.replace('  ', '\t'),
    line,
    '];',
  ].join(eol);
}

test('buildPatchedSource: LF + Tab 缩进 + 已有尾随逗号', () => {
  const source = sampleSource();
  const result = buildPatchedSource(source, 'web-search-pool');
  assert.equal(result.ok, true);
  assert.ok(!result.alreadyApplied);
  assert.ok(result.output.includes('\t"web-search-deepseek",' + '\n' + '\t"web-search-pool"'));
});

test('buildPatchedSource: CRLF 换行自适应', () => {
  const source = sampleSource({ eol: '\r\n' });
  const result = buildPatchedSource(source, 'web-search-pool');
  assert.equal(result.ok, true);
  assert.ok(result.output.includes('"web-search-deepseek",' + '\r\n' + '\t"web-search-pool"'));
});

test('buildPatchedSource: 空格缩进自适应', () => {
  const source = sampleSource({ indent: '    ' });
  const result = buildPatchedSource(source, 'web-search-pool');
  assert.equal(result.ok, true);
  assert.ok(result.output.includes('\n    "web-search-pool"'));
});

test('buildPatchedSource: 锚点行缺尾随逗号时自动补上', () => {
  const source = sampleSource({ trailingComma: false });
  const result = buildPatchedSource(source, 'web-search-pool');
  assert.equal(result.ok, true);
  assert.ok(result.output.includes('"web-search-deepseek",'), '应为锚点行补上逗号');
});

test('buildPatchedSource: 已包含 namespace 时幂等跳过', () => {
  const source = buildPatchedSource(sampleSource(), 'web-search-pool').output;
  const again = buildPatchedSource(source, 'web-search-pool');
  assert.deepEqual(again, { ok: true, alreadyApplied: true });
});

test('buildPatchedSource: 找不到锚点时报错', () => {
  const result = buildPatchedSource('const x = 1;', 'web-search-pool');
  assert.equal(result.ok, false);
  assert.match(result.error, /未找到白名单锚点/);
});

// ── check-usage.mjs: 凭据解析 ──

test('parseCredentialsYaml: 提取 TAVILY_API_KEY_* 行（含引号剥离）', () => {
  const map = parseCredentialsYaml([
    'DEEPSEEK_API_KEY: other',
    'TAVILY_API_KEY_1: tvly-a',
    'TAVILY_API_KEY_2:   "tvly-b"  ',
    "TAVILY_API_KEY_3: 'tvly-c'",
    'TAVILY_API_KEY_EMPTY:',
    '# TAVILY_API_KEY_commented: x',
  ].join('\n'));
  assert.equal(map.size, 4);
  assert.equal(map.get('TAVILY_API_KEY_1'), 'tvly-a');
  assert.equal(map.get('TAVILY_API_KEY_2'), 'tvly-b');
  assert.equal(map.get('TAVILY_API_KEY_3'), 'tvly-c');
  assert.equal(map.get('TAVILY_API_KEY_EMPTY'), '');
});

test('parseEnvFile: 支持 export 前缀、引号、注释', () => {
  const map = parseEnvFile([
    '# TAVILY_API_KEY_1=commented',
    'TAVILY_API_KEY_1=tvly-a',
    'export TAVILY_API_KEY_2="tvly-b"',
    'OTHER_KEY=x',
  ].join('\n'));
  assert.equal(map.size, 2);
  assert.equal(map.get('TAVILY_API_KEY_1'), 'tvly-a');
  assert.equal(map.get('TAVILY_API_KEY_2'), 'tvly-b');
});

test('collectCredentialRefs: 优先级 env > yaml > .env，且支持 DSH_HOME 注入', () => {
  const files = {
    yaml: [
      'TAVILY_API_KEY_1: tvly-yaml',
      'TAVILY_API_KEY_2: tvly-only-yaml',
    ].join('\n'),
    env: [
      'TAVILY_API_KEY_1=tvly-dotenv',
      'TAVILY_API_KEY_3=tvly-only-dotenv',
    ].join('\n'),
  };
  const readFile = (path) => {
    if (path.endsWith('.credentials.yaml')) return files.yaml;
    if (path.endsWith('.env')) return files.env;
    throw new Error('ENOENT: ' + path);
  };
  const refs = collectCredentialRefs({
    env: { TAVILY_API_KEY_1: 'tvly-env', TAVILY_API_KEY_4: 'tvly-only-env', OTHER: 'x' },
    dshHome: '/fake/dsh-home',
    readFile,
  });
  assert.equal(refs.size, 4);
  assert.equal(refs.get('TAVILY_API_KEY_1'), 'tvly-env'); // env 最高优先
  assert.equal(refs.get('TAVILY_API_KEY_2'), 'tvly-only-yaml'); // yaml 覆盖 .env
  assert.equal(refs.get('TAVILY_API_KEY_3'), 'tvly-only-dotenv');
  assert.equal(refs.get('TAVILY_API_KEY_4'), 'tvly-only-env');
});

test('collectCredentialRefs: 文件全部缺失时仅取环境变量', () => {
  const refs = collectCredentialRefs({
    env: { TAVILY_API_KEY_9: 'k' },
    dshHome: '/fake/nowhere',
    readFile: () => { throw new Error('ENOENT'); },
  });
  assert.equal(refs.size, 1);
  assert.equal(refs.get('TAVILY_API_KEY_9'), 'k');
});
