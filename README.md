# AI 搜索 Key 池负载均衡

对多个 Tavily key 和可选的 Exa key 按各自限流做负载均衡，对外提供统一搜索服务，接入 DeepSeek Harness。

- 设计依据与决策记录：[`AI搜索Key池负载均衡-开发计划.md`](AI搜索Key池负载均衡-开发计划.md)
- 挂载与配置：[`docs/挂载指南.md`](docs/挂载指南.md)
- 全面检查报告：[`docs/全面检查报告.md`](docs/全面检查报告.md)
- 许可证：[`LICENSE`](LICENSE)（MIT）

## 方案概览

**方案 A**：在 DSH 内写一个「多 key 多供应商」`WebSearchProvider`（id `search-pool`）composition 插件，
内部实现 key 池 + 令牌桶限流 + 加权轮询调度 + Tavily/Exa 适配 + 429 换 key + 供应商 failover。
限流状态用进程内存（个人单机单实例）。

- **Host 侧**：provider 挂载到 web profile（`cordis.patch.yml`），提供搜索。
- **Client 侧**：包内 `client half` 在设置页「网页搜索」卡片下方注册「搜索 Key 池」卡片，支持查看/编辑配置、
  搜索开关切换、key 备注。
- 核心调度逻辑抽成**不依赖 DSH 的独立模块**（`src/core`、`src/adapters`），未来可无缝升级到
  多实例/多客户端共享形态（开发计划第 5 节路径 B1/B2）。

## 目录结构

```
AI搜索Key池负载均衡/
├── AI搜索Key池负载均衡-开发计划.md   # 设计与决策（定稿方案 A）
├── package.json                       # dsh-web-search-pool 包（out-of-tree 插件）
├── scripts/
│   └── patch-api-proxy-namespace.mjs  # DSH 升级后恢复 settings 白名单的幂等脚本
├── docs/
│   ├── 挂载指南.md                    # 挂载到 DSH + 配置 + 验证 + 白名单脚本
│   └── 全面检查报告.md                # 2026-08-15 插件全面检查与优化建议
├── src/
│   ├── core/                          # 核心调度库（纯 JS，不依赖 DSH）
│   │   ├── constants.js               # 常量 + 类型 JSDoc
│   │   ├── errors.js                  # SearchPoolError / RateLimitError / ...
│   │   ├── key-pool.js                # KeyPool：冷却 + 失败计数 + 熔断
│   │   ├── rate-limiter.js            # 令牌桶限流 + 存储后端抽象（内存实现）
│   │   ├── query-intent.js            # query 意图解析（时间/域名/主题）
│   │   ├── resolve-params.js          # 高级参数三态解析（on/off/auto）
│   │   └── scheduler.js               # Scheduler：加权轮询 + 429 换 key + failover
│   ├── adapters/                      # 供应商适配器（不依赖 DSH）
│   │   ├── tavily.js                  # TavilyAdapter
│   │   └── exa.js                     # ExaAdapter
│   └── dsh/                           # DSH composition 插件（依赖 DSH 包）
│       ├── config.js                  # Config schema + resolveOptions（含 enabled/remark）
│       ├── provider.js                # SearchPoolProvider
│       ├── index.js                   # name / inject / apply + 开关同步 web.searchProvider
│       └── client.js                  # 浏览器端 client half：设置页「搜索 Key 池」卡片
└── tests/                             # node:test 单元测试
    ├── key-pool.test.js
    ├── rate-limiter.test.js
    ├── scheduler.test.js
    ├── adapters.test.js
    ├── query-intent.test.js
    ├── resolve-params.test.js
    └── provider.test.js
```

## 核心设计

- **KeyPool**：`entries: { id, provider, credentialRef, rpm, remark? }[]`，管理每个 key 的 `cooldownUntil` / `failCount`；
  连续失败 `allowedFails` 次熔断（进入冷却并清零计数）。
- **TokenBucketLimiter**：每 key 一个令牌桶，`capacity=rpm`、`refill=rpm/60s`；存储后端抽象为 `{ get, set }`，
  当前内存实现，未来可换 Redis（Lua 原子化）。
- **Scheduler**：候选 key = 未冷却 && 令牌可用；策略 `weighted-round-robin`（smooth WRR，按 rpm 权重）或
  `least-used`（剩余令牌最多优先）；供应商按 `providerPriority` failover。
- **适配器**：统一 `search({ query, apiKey, maxResults, signal, ...高级参数 }) => SearchResult`；429 解析 `Retry-After` 抛
  `RateLimitError`，Tavily 的 `answer` → `content`，Exa 无答案。
- **高级功能（默认打开 + AI 可选）**：Tavily 默认 `search_depth: advanced` + `include_answer: true`；Exa 默认
  `useAutoprompt: true` + 深度提取（`contents: { text, highlights, summary }`）。日期/域名/主题等依赖 query 的参数
  默认 `auto`，由 `query-intent.js` 按 query 语义决定（时间词 / `site:` 语法 / 新闻财经主题词），也可显式配值或 `off` 关闭。
- **搜索开关（`enabled`）**：开启时 `web.searchProvider = search-pool`；关闭时动态切回 `deepseek-official`，
  避免两个搜索提供方冲突。由 `index.js` 监听 settings 变化后更新 `include:web` 的 loader config。
- **设置页卡片（client half）**：注册在 `settings.plugin.item`（order 21），读 `web-search-pool` 设置项展示并编辑
  策略/优先级/熔断/key 增删/key 备注，内部样式与 harness 其他插件卡片一致。
- **额度刷新**：Host 每 `usageCacheMs` 自动刷新 Tavily 额度；“立即刷新”由 Client 递增
  `usageRefreshTick` 触发。插件入口除 `installSettingsSection` 外还监听 `settings/updated`
  事件，避免 include/loader 场景下 `scope.watch` 已注册但不触发的问题；刷新带 15 秒超时，
  失败会写入 `usageDiagnostic` 并在设置页显示。
- **provider**：`search()` 循环「acquire → resolve 凭据 → adapter 调用」，429/失败自动换下一个 key（上限 = key 总数），
  每次尝试写入插件日志（`ctx.logger`，不含密钥明文；不写未注册会话事件）。

## 测试

核心库与适配器不依赖 DSH，可用 node 直接单测：

```bash
node tests/key-pool.test.js
node tests/rate-limiter.test.js
node tests/scheduler.test.js
node tests/adapters.test.js
node tests/query-intent.test.js
node tests/resolve-params.test.js
node tests/provider.test.js
```

> 说明：`npm test`（`node --test tests/`）在 Windows 沙箱下会因 `spawn EPERM` 失败（test runner 需 spawn 子进程），
> 故逐个文件直接运行更稳。当前 59 个用例全过。

## 实现状态（2026-08-15）

- [x] 核心调度库（KeyPool / TokenBucketLimiter / Scheduler）
- [x] Tavily / Exa 适配器
- [x] 高级功能：默认打开 + auto（AI 可选）模式
- [x] DSH provider 封装（`search-pool`）
- [x] 设置页卡片（client half，已固化进包，重启不丢）
- [x] 搜索开关 + key 备注
- [x] 单元测试（59 个用例，全过）
- [x] 额度刷新发布链路与手动刷新（`settings/updated` 事件兜底 + 超时/诊断）
- [x] 挂载验证（provider 已挂载；真实搜索待填 Tavily/Exa key）
- [x] DSH 安装目录 patch 自动化（白名单脚本 + 会话事件目录修复）
- [ ] 运行时状态（每个 key 的冷却 / 限流 / 失败徽章）
