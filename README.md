# AI 搜索 Key 池负载均衡

`dsh-web-search-pool` 是 DeepSeek Harness 的网页搜索插件。它把多个 Tavily key 和可选的 Exa key
组织成一个 key 池，按每个 key 的 RPM 限流自动负载均衡，并在 429、凭据缺失、额度耗尽或上游失败时
自动切换到其他 key 或供应商。插件还提供设置页卡片，可配置 key 池、查看 Tavily 额度总览并手动刷新。

- 设计依据与决策记录：[`AI搜索Key池负载均衡-开发计划.md`](AI搜索Key池负载均衡-开发计划.md)
- 挂载与配置：[`docs/挂载指南.md`](docs/挂载指南.md)
- 全面检查报告：[`docs/全面检查报告.md`](docs/全面检查报告.md)（含 2026-08-16 稳定性/效率/跨平台重构记录）
- 许可证：[`LICENSE`](LICENSE)（MIT）

## 部署

1. 克隆本仓库，进入项目目录并生成可安装包（推荐，避免 ESM symlink 解析问题）：

   ```bash
   cd dsh-web-search-pool
   npm pack
   ```

2. 在 `$DSH_HOME/profiles/web/package.json` 的 `dependencies` 中加入 tgz 依赖：

   ```json
   {
     "dependencies": {
       "dsh-web-search-pool": "file:<本仓库绝对路径>/dsh-web-search-pool-0.2.0.tgz"
     }
   }
   ```

3. 安装 profile 依赖并编辑 `cordis.patch.yml`：

   ```bash
   cd "$DSH_HOME/profiles/web"
   pnpm install
   ```

4. 按 [`docs/挂载指南.md`](docs/挂载指南.md) 配置 `web.searchProvider`、key 池、凭据和 settings 白名单脚本。

5. 重启 `dsh web`。

> 如果直接使用 `file:<仓库源码目录>` 引用，必须在插件源码目录先安装 peer 依赖，
> 否则启动会报 `Cannot find package '@deepseek-ai/dsh-settings'`：
>
> ```bash
> npm install --no-save \
>   @deepseek-ai/cordis \
>   @deepseek-ai/dsh-credentials \
>   @deepseek-ai/dsh-launch-environment \
>   @deepseek-ai/dsh-settings \
>   @deepseek-ai/dsh-web \
>   @deepseek-ai/schemastery
> ```

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
│   ├── patch-api-proxy-namespace.mjs  # DSH 升级后恢复 settings 白名单的幂等脚本（跨平台）
│   ├── check-usage.mjs                # Tavily key 用量 CLI 诊断（支持 DSH_HOME / env / .env）
│   └── run-tests.mjs                  # 同进程顺序跑全部测试（规避 Windows 沙箱 spawn EPERM）
├── docs/
│   ├── 挂载指南.md                    # 挂载到 DSH + 配置 + 验证 + 白名单脚本
│   └── 全面检查报告.md                # 2026-08-15 检查 + 2026-08-16 重构记录
├── src/
│   ├── core/                          # 核心调度库（纯 JS，不依赖 DSH）
│   │   ├── constants.js               # 常量 + DEFAULTS（默认值唯一权威来源）+ 类型 JSDoc
│   │   ├── errors.js                  # SearchPoolError / RateLimitError / ...
│   │   ├── http-utils.js              # parseRetryAfter / rethrowIfAborted / discardBody / withTimeout
│   │   ├── key-pool.js                # KeyPool：冷却 + 失败计数 + 熔断（O(1) 索引）
│   │   ├── rate-limiter.js            # 令牌桶限流 + 存储后端抽象（内存实现）
│   │   ├── query-intent.js            # query 意图解析（时间/域名/主题）
│   │   ├── resolve-params.js          # 高级参数三态解析（on/off/auto）
│   │   └── scheduler.js               # Scheduler：加权轮询 + 429 换 key + failover
│   ├── adapters/                      # 供应商适配器（不依赖 DSH）
│   │   ├── tavily.js                  # TavilyAdapter
│   │   └── exa.js                     # ExaAdapter（REST + 匿名 MCP）
│   └── dsh/                           # DSH composition 插件（依赖 DSH 包）
│       ├── config.js                  # Config schema + resolveOptions（含 enabled/remark）
│       ├── provider.js                # SearchPoolProvider
│       ├── index.js                   # name / inject / apply + 开关同步 web.searchProvider
│       └── client.js                  # 浏览器端 client half：设置页「搜索 Key 池」卡片
└── tests/                             # node:test 单元测试（87 例）
    ├── key-pool.test.js
    ├── rate-limiter.test.js
    ├── scheduler.test.js
    ├── adapters.test.js
    ├── query-intent.test.js
    ├── resolve-params.test.js
    ├── provider.test.js
    ├── http-utils.test.js
    └── scripts.test.js
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
- **额度刷新（后台化）**：Host 维护 Tavily 额度缓存（`usageCacheMs` 控制过期），过期时**后台单飞刷新、
  绝不阻塞搜索首字节**——本轮额度闸门用旧缓存判断，完全无缓存时先放行、靠上游错误兜底，刷新完成后
  自动恢复闸门并解除已恢复 key 的长冷却；"立即刷新"由 Client 递增 `usageRefreshTick` 触发。
  插件入口除 `installSettingsSection` 外还监听 `settings/updated` 事件，避免 include/loader 场景下
  `scope.watch` 已注册但不触发的问题；刷新并行查询全部 key（15 秒总超时），失败会写入
  `usageDiagnostic` 并在设置页显示。
