# 方案 A：dsh-web-search-pool 原生 Bundle 重构升级设计

> 文档状态：设计草案，供实现前评审
>
> 目标版本：`dsh-web-search-pool` `0.3.0`
>
> 目标宿主：DeepSeek Harness 官方 `0.1.0-rc.7`
>
> 编写日期：2026-08-18
>
> 适用项目：`AI搜索Key池负载均衡/`

## 1. 文档目的

本文定义将现有 `dsh-web-search-pool` 从 rc.6 时代的“普通 out-of-tree provider + 手工 profile patch + 安装目录白名单 patch”升级为 rc.7 官方式 Bundle 插件的完整方案。

本文不是简单的功能说明，而是实现前的决策规格，回答以下问题：

- 插件如何被 DeepSeek Harness 发现、安装、组合和升级。
- Bundle 层、Host 层、Client 层和纯核心库如何分工。
- `web_search` 请求如何在多供应商、多 key 之间调度。
- 配置、凭据、额度、冷却、运行时状态和设置页如何流动。
- rc.7 与 rc.6 的兼容差异如何处理。
- 网络异常、取消、超时、429、额度耗尽、配置竞态和插件卸载如何收敛。
- 如何用 TDD、静态检查、打包检查和真实 profile 验证实现。
- 安装失败、升级失败或需要回滚时如何恢复。

实现必须以本文的“必须满足”条款为准；本文明确标记为“未来扩展”的内容不属于 0.3.0 验收范围。

## 2. 设计结论

### 2.1 总体结论

采用方案 A：

> 一个 npm 包同时提供 Host composition 插件、可选 Web Client half 和一个 `cordis.patch.yml` Bundle patch；用户通过 `dsh plugin --profile web add <package-spec>` 安装，DSH 自动把该包纳入 profile 的 Bundle 层。

核心搜索逻辑继续保持 DSH 无关：

```text
纯核心库
  ├── KeyPool
  ├── TokenBucketLimiter
  ├── Scheduler
  ├── Retry-After / timeout / abort 工具
  ├── query intent / provider params
  └── Tavily / Exa adapter

DSH Host half
  ├── settings schema / credentials resolve
  ├── SearchPoolProvider
  ├── ctx.web 注册
  ├── web row provider 选择切换
  ├── Tavily usage 后台刷新
  └── ctx.logger 可观测性

DSH Client half
  ├── dsh.client manifest
  ├── settings.plugin.item keyed card
  ├── settingsScope / credentials wire
  ├── staged form / 单次 mutate
  └── rc.7 生命周期清理

Bundle layer
  └── 覆盖 web row + insert search-pool Host row
```

### 2.2 0.3.0 必须完成的变化

1. `package.json` 声明 `dsh.bundle.patch`。
2. `package.json` 声明 rc.7 Web Client half 所需的 `dsh.client` 和 `exports['./client']`。
3. 新增包内 `cordis.patch.yml`，至少完成：
   - 覆盖 `web` row 的 `searchProvider`。
   - 插入 `web-search-pool` row。
4. 通过标准命令安装：

   ```bash
   dsh plugin --profile web add <package-spec>
   ```

5. 删除运行路径对 `WEB_SETTINGS_NAMESPACES` 的依赖。
6. 不再修改 DSH npm 安装目录。
7. 将 `settings.plugin.item` 注册从 rc.6 风格的 `id` 改为 rc.7 所需的 `key: 'web-search-pool'`。
8. 收紧 DSH peer 依赖到 `^0.1.0-rc.7`。
9. 修复当前已有的 2 个测试回归。
10. 增加安装契约、Bundle patch、Client factory、版本和打包内容测试。
11. 保持已有的多 key、多供应商、429 换 key、失败熔断、额度刷新、匿名 Exa 和请求超时行为。
12. 更新安装指南、升级指南、故障排查和事故规范。

### 2.3 0.3.0 明确不做的内容

以下内容不阻塞 0.3.0：

- Redis 或跨进程限流。
- 独立 HTTP 中转服务。
- 多实例共享 KeyPool 状态。
- Prometheus 服务端点。
- 搜索请求的并行供应商扇出。
- 在一个搜索请求中对已经产生部分结果的流式响应进行中途 fallback。
- 修改 DSH shipped bundle、shipped preset 或 npm 安装目录。
- 自定义会话事件。
- 将 web provider 移入 agent preset。
- 重新实现官方 Settings UI 框架。

## 3. 调研依据与事实边界

### 3.1 调研日期和宿主版本

调研日期：2026-08-18。

本机安装的宿主：

```text
@deepseek-ai/dsh@0.1.0-rc.7
@deepseek-ai/cordis@4.0.1
@deepseek-ai/cordis-plugin-loader@1.0.2
@deepseek-ai/cordis-plugin-include@1.0.6
@deepseek-ai/dsh-web@0.1.0-rc.7
@deepseek-ai/dsh-settings@0.1.0-rc.7
@deepseek-ai/dsh-host-apiproxy@0.1.0-rc.7
@deepseek-ai/dsh-client-modules@0.1.0-rc.7
```