- **provider**：`search()` 循环「acquire → resolve 凭据 → adapter 调用」，429/失败/超时自动换下一个
  key（上限 = key 总数）；**每次尝试有独立超时**（`requestTimeoutMs`，默认 20 秒，0 禁用），超时按
  key 失败处理并换 key，与外部用户取消严格区分；凭据解析抛错不会中断整个搜索。每次尝试写入插件日志
  （`ctx.logger`，不含密钥明文；不写未注册会话事件）。

## 开发约定

- 核心逻辑位于 `src/core` 与 `src/adapters`，纯 JS、不依赖 DSH，可跨平台复用。
- **零第三方依赖**：`dependencies` / `devDependencies` 均为空；`peerDependencies` 里的
  `@deepseek-ai/*` 是 DSH 宿主在运行时提供的接口包（由 DSH 安装提供，不需要单独安装），
  不属于第三方运行时依赖。所有实现只用 Node 内置能力与标准 Web API（fetch/AbortController）。
- 测试使用 Node 内置 `node:test`，要求 Node 18+（不使用 `AbortSignal.any` 等 Node 20 API）。
- 不硬编码平台路径；部署文档统一使用 `$DSH_HOME` 和 `<...>` 占位符；脚本跨平台
  （Windows / macOS / Linux 的全局 node_modules 探测 + `DSH_API_PROXY_INDEX` / `DSH_HOME` 逃生口）。
- 发布/部署优先 `npm pack` 生成 tgz，避免 ESM symlink 依赖解析问题。

## 测试

推荐用跨平台 runner（同进程顺序执行，不 spawn 子进程，Windows 沙箱可用）：

```bash
npm run test:local        # = node scripts/run-tests.mjs
```

也可以逐个文件直接运行（node:test inline 模式）：

```bash
node tests/key-pool.test.js
node tests/rate-limiter.test.js
# ... 共 9 个文件
```

> 说明：`npm test`（`node --test tests/`）在 Windows 沙箱下会因 `spawn EPERM` 失败（test runner 需
> spawn 子进程），此时用 `npm run test:local` 或逐文件运行。当前 87 个用例全过。

## 实现状态（2026-08-16 更新）

- [x] 核心调度库（KeyPool / TokenBucketLimiter / Scheduler）
- [x] Tavily / Exa 适配器
- [x] 高级功能：默认打开 + auto（AI 可选）模式
- [x] DSH provider 封装（`search-pool`）
- [x] 设置页卡片（client half，已固化进包，重启不丢）
- [x] 搜索开关 + key 备注
- [x] 单元测试（87 个用例，全过）
- [x] 额度刷新发布链路与手动刷新（`settings/updated` 事件兜底 + 超时/诊断）
- [x] 挂载验证（provider 已挂载；真实搜索待填 Tavily/Exa key）
- [x] DSH 安装目录 patch 自动化（白名单脚本 + 会话事件目录修复）
- [x] 2026-08-16 稳定性/效率/跨平台重构（详见 [`docs/全面检查报告.md`](docs/全面检查报告.md)）：
  搜索 per-attempt 超时、额度刷新后台化不阻塞搜索、pool 缓存浅比较去 JSON.stringify、
  O(1) key 索引、额度并行查询、client 定时器清理与竞态守卫、单次事务保存、
  跨平台 patch/check-usage 脚本、免 spawn 测试 runner
- [ ] 运行时状态（每个 key 的冷却 / 限流 / 失败徽章）