### 3.2 官方来源

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [rc.7 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7)
- [rc.7 发布提交](https://github.com/deepseek-ai/deepseek-harness/commit/bb4ca698d63714e753f5621b07400e6ebb0b5d97)
- [官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/architecture.md)
- [官方插件发布文档](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/user/develop/basic/publish.md)
- [官方 web bundle](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/web-app)
- [官方 client modules](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/modules)
- [官方 DeepSeek 搜索 provider](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web-search-deepseek)
- [官方 Settings Client 插件](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-settings-plugins)
- [官方 rc.7 插件 keyed slot 问题记录](https://github.com/ysr666/dsh-vision-router/issues/165)

### 3.3 本地源码来源

以下路径使用文档占位格式表达，实际实现/验证以当前机器对应路径为准：

```text
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/README.zh.md
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/lib/plugin-*.js
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/README.md
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml
<DSH_INSTALL>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml
```

### 3.4 版本差异结论

本次升级需要特别处理两处 rc.6 → rc.7 变化：

1. rc.7 `dsh-host-apiproxy` 不再使用旧版 `WEB_SETTINGS_NAMESPACES` 白名单。已注册 Settings namespace 会由设置代理直接提供给浏览器。
2. rc.7 的 `settings.plugin.item` 由 list slot 改为 keyed slot。注册必须使用 `key`，且 key 必须与 Settings namespace 对应。

因此旧脚本 `scripts/patch-api-proxy-namespace.mjs` 不再属于正常 rc.7 安装链路。

## 4. 产品目标与用户体验

### 4.1 用户最终得到什么

安装并配置后，用户在 DeepSeek Harness Web 中使用普通 `web_search` 工具时：

1. DSH 仍然只看到一个 provider：`search-pool`。
2. provider 内部自动选择 Tavily 或 Exa。
3. 同一供应商的多个 key 按每个 key 的 rpm 进行调度。
4. 429、网络失败、凭据缺失、上游 5xx 和超时会按规则切换到下一个候选。
5. 供应商全部失败时返回结构化 DSH `WebError`，不泄露密钥。
6. Tavily 额度在后台刷新，不阻塞搜索首字节。
7. 设置页出现“搜索 Key 池”卡片。
8. 密钥明文通过 credentials 域保存，不进入 settings.yaml 的非 secret 配置层。
9. 开关关闭时恢复官方 `deepseek-official` provider。
10. DSH 重启或插件更新后配置仍由 profile/settings 保持。

### 4.2 用户不需要知道的内部细节

用户不需要手动：

- 编辑 DSH 安装目录里的 JS。
- 修改 `WEB_SETTINGS_NAMESPACES`。
- 手工把 bundle 插入 shipped `cordis.yml`。
- 编辑 shipped preset。
- 把 API key 写进 `cordis.patch.yml`。
- 为每次 key 轮换重启 DSH。

## 5. 目标目录结构

升级后的项目结构：

```text
AI搜索Key池负载均衡/
├── AI搜索Key池负载均衡-开发计划.md
├── LICENSE
├── README.md
├── package.json
├── cordis.patch.yml                 # 新增：rc.7 Bundle patch
├── task_plan.md
├── notes.md
├── docs/
│   ├── 挂载指南.md                  # 重写为 rc.7 原生安装
│   ├── 升级与回滚指南.md             # 新增
│   ├── 开发事故复盘与规范.md
│   ├── 全面检查报告.md
│   ├── research/
│   │   └── 2026-08-18-rc7-research-brief.md
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-08-18-native-bundle-rc7-design.md
│       └── plans/
├── scripts/
│   ├── check-usage.mjs
│   ├── run-tests.mjs
│   └── patch-api-proxy-namespace.mjs  # 兼容诊断脚本，可废弃正常安装用途
├── src/
│   ├── core/
│   ├── adapters/
│   └── dsh/
│       ├── client.js
│       ├── config.js
│       ├── index.js
│       └── provider.js
└── tests/
    ├── adapters.test.js
    ├── bundle-contract.test.js       # 新增
    ├── client-contract.test.js       # 新增
    ├── config-contract.test.js       # 新增
    ├── http-utils.test.js
    ├── install-contract.test.js      # 新增
    ├── key-pool.test.js
    ├── provider.test.js
    ├── query-intent.test.js
    ├── rate-limiter.test.js
    ├── resolve-params.test.js
    ├── scheduler.test.js
    └── scripts.test.js
```

### 5.1 是否删除旧脚本

`patch-api-proxy-namespace.mjs` 有两种处理方式，0.3.0 采用“兼容诊断保留”策略：

- 正常安装流程不调用它。
- 在 rc.7 上执行时，如果检测不到 `WEB_SETTINGS_NAMESPACES`，输出“当前宿主已自动暴露已注册 namespace，无需 patch”，并以成功退出。
- 在旧 rc.6 上检测到目标数组时，允许继续做兼容 patch，但文档将其标记为 legacy，不作为 0.3.0 正常支持路径。
- 增加版本/目标检测测试，禁止脚本在未知结构上盲写。

如果后续项目只支持 rc.7 及更高版本，可在 0.4.0 删除脚本和相关测试。

## 6. Package manifest 设计

### 6.1 package.json 目标结构

目标结构如下，版本号和依赖名以实际 rc.7 包导出为准：

```json
{
  "name": "dsh-web-search-pool",
  "version": "0.3.0",
  "description": "Multi-key, multi-provider web search pool for DeepSeek Harness",
  "private": false,
  "type": "module",
  "main": "src/dsh/index.js",
  "engines": {
    "node": ">=18"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/DreamRift/dsh-web-search-pool.git"
  },
  "homepage": "https://github.com/DreamRift/dsh-web-search-pool",
  "license": "MIT",
  "files": [
    "src/",
    "scripts/",
    "cordis.patch.yml",
    "docs/挂载指南.md",
    "docs/升级与回滚指南.md",
    "README.md",
    "LICENSE"
  ],
  "exports": {
    ".": "./src/dsh/index.js",
    "./client": "./src/dsh/client.js",
    "./core": "./src/core/index.js",
    "./adapters": "./src/adapters/index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings"
      ]
    }
  },
  "scripts": {
    "test": "node --test tests/",
    "test:local": "node scripts/run-tests.mjs",
    "pack:check": "npm pack --dry-run"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-api-remotes": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-connection": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-credentials": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-launch-environment": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-settings": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-web": "^0.1.0-rc.7",
    "@deepseek-ai/schemastery": "^3.18.1"
  }
}
```

### 6.2 关于 `dsh.client.inject`

`inject` 只声明 Client half 的硬依赖。它不能替代 Host `inject`，也不能把 Host 服务名填入 Client 清单。

Client half 实际使用：

- `ctx.settingsScope`：由 `settingsScope` 注入。
- `ctx.slots`：由 `slots` 注入。
- `ctx.get('connection')`：用于 Settings/Credentials API。
- `react`：由客户端模块系统提供为 peer/static module。

若 rc.7 的当前客户端模块扫描不要求所有这些名称都列入 `dsh.client.inject`，应以官方同类包的最小注入集合为准，避免声明无效模块造成启动等待。最终实现必须通过 `client-contract.test.js` 和临时 web profile 验证。

### 6.3 依赖版本策略

必须避免：

```json
"@deepseek-ai/dsh-web": "*"
```

原因：部分官方子包的 npm `latest` 标签可能滞后于 rc.7，宽松版本会把 rc.1 与 rc.7 混装。

采用：

```text
peerDependencies: ^0.1.0-rc.7
安装文档：精确 rc.7 或明确使用 next tag
测试：检查 package.json 中所有 @deepseek-ai/dsh-* peer 不能为 *
```

插件本身不新增第三方 runtime dependency。`@deepseek-ai/schemastery` 是 DSH 官方 schema 依赖，作为 peer 由宿主提供。

## 7. Bundle patch 设计

### 7.1 目标文件

新增：

```text
AI搜索Key池负载均衡/cordis.patch.yml
```

### 7.2 目标内容

推荐初始 patch：

```yaml
# dsh-web-search-pool bundle patch for DeepSeek Harness rc.7.
# The web row is host-owned. Its complete config is restated because an id-targeted
# patch replaces the whole config rather than deep-merging it.

- id: web
  config:
    searchProvider: search-pool

- insert:
    - id: web-search-pool
      name: dsh-web-search-pool
      config:
        enabled: true
        providers:
          tavily:
            keys: []
          exa:
            keys: []
        strategy: weighted-round-robin
        providerPriority: [tavily, exa]
        allowedFails: 3
        cooldownMs: 30000
        retryAfterFallbackMs: 1000
        usageCacheMs: 300000
        quotaReserveCredits: 2
        quotaExhaustedCooldownMs: 2592000000
        requestTimeoutMs: 20000
```

### 7.3 是否默认接管搜索

0.3.0 推荐默认 `enabled: true`，原因：

- 用户安装该 Bundle 的直接意图就是启用搜索池。
- 没有配置 key 时 provider `available()` 返回 false，显式配置的 `searchProvider: search-pool` 会返回 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，错误是清晰的。
- 设置页可关闭插件，关闭时动态切回 `deepseek-official`。

如果产品希望“安装但不接管”，可将 Bundle patch 默认改为 `enabled: false`，但这会使用户安装后第一次搜索仍走官方 provider，容易误以为插件没安装。0.3.0 采用默认开启。

### 7.4 为什么 patch 必须同时覆盖 web row

官方 `dsh-base/cordis.patch.yml` 将：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
```

作为 base 配置。rc.7 中 `WebRuntime` 的配置优先于环境变量，因此仅设置：

```text
DSH_WEB_SEARCH_PROVIDER=search-pool
```

不能覆盖已经组合进来的 `searchProvider`。Bundle 必须通过 id-targeted patch 覆盖 `web` row。

### 7.5 配置整段替换风险

DSH patch 的 id-targeted config 是整段替换，不是深合并。因此：

- 当前只覆盖 `searchProvider` 的 `web` row，不能擅自添加未知 web 配置。
- 如果未来官方 `web` row 增加必须字段，需要更新本 Bundle patch。
- 安装测试必须检查 patch 的目标 id 和完整 config。
- 文档必须明确用户自定义 patch 若再次覆盖 `web`，要保留 `searchProvider: search-pool`。

## 8. Host 架构设计

### 8.1 Host 入口

文件：

```text
src/dsh/index.js
```

职责：

1. 导入并导出 `Config`、`resolveOptions`、`SearchPoolProvider`、`SEARCH_POOL_PROVIDER_ID`。
2. 声明 `name = 'web-search-pool'`。
3. 声明 `inject = ['web']`。
4. 注册 Settings namespace `web-search-pool`。
5. 创建唯一 `SearchPoolProvider` 实例。
6. 注册 provider 到 `ctx.web`。
7. 监听 Settings 更新。
8. 在 enabled 变化时更新 `include:web` 的 `searchProvider`。
9. 在插件 dispose 时移除监听并释放 provider 状态。

### 8.2 Host service 依赖

硬依赖：

```js
export const inject = ['web']
```

可选依赖：

- `credentials`：优先从 `ctx.get('credentials')` 获取。
- `settings`：现有实现使用 `ctx.inject(['settings'], ...)` 延迟获取；必须保留 pending usage 发布逻辑。
- `loader`：用于开关切换；不存在时只记录 warning，不让 provider 启动失败。
- `timer`：如未来使用，必须通过真实 Service 声明，不使用全局定时器。
- `logger`：使用 `ctx.logger`，不写自定义 session event。

### 8.3 provider 注册生命周期

创建顺序：

```text
apply(ctx, config)
  -> 创建 current config thunk
  -> 创建 SearchPoolProvider
  -> 等待/获取 settings service
  -> installSettingsSection
  -> 注册 settings/updated 兜底监听
  -> ctx.web.registerSearchProvider(provider)
  -> 同步 web row provider id
```

销毁顺序：

```text
dispose()
  -> 移除 settings/updated listener
  -> provider.dispose()
  -> web service 的 Fiber effect 注销 provider
  -> settings namespace 注册随 Fiber 注销
```

禁止：

- 在模块顶层创建 pool、timer、listener。
- 在 apply 外缓存跨实例可变状态。
- dispose 后继续写 Settings。
- dispose 后继续发起额度刷新。

### 8.4 provider id

稳定 provider id：

```text
search-pool
```

它必须与 Bundle patch 的：

```yaml
searchProvider: search-pool
```

完全一致。

不能根据配置生成 provider id，否则：

- Web seam 无法稳定选择。
- 更新配置时会产生重复 provider。
- 日志和错误无法关联。

### 8.5 enabled 开关

`enabled` 是 Settings 配置的一部分：

- `true`：`web.searchProvider = search-pool`。
- `false`：`web.searchProvider = deepseek-official`。

SearchPoolProvider 的 `available()` 还必须返回：

```js
!disposed && options.available
```

这样即使某个配置切换延迟，provider 自身也不会在无 key 时假装可用。

### 8.6 设置变更监听

主路径：

```text
installSettingsSection(..., { onChange })
```

兜底路径：

```text
ctx.on('settings/updated', (ns, next) => { ... })
```

原因：实际 rc.6 运行中发现某些 include/loader 装配下 `scope.watch` 注册了但没有触发预期 Host 动作；rc.7 Settings 仍提供 `settings/updated`，所以保留双路径。

必须使用 `lastRefreshTick` 防重：

- 首次 section 建立：保存当前 tick，可触发初次额度刷新。
- tick 变化：触发一次后台刷新。
- 同一 tick 经两个监听路径到达：只触发一次。
- config 普通字段改变：重建/复用 pool，但不因 usage 写回再次刷新。

## 9. 配置模型

### 9.1 用户配置原则

配置分为三类：

1. 用户可编辑配置：供应商、key 引用、rpm、策略、冷却、超时和高级搜索参数。
2. 运行时状态：usage、usageDiagnostic、usageRefreshTick。
3. secret：实际 API key，只通过 credentials 服务保存，不放进 Settings 普通响应。

### 9.2 Key 描述

```js
{
  id: 'tavily:TV_1',
  apiKeyEnv: 'TAVILY_API_KEY_1',
  rpm: 60,
  remark: '主账号'
}
```

Exa 匿名 entry：

```js
{
  id: 'exa:anonymous:0',
  anonymous: true,
  rpm: 60,
  remark: '匿名免费层'
}
```

约束：

- `apiKeyEnv` 必须符合 `[A-Za-z_][A-Za-z0-9_]*`。
- 配置里绝不存 API key 明文。
- `id` 稳定且唯一；相同 provider 下不能出现重复 id。
- `rpm >= 1`，除非是内部固定匿名 limiter，不允许用 0 伪装关闭。
- 删除 key 后，新请求不能再选择该 key；已经开始的请求可以完成。

### 9.3 供应商配置

Tavily：

```js
{
  keys: [],
  searchDepth: 'advanced',
  includeAnswer: true,
  includeRawContent: false,
  topic: 'auto',
  timeRange: 'auto',
  includeDomains: 'auto',
  excludeDomains: []
}
```

Exa：

```js
{
  keys: [],
  type: 'auto',
  useAutoprompt: true,
  highlights: true,
  summary: true,
  includeDomains: 'auto',
  excludeDomains: [],
  startPublishedDate: 'auto'
}
```

### 9.4 调度配置

```js
{
  strategy: 'weighted-round-robin',
  providerPriority: ['tavily', 'exa'],
  allowedFails: 3,
  cooldownMs: 30000,
  retryAfterFallbackMs: 1000,
  requestTimeoutMs: 20000
}
```

语义：

- `providerPriority` 决定供应商 failover 顺序。
- `weighted-round-robin` 按 rpm 作为权重。
- `least-used` 按当前剩余令牌数优先。
- `allowedFails` 是非 429 连续失败达到阈值后熔断。
- `cooldownMs` 是默认冷却时间。
- `retryAfterFallbackMs` 是没有合法 Retry-After 时的 429 冷却回退。
- `requestTimeoutMs` 是每个 key 尝试的超时；0 表示不启用内部超时，但仍受外部 signal 控制。

### 9.5 额度配置

```js
{
  usageCacheMs: 300000,
  quotaReserveCredits: 2,
  quotaExhaustedCooldownMs: 2592000000
}
```

额度语义：

- usage 缓存过期时后台刷新。
- 搜索不等待 usage 刷新。
- 完全无缓存时先放行，依赖上游失败兜底。
- 剩余额度低于 `quotaReserveCredits` 时进入长冷却。
- usage 刷新发现额度恢复时解除长冷却。
- Exa 普通 API key 无统一余额接口，不计入 Tavily 汇总。
- Exa 匿名免费层不是 credits 额度，而是共享速率限制。

### 9.6 运行时 usage schema

```js
{
  updatedAt: 0,
  totalUsed: 0,
  totalLimit: 0,
  keys: [
    {
      ref: 'TAVILY_API_KEY_1',
      used: 0,
      limit: 0,
      remaining: -1,
      plan: 'unknown'
    }
  ]
}
```

约束：

- 所有字段必须可 JSON 序列化。
- 不能把 `Map`、Service、Response、Error 实例写入 Settings。
- `remaining = -1` 表示供应商没有公开余额或余额未知。
- `usageDiagnostic` 为空表示最近一次刷新没有记录到错误。

## 10. 核心调度设计

### 10.1 请求级候选快照

每次 `search()` 开始时：

1. 读取一次完整 options。
2. 建立或复用当前 pool。
3. 计算本次 query intent 和各供应商参数。
4. 在循环中每次 `acquire()` 从当前 pool 获取一个未使用候选。
5. 本次请求的最大尝试数等于请求开始时 pool 的 key 数量。

配置变更不会修改已经开始的 options 快照，也不能让当前请求在中途读取另一份配置。

这条规则吸收 new-api 渠道重试下标错位的反面教训：

> 状态可以影响本次循环后续的 acquire，但配置集合不能在请求中途被替换；新配置只影响后续请求。

### 10.2 KeyPool

KeyPool 持有：

- 静态 entry 描述。
- `cooldownUntil`。
- `failCount`。
- id、credentialRef、provider 的 O(1) 索引。

必须保证：

- 同一 pool 内 id 唯一。
- `entryById()`、`entryByRef()` 不做重复线性扫描。
- `entriesForProvider()` 返回稳定的内部分组数组，调用方只读。
- 429 冷却时长取 `max(cooldownMs, retryAfterMs)`。
- 达到 `allowedFails` 后进入默认冷却并清零失败计数。
- 成功清零失败计数。
- 额度恢复可显式清除长冷却。

### 10.3 TokenBucketLimiter

默认令牌桶：

```text
capacity = rpm
refill = rpm / 60 秒
```

性质：

- 初始桶满。
- 每次成功 acquire 消费一个令牌。
- 令牌不足时不能选中该 key。
- `least-used` 读取剩余令牌数。
- 时间源可注入，便于单测。
- 0.3.0 使用内存存储，重启后状态清零。
- 存储接口保留 `{ get, set }`，未来可替换 Redis/SQLite，但本次不实现。

### 10.4 Scheduler

调度顺序：

```text
providerPriority 顺序
  -> 取该 provider 未冷却候选
  -> 按 strategy 排序/选举
  -> tryAcquire token
  -> 成功返回 entry
  -> 令牌不足则从候选中排除继续尝试
  -> provider 无候选则 failover 到下一个 provider
```

weighted-round-robin：

- 使用 smooth WRR current weight。
- 每轮按 rpm 累加。
- 选中后减去该供应商候选总权重。
- 令牌不足的 key 不应消费 token，也不能被误标记为成功。

least-used：

- 选择剩余令牌最多的 key。
- 相同时按稳定 entry 顺序打破平局。
- 不使用每次排序造成的无必要数组分配。

### 10.5 失败分类

| 情况 | 是否计失败 | 是否冷却 | 是否继续尝试 |
|---|---:|---:|---:|
| 成功 | 清零 | 否 | 否 |
| HTTP 429 | 否 | 是，Retry-After 或回退 | 是 |
| HTTP 5xx | 是 | 达阈值后 | 是 |
| HTTP 4xx 非 429 | 是 | 达阈值后 | 是 |
| 凭据缺失 | 是 | 达阈值后 | 是 |
| 凭据解析异常 | 是 | 达阈值后 | 是 |
| 内部请求超时 | 是 | 达阈值后 | 是 |
| 调用方 Abort | 否 | 否 | 否，立即终止 |
| Exa 匿名 limiter 拒绝 | 否 | 是，固定 1 秒 | 是 |
| Tavily 额度不足 | 否 | 是，长冷却 | 是 |
| provider disposed | 不适用 | 不适用 | 否，返回不可用 |

### 10.6 Retry-After

适配器必须：

1. 优先解析 `Retry-After` 秒数。
2. 不可解析时尝试 HTTP 日期。
3. 仍不可解析时使用 `retryAfterFallbackMs`。
4. 不把负数、NaN 或无穷值写入冷却。
5. 429 响应体必须消费或取消，避免连接复用积压。
6. 不对外暴露 API key 或完整响应体。

0.3.0 不引入固定 sleep；429 只记录 key 冷却，调度器立即尝试本请求的其他候选。这样不会因为一个 key 的 Retry-After 把整个请求阻塞。

### 10.7 请求取消和内部超时

`withTimeout(externalSignal, timeoutMs)` 生成内部 AbortController：

- 外部 signal abort：转发到下游，`timedOut() === false`。
- 内部 timer 触发：转发 abort，`timedOut() === true`。
- 请求结束后清理 timer 和外部 listener。
- 外部取消优先级高于内部超时。
- 外部取消不能被包装成普通 provider error。

搜索循环必须在：

```js
if (signal?.aborted === true) throw abortError
```

之后才 acquire 和 resolve credential，避免已经取消的请求继续消耗令牌。

## 11. 供应商 Adapter 设计

### 11.1 统一接口

```js
adapter.search({
  query,
  apiKey,
  maxResults,
  signal,
  ...providerParams
})
```

返回 DSH 无关的：

```js
{
  content,
  sources,
  truncated
}
```

adapter 不知道 Cordis、Settings、Session 或 WebError。

### 11.2 Tavily

请求：

```text
POST https://api.tavily.com/search
```

要求：

- API key 放 body 的 `api_key`。
- 默认 `search_depth: advanced`。
- 默认 `include_answer: true`。
- `answer` 映射为 `content`。
- `results[]` 映射为 `sources[]`。
- 429 抛 `RateLimitError`。
- `/usage` 单独实现 `getUsage()`。
- usage 查询和 search 都支持 AbortSignal。
- 非 OK 响应清理 body。

### 11.3 Exa REST

请求：

```text
POST https://api.exa.ai/search
```

要求：

- API key 放 `x-api-key` header。
- 默认 `useAutoprompt` 和深度内容提取。
- `results[].url/title/text/publishedDate` 映射为标准 source。
- 429 抛 `RateLimitError`。
- 无公开余额接口时不伪造 usage。

### 11.4 Exa 匿名 MCP

无 API key 的 Exa entry：

- 走官方托管 MCP endpoint。
- initialize → initialized → tools/call。
- 只使用 `web_search_exa`。
- 解析完整 SSE `data:` 多行帧，不只取第一行。
- JSON-RPC id 必须实例级递增。
- 全部匿名 entry 共享一个全局 limiter。
- 固定最多 1 次/秒，配置 rpm 不能覆盖。

## 12. Settings 和凭据数据流

### 12.1 Host → Settings

```text
composition base config
  -> installSettingsSection 注册 schema/base
  -> settings provider 合并 defaults/base/user
  -> current() 取得冻结配置快照
  -> provider 每次 search 开始时解析 options
```

### 12.2 Client → Credentials

密钥保存顺序：

```text
用户输入 secret
  -> 校验 apiKeyEnv 非空且格式合法
  -> api.credentials.set({ref, value})
  -> credentials.set 成功
  -> 再 mutate Settings 普通配置
  -> credentials.describe 刷新 configured 状态
```

如果 secret 写入失败：

- 不提交 Settings 配置。
- 显示错误。
- 保留草稿。

如果 `apiKeyEnv` 改名但 secret 为空：

- 保存新引用。
- 不删除旧 credential。
- 旧 credential 是否清理属于未来显式删除操作，不能因为留空误删。

### 12.3 运行时 usage 发布

Host 不能把使用中的 `Map` 直接写入 Settings。发布前构造最小 JSON：

```js
{
  updatedAt,
  totalUsed,
  totalLimit,
  keys: [...]
}
```

写入原则：

- `usage` 和 `usageDiagnostic` 尽量一次 `settings.update` 完成。
- 失败后尝试单独写诊断。
- 无 settings service 时暂存 pending snapshot。
- dispose 后不再发布。
- pool 重建期间完成的旧 usage 查询不能覆盖新 pool 的缓存。

## 13. Client half 设计

### 13.1 文件和格式

文件：

```text
src/dsh/client.js
```

必须保留 rc.7 client factory 格式：

```js
window.__ModuleLoader__.load({
  id: 'dsh-web-search-pool',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const react = require('react')
    // ...
    exports.apply = apply
    exports.inject = [...]
    return module.exports
  }
})
```

禁止：

- JSX。
- `import`/`require` 顶层语句。
- Node `process`、`Buffer`、fs 等 Host 全局。
- 把 Host Service、React element 或完整 live props 发给 Host。

### 13.2 keyed slot 修复

必须使用：

```js
ctx.slots.register({
  name: 'settings.plugin.item',
  key: 'web-search-pool',
  order: 21
}, SearchPoolCard)
```

不能使用：

```js
{
  name: 'settings.plugin.item',
  id: 'search-pool'
}
```

`key` 必须严格等于 Host Settings namespace：

```text
web-search-pool
```

### 13.3 卡片职责

卡片只负责：

- 读取 namespace snapshot。
- 展示开关、策略、供应商优先级、熔断、超时、额度配置。
- 管理 Tavily/Exa key 引用、rpm、备注。
- 通过 credentials wire 写 secret。
- 通过 settings mutate 一次性保存普通配置。
- 展示 Tavily usage 和诊断。
- 提供立即刷新按钮。

卡片不负责：

- 直接 fetch Tavily/Exa。
- 读取 Host 文件。
- 访问 DSH Service 实例。
- 选择 provider。
- 绕过 Settings schema。

### 13.4 草稿和保存

卡片打开后创建本地 draft：

```text
settings snapshot -> editableCopy -> React state
```

保存：

1. 校验所有 numeric 字段。
2. 校验 credential refs。
3. 并行写入需要更新的 credentials。
4. 全部成功后构造 settings patch。
5. 优先使用一次 `api.settings.mutate({ ns, ops })`。
6. 成功后清空 secret draft、重新 describe credentials、收起卡片。
7. 失败保留 draft 并显示错误。

不要把 redacted settings snapshot 重建后 wholesale replace，因为 secret 字段不会从 wire 返回，replace 会误删 secret。

### 13.5 立即刷新

按钮行为：

1. 设置 `refreshing = true`。
2. 递增 `usageRefreshTick`。
3. 使用不带旧 `expectedRevision` 的 mutate。
4. 成功显示“已请求刷新，等待 Host 回写”。
5. 失败显示错误。
6. 由 Host `settings/updated` 监听触发后台刷新。
7. Host 发布新的 usage 后，卡片订阅 snapshot 更新。
8. 防止 5 秒内重复点击。

### 13.6 Client 生命周期清理

所有 timer 必须可清理：

- note timer。
- refresh button rearm timer。
- 未来 credential request sequence。

组件卸载时：

- clear 所有 timer。
- 递增 request sequence，使旧异步响应失效。
- 取消 scope subscription。
- 不再调用 setState。

### 13.7 Client 样式

保留项目现有 CSS 变量和设置卡片风格，不覆盖全局 body，不使用硬编码 DSH DOM selector。

CSS 必须：

- 使用主题变量。
- 保持按钮、输入框和卡片在移动/桌面不溢出。
- 不展示 API key 明文。
- 只注入一份带 `data-plugin` 和 `data-plugin-css` 标记的 style。
- 插件停止或 HMR 时允许宿主回收其样式。

## 14. 日志与可观测性

### 14.1 日志字段

每次尝试可写入：

```js
{
  provider: 'tavily',
  keyId: 'tavily:TAVILY_API_KEY_1',
  ok: false,
  code: 'RATE_LIMIT',
  retryAfterMs: 60000,
  elapsedMs: 1234
}
```

日志不得包含：

- API key 明文。
- Authorization header。
- 完整上游响应 body。
- credentials service 对象。
- Settings live object。
- 未注册的 session event。

### 14.2 推荐观测 code

```text
OK
RATE_LIMIT
ERROR
TIMEOUT
CREDENTIAL_MISSING
KEY_RESOLVE_FAILED
QUOTA_EXHAUSTED
USAGE_QUERY_FAILED
USAGE_REFRESH_FAILED
USAGE_PUBLISH_FAILED
```

### 14.3 日志级别

- `info`：成功/429/切换等正常调度事件，可配置降噪。
- `warn`：部分 key 失败、usage 部分失败、provider 切换失败。
- `error`：配置无法恢复、Settings 发布持续失败、内部 invariant 失败。

## 15. 错误映射

### 15.1 Core error → DSH WebError

| Core error | DSH code |
|---|---|
| 外部取消 | `WEB_ABORTED` |
| 没有配置 key | `WEB_PROVIDER_CREDENTIAL_MISSING` |
| 所有 key 冷却/令牌耗尽 | `WEB_PROVIDER_UNAVAILABLE` |
| 上游错误耗尽候选 | `WEB_PROVIDER_ERROR` |
| provider disposed | `WEB_PROVIDER_UNAVAILABLE` |
| 429 全部失败 | `WEB_PROVIDER_ERROR`，message 带 retry-after 摘要 |

### 15.2 错误信息规则

错误消息：

- 可以包含 provider 名称、key id 或 credential ref。
- 不能包含 key value。
- 不能把整个上游响应 body 拼进 message。
- 要保留 `cause`，但 cause 不应被浏览器直接序列化。
- 对外稳定 code 优先于具体文本。

## 16. 并发和竞态策略

### 16.1 同时搜索

每个搜索调用拥有：

- 自己的 request options snapshot。
- 共享的 pool state。
- 共享的 token bucket store。
- 自己的 AbortSignal。

单进程 JS 的同步 acquire/record 操作不允许 await，因此一次 acquire 到 token commit 之间不能被同一进程的其他 JS continuation 插入。

### 16.2 配置热更新

配置更新时：

- 新搜索读取新 options。
- 旧搜索继续使用旧 options 和旧 pool 引用。
- 若 pool 静态配置相同，复用状态。
- 若 pool 静态配置改变，构造新 pool。
- 旧 usage refresh 写回前检查 pool 引用仍然相同。
- 新 pool 不能被旧 refresh 的 `byRef` 覆盖。

### 16.3 usage refresh 单飞

使用：

```js
_usageRefreshPromise
```

所有自动刷新和手动刷新复用同一个 Promise：

- 同一时刻只查询一次全部 Tavily keys。
- 查询完成后 finally 清空 promise。
- 任一调用方不应自行启动第二条刷新路径。

### 16.4 dispose 竞态

dispose 后：

- `available()` 为 false。
- `search()` 抛 `WEB_PROVIDER_UNAVAILABLE`。
- 旧的 usage refresh 可以等待上游自然结束，但不得写新的 settings 或修改已释放状态。
- 旧的 client async response 不得更新组件状态。

## 17. 安装设计

### 17.1 推荐安装方式：tarball

项目发布包：

```bash
npm pack
```

得到：

```text
dsh-web-search-pool-0.3.0.tgz
```

在 DSH profile 中安装：

```bash
dsh plugin --profile web add <项目目录>/dsh-web-search-pool-0.3.0.tgz
```

Windows PowerShell 示例：

```powershell
dsh plugin --profile web add "<项目目录>/dsh-web-search-pool-0.3.0.tgz"
```

安装后由 rc.7 `dsh plugin` 完成：

1. 在 `$DSH_HOME/profiles/web` 中写入 dependency。
2. 运行 pnpm 安装。
3. 检测包的 `dsh.bundle.patch`。
4. 把包名加入 `dsh.profile.bundles`。
5. 下一次 `dsh web` 启动时组合 Bundle patch。

### 17.2 开发期安装方式

开发期可以使用：

```bash
dsh plugin --profile web add link:<项目目录>
```

但必须注意：

- link 模式直接读取源码，适合开发调试。
- tarball 模式与源码解耦，修改源码后必须重新 pack 并重新安装。
- 不要混用旧 junction 和新 tarball。
- 真实 DSH runtime 的 peer 依赖由 profile/DSH 提供，不能用项目内旧 rc.1 peer 覆盖 rc.7。

### 17.3 安装后验证

```bash
dsh --profile web --dump-config
```

检查组合树中存在：

```text
include:web                  config.searchProvider = search-pool
include:web-search-pool      name = dsh-web-search-pool
```

检查包解析：

```bash
node -e "import('dsh-web-search-pool').then(m => console.log(m.name))"
```

检查 client bundle：

```text
package.json exports['./client'] 存在
package.json dsh.client.platform === 'web'
```

### 17.4 不再执行的步骤

rc.7 正常安装不执行：

```bash
node scripts/patch-api-proxy-namespace.mjs
```

该脚本仅用于旧宿主诊断/兼容，不应出现在 rc.7 主安装步骤中。

不执行：

- 修改 `<DSH_INSTALL>/node_modules/...`。
- 手工添加 `WEB_SETTINGS_NAMESPACES`。
- 修改 shipped `@deepseek-ai/dsh-base/cordis.patch.yml`。
- 直接把明文 key 写入 `cordis.patch.yml`。

## 18. 升级和回滚设计

### 18.1 从 0.2.x 升级

升级流程：

1. 停止当前 DSH Web 进程。
2. 备份 `$DSH_HOME/profiles/web/package.json`、`cordis.patch.yml` 和 `settings.yaml`。
3. 删除旧 profile patch 中手工插入的 `web-search-pool` row，避免重复 entry。
4. 删除旧的 `WEB_SETTINGS_NAMESPACES` patch 逻辑或不再执行脚本。
5. 安装 0.3.0 tarball：

   ```bash
   dsh plugin --profile web add <path>/dsh-web-search-pool-0.3.0.tgz
   ```

6. 检查 `dsh.profile.bundles` 是否出现 `dsh-web-search-pool`。
7. 检查用户 patch 是否没有重复 `web-search-pool`。
8. 执行 `dsh --profile web --dump-config`。
9. 启动 DSH Web。
10. 刷新页面并确认插件卡片。
11. 使用测试 key 执行一次真实搜索。

### 18.2 重复挂载防护

Bundle patch 和用户手工 patch 同时存在时，可能导致：

- duplicate provider id。
- duplicate Settings namespace。
- keyed slot 重复 key。

实现和文档必须要求：

- 0.3.0 Bundle 是唯一 provider row 来源。
- profile `cordis.patch.yml` 只保存用户配置覆盖，不再 insert 同名 provider。
- 如果用户保留旧手工 row，启动应 fail loud，文档提供删除旧 row 的步骤。

### 18.3 回滚

回滚方式一：回退 npm 包版本。

```bash
dsh plugin --profile web remove dsh-web-search-pool
dsh plugin --profile web add <old-package.tgz>
```

回滚方式二：暂时禁用用户 Bundle row。

不推荐直接编辑 shipped patch；可在 profile/home 用户 patch 中覆盖：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
```

但如果 provider Bundle 仍注册，未使用的 provider 仍可能出现在注册表中；长期回滚应移除 Bundle dependency。

### 18.4 失败更新语义

如果新版本启动失败：

- DSH loader 应 fail loud。
- 不自动修改旧 DSH 安装目录。
- 保留 profile package/lock 备份。
- 根据错误判断是 package resolve、client bundle、Settings schema、slot 或 provider apply 失败。
- 修复后重新 pack 安装。

## 19. TDD 实施计划

### 19.1 阶段 0：先建立失败测试

在改实现前新增测试：

1. `bundle-contract.test.js`
   - 读取 package.json。
   - 断言 `dsh.bundle.patch` 存在。
   - 读取 `cordis.patch.yml`。
   - 断言有 `id: web` 覆盖。
   - 断言有 `web-search-pool` insert。
   - 断言 provider id 与 patch 一致。

2. `client-contract.test.js`
   - 读取 `src/dsh/client.js`。
   - 断言包含 `key: "web-search-pool"` 或等价结构。
   - 断言不再使用 `id: "search-pool"` 作为 settings.plugin.item 注册选项。
   - 断言包含 `window.__ModuleLoader__.load`。
   - 断言 exports.apply/inject。

3. `install-contract.test.js`
   - package peer 不能使用 `*`。
   - 版本必须覆盖 rc.7。
   - files 列表包含 `cordis.patch.yml` 和 `src/dsh/client.js`。
   - files 列表不包含 `tests/`、`.credentials.yaml`、`.env`。

4. 旧脚本 rc.7 行为测试：
   - 没有 `WEB_SETTINGS_NAMESPACES` 时返回 no-op 成功/明确诊断。
   - 有旧目标时仍保持 legacy patch 行为。

运行并确认 RED。

### 19.2 阶段 1：最小实现

只实现使 RED 变 GREEN 的最小修改：

- package.json metadata。
- `cordis.patch.yml`。
- client keyed slot。
- legacy script rc.7 no-op。
- 现有脚本断言同步到当前实现。

运行：

```bash
npm run test:local
```

### 19.3 阶段 2：核心稳定性补测

新增/补齐：

- 外部 signal 已取消时不调用 fetch。
- 内部 timeout 会换 key。
- 外部 abort 不计失败。
- 429 Retry-After 秒数/HTTP 日期/非法头。
- 429 body 被清理。
- usage refresh 单飞。
- usage refresh 与 pool 重建竞态。
- dispose 后不可用。
- 配置变化后旧 pool 不覆盖新 pool。
- duplicate key/id 配置校验。
- 全部 key 冷却时返回不可用。
- provider failover 顺序稳定。

### 19.4 阶段 3：Client factory 测试

使用 stub 的 `window.__ModuleLoader__` 和 React/ctx：

- 执行 client.js 不报 parse error。
- factory 能被注册。
- apply 的 inject 列表包含必要服务。
- slot 注册选项包含 `key`。
- settings namespace 与 key 一致。
- dispose 能清理订阅/timer。
- credentials 写入失败不会提交 Settings。
- 保存使用一次 mutate。
- refresh usage 使用一次 tick mutate。

### 19.5 阶段 4：Bundle/profile 集成测试

使用临时 profile 目录，不修改真实 `$DSH_HOME`：

1. 复制 web profile manifest 到临时目录。
2. 安装/链接 tarball。
3. 运行 DSH profile compose/dump。
4. 断言 `include:web` 和 `include:web-search-pool` 存在。
5. 断言 `searchProvider=search-pool`。
6. 断言 client graph 包含 `dsh-web-search-pool`。
7. 断言无 duplicate namespace/provider。
8. 断言没有调用安装目录 patch。

如果 Windows sandbox 不允许 DSH CLI 写临时 profile，必须记录为环境限制，并使用纯函数 compose 测试加 `npm pack --dry-run` 替代，不能虚报真实挂载通过。

## 20. 测试矩阵

| 层级 | 目标 | 命令/证据 |
|---|---|---|
| 核心单测 | KeyPool/limiter/scheduler | `npm run test:local` |
| adapter 单测 | Tavily/Exa/429/SSE | `npm run test:local` |
| provider 单测 | retry/fallback/timeout/usage/dispose | `npm run test:local` |
| package contract | metadata/peer/files/exports | `npm run test:local` |
| bundle contract | patch 结构和 provider id | `npm run test:local` |
| client contract | rc.7 factory/keyed slot | `npm run test:local` |
| syntax | 所有 changed `.js/.mjs` | `node --check` |
| pack | 发布文件白名单 | `npm pack --dry-run` |
| profile compose | bundle 自动加入和 web 覆盖 | 临时 profile / `dsh --dump-config` |
| 浏览器 | 设置卡片/保存/刷新/开关 | rc.7 Web URL 手工验收 |
| 真实搜索 | Tavily/Exa key 切换 | 日志 + 搜索结果 |

## 21. 验收标准

### 21.1 安装验收

- [ ] `npm pack --dry-run` 成功。
- [ ] tarball 包含 `cordis.patch.yml`。
- [ ] tarball 包含 `src/dsh/client.js`。
- [ ] tarball 不包含测试、credentials、env 和 node_modules。
- [ ] `dsh plugin --profile web add <tgz>` 成功。
- [ ] profile manifest 自动出现 bundle 名称。
- [ ] 不需要执行安装目录 patch。

### 21.2 Host 验收

- [ ] loader 能加载 `dsh-web-search-pool`。
- [ ] Settings namespace `web-search-pool` 注册成功。
- [ ] `ctx.web.searchProviders` 有 `search-pool`。
- [ ] `include:web` 选择 `search-pool`。
- [ ] 无 key 时 provider unavailable，错误明确。
- [ ] 有效 key 时 `available()` 为 true。
- [ ] provider dispose 后不可用。

### 21.3 Client 验收

- [ ] Client bundle 被 rc.7 client modules 发现。
- [ ] 设置页没有 keyed slot requires options.key 错误。
- [ ] “搜索 Key 池”卡片出现。
- [ ] 官方 “DeepSeek 搜索”卡片与其并存。
- [ ] 卡片 key 为 `web-search-pool`。
- [ ] secret 不回显。
- [ ] 保存和刷新有明确成功/失败反馈。
- [ ] 组件卸载无 timer/subscription 泄漏。

### 21.4 搜索验收

- [ ] Tavily 搜索成功。
- [ ] Exa REST 搜索成功。
- [ ] Exa 匿名模式成功或错误可诊断。
- [ ] Tavily 429 换 key。
- [ ] Tavily key 额度耗尽进入长冷却。
- [ ] usage 恢复后解除长冷却。
- [ ] 请求超时换 key。
- [ ] 外部取消立即终止且不计失败。
- [ ] 全部失败时返回 WebError，不泄露密钥。

## 22. 性能目标

0.3.0 不承诺固定供应商延迟，但必须满足以下工程目标：

- pool 静态配置未变化时不重复重建。
- key 查找使用 O(1) Map 索引。
- scheduler 常规路径避免不必要复制和完整排序。
- Tavily usage key 查询并行执行。
- usage refresh 单飞。
- 搜索不等待额度刷新。
- 每次请求的尝试数有上限，不可无限重试。
- 每次内部 timeout 都能清理 timer/listener。
- Settings 保存尽可能一次 mutate，减少 revision 冲突和广播次数。
- Client credential 描述请求有序号守卫，过期响应丢弃。

## 23. 安全要求

### 23.1 凭据

- API key 只进入 credentials 服务。
- 日志不写 secret。
- Settings describe 使用 redacted wire。
- Client 只显示 configured/unconfigured。
- 空 secret draft 表示保留已有凭据，不执行 unset。
- credential ref 只能是环境变量名格式。

### 23.2 网络

- Tavily/Exa endpoint 使用固定 adapter URL，除非未来明确增加受限 endpoint 配置。
- HTTP redirect 默认拒绝或由 adapter 明确控制，不盲跟随未知地址。
- 所有请求支持 AbortSignal。
- 响应 body 在错误分支清理。
- 不把供应商响应原样注入模型，统一归一化 source。

### 23.3 会话历史

绝对禁止：

```js
session.append('web/search-pool-attempt', record)
```

除非该事件被当前 DSH 版本正式注册且 API 明确支持兼容标记。0.3.0 统一使用 `ctx.logger`。

## 24. 失败场景与恢复表

| 现象 | 判断 | 处理 |
|---|---|---|
| `Cannot find package dsh-web-search-pool` | profile 依赖未安装 | 重新运行 `dsh plugin --profile web add` |
| `dsh.bundle.patch` 未识别 | package metadata 或 files 缺失 | 检查 package.json、重新 pack |
| provider duplicate | 旧 profile patch 仍 insert provider | 删除旧手工 row |
| Settings namespace duplicate | 同一 provider 被组合两次 | 清理 profile bundle/依赖重复 |
| keyed slot requires options.key | client 仍使用 id | 改为 `key: web-search-pool`，重启 DSH |
| 设置页没有卡片 | client 未构建/未被 graph 发现/namespace 未注册 | 查 package exports、dsh.client、Host loader 日志 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | 无有效 credential 或 enabled/配置问题 | 配置 credentials，检查 rpm/key |
| 仍走 deepseek-official | Bundle 未覆盖 web row 或用户 patch 后覆盖 | dump-config 检查 `include:web` |
| 点击刷新无变化 | Host 未重启或 tick 未触发 | 重启 DSH，检查 settings/updated 和 usageDiagnostic |
| usage 发布失败 | settings provider/写入冲突/服务已 dispose | 查 logger 和 usageDiagnostic |
| npm peer 解析到 rc.1 | 使用了 latest 或 `*` | 改为精确 rc.7/next，清理 lock/node_modules |
| 更新后 client 404 | tarball 缺少 `exports['./client']` 或 client 文件 | 检查 pack 内容并重装 |

## 25. 实现任务拆分

### Task 1：Package/Bund​le contract

文件：

```text
package.json
cordis.patch.yml
README.md
```

交付：

- metadata。
- bundle patch。
- rc.7 peer。
- pack files。
- 安装说明。

验收：bundle/install contract tests。

### Task 2：Client rc.7 修复

文件：

```text
src/dsh/client.js
```

交付：

- keyed slot。
- 客户端生命周期清理。
- 保存/刷新错误反馈。
- factory contract。

验收：client contract tests + node check。

### Task 3：Legacy script 和文档迁移

文件：

```text
scripts/patch-api-proxy-namespace.mjs
scripts/run-tests.mjs
docs/挂载指南.md
docs/升级与回滚指南.md
docs/开发事故复盘与规范.md
AI搜索Key池负载均衡-开发计划.md
```

交付：

- rc.7 no-op/legacy 检测。
- 删除过时白名单主流程。
- 新安装/升级/回滚文档。
- 事故规范增加 keyed slot 和 bundle 规则。

验收：脚本测试、文档审查。

### Task 4：Core/provider 稳定性补强

文件：

```text
src/core/*
src/adapters/*
src/dsh/provider.js
src/dsh/config.js
src/dsh/index.js
```

交付：

- 不改变已有公开配置语义。
- 补并发/取消/超时/usage 竞态测试。
- 只在测试暴露问题时做最小修复。

验收：全量测试、质量审查。

### Task 5：集成和打包验证

文件：

```text
tests/*
```

交付：

- package/bundle/client/install tests。
- pack dry-run 检查。
- 临时 profile compose 验证脚本或记录阻塞。

验收：完整 verification report。

## 26. 代码审查清单

### 26.1 规范审查

- [ ] 所有需求都有对应实现或明确记录为 out-of-scope。
- [ ] rc.7 bundle metadata 存在。
- [ ] 安装流程不修改 shipped DSH 文件。
- [ ] web provider 在 Host 层。
- [ ] keyed slot 使用正确 key。
- [ ] 不依赖白名单 patch。
- [ ] 不写未注册 session event。
- [ ] 文档中没有把 rc.6 作为 rc.7 事实。

### 26.2 质量审查

- [ ] 没有模块级可变单例状态。
- [ ] dispose 可逆。
- [ ] 每个 timer/listener 都有清理。
- [ ] 外部 abort 与内部 timeout 区分。
- [ ] 429 不重复计失败。
- [ ] 当前请求候选快照稳定。
- [ ] usage 单飞。
- [ ] usage 旧 pool 不能覆盖新 pool。
- [ ] secret 不进入日志、普通 settings 或模型结果。
- [ ] HTTP 错误 body 清理。
- [ ] client 过期异步响应不会覆盖新状态。
- [ ] npm pack 不包含本地私密文件。

## 27. 最终交付物

实现完成后，项目必须包含：

1. `dsh-web-search-pool@0.3.0` 源码。
2. `cordis.patch.yml` Bundle patch。
3. rc.7 原生安装指南。
4. 升级/回滚指南。
5. rc.7 研究简报。
6. 全量测试和本地 runner。
7. package/bundle/client contract tests。
8. `npm pack --dry-run` 记录。
9. `node --check` 记录。
10. 临时 profile 或真实 web profile 验证记录。
11. 变更摘要和已知限制。
12. 如真实供应商 key 未提供，明确标记真实搜索未验证，不得声称真实搜索通过。

## 28. 完成定义

只有同时满足以下条件，才能宣称方案 A 完成：

```text
代码：
  package.json / cordis.patch.yml / Host / Client 已实现

兼容：
  rc.7 package / bundle / settings / keyed slot 契约通过

测试：
  所有测试通过，且测试数量和失败数有真实输出

打包：
  npm pack --dry-run 通过，包内容无泄漏

安装：
  标准 dsh plugin 命令可安装或已记录明确环境阻塞

运行：
  web row 选择 search-pool
  设置卡片加载
  provider 可用性和错误路径正常

文档：
  安装、升级、回滚、故障排查与来源已更新

审查：
  规范审查通过
  代码质量审查通过
  最终新鲜验证通过
```

## 29. 设计决策摘要

| 决策 | 选择 | 原因 |
|---|---|---|
| DSH 集成形态 | 原生 Bundle | 与官方插件安装、升级和组合机制一致 |
| provider 位置 | Host composition | web seam 和搜索网络访问属于 Host |
| agent preset | 不承载 provider | 避免 session scope、服务可见性和重复注册问题 |
| 核心调度 | 保留并补测 | 现有架构与单 provider seam 同构 |
| settings 暴露 | rc.7 自动暴露 | 不再 patch 安装目录白名单 |
| Client slot | keyed，key=namespace | rc.7 官方 slot contract 要求 |
| 密钥存储 | credentials service | 避免 secret 进入 settings/document/client response |
| 限流状态 | 进程内存 | 个人单机单实例目标足够，保留后端抽象 |
| usage 刷新 | 后台单飞 | 不阻塞搜索首字节，避免 UI 静默挂起 |
| 失败重试 | 请求级候选快照 | 避免动态禁用导致重试索引错位 |
| 429 | Retry-After 驱动冷却 | 上游网关普遍存在忽略 Retry-After 的问题 |
| 可观测性 | `ctx.logger` | 不破坏会话历史格式 |
| 发布方式 | npm package/tarball | 官方 profile plugin 机制可识别并组合 |
| 版本目标 | `0.3.0` | 从普通 rc.6 时代安装方式迁移到 rc.7 Bundle 属于兼容性升级 |
