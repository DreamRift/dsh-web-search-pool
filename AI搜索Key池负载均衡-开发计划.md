# AI 搜索多 Key 负载均衡：方案分析与开发计划

> 目标：对多个 Tavily key 和可选的 Exa key 按各自限流做负载均衡，对外提供统一搜索服务，并接入 DeepSeek Harness。
> 调研日期：2026-08-14。本地结论基于对已安装 DSH 源码的直接阅读；开源结论基于 web 检索（无法直连 GitHub 正文处均已标注）。

---

## 0. 决策记录（Decision Log）

| 项 | 决策 | 日期 |
|---|---|---|
| 部署形态 | **个人单机单实例** | 2026-08-14 |
| 技术路线 | **方案 A：在 DSH 内写「多 key 多供应商」provider（composition 插件）**，限流状态用进程内存 | 2026-08-14 |
| 多实例/多客户端共享 | **暂不做**，但设计上预留扩展路径（见第 5 节「扩展备忘」，未来触发时升级） | 2026-08-14 |
| 工作区 | 在**另一个工作区**开展实现（本文档作为设计依据与交接文档） | 2026-08-14 |
| Exa 免 key | **Exa 匿名免费层**：官方托管 MCP `https://mcp.exa.ai/mcp` 的 `web_search_exa` 无需 API key（免费有限流）；有 key 走 REST 提配额 | 2026-08-15 |

**定稿结论**：个人单机单实例下，方案 A 是架构正解 + 最小运维成本。核心调度逻辑（key 池 / 限流 / 适配器）抽成**不依赖 DSH 的独立模块**，保证未来能无缝升级到共享形态。

---

## 0b. 结论速览（TL;DR）

1. **DSH 的网页搜索是「单一 provider」架构**：`web_search` 工具 → `ctx.web.search()` → 恰好一个 `WebSearchProvider`。seam 不做多 provider 负载均衡——**负载均衡必须封装在单个 provider 内部**。这是明确的架构信号：多 key、多供应商的均衡逻辑天然属于「一个 provider」的内部实现。
2. **DSH 没有内置 Tavily/Exa provider**（内置只有 DeepSeek 官方搜索 `deepseek-official`，且只支持单 key）。要接 Tavily/Exa，必须自己写 provider。
3. **发 HTTP 的 provider 必须是 composition 插件**（真实 Node 包 + `agent.cordis.yml` 挂载），**不能是动态 Cordis 插件**——动态插件的 Host 沙箱没有 `fetch`。
4. **开源项目调研结论**：没有一个现成项目能完整满足「同供应商多 Tavily key + Exa 按限流均衡」。但 LLM 网关（LiteLLM / one-api）的 key 池 + 限流 + 熔断模式可直接借鉴。
5. **已定方案 A**：在 DSH 内写一个「多 key 多供应商」provider 插件；核心调度逻辑独立成库；单实例用内存限流；多实例共享留作未来扩展（第 5 节）。

---

## 1. 需求

| 项 | 内容 |
|---|---|
| 供应商 | Tavily（多个 key）、Exa（0..N 个 key，可匿名免费层） |
| 调度要求 | 在每个 key 之间按各自限流（RPM/配额）做负载均衡 |
| 故障处理 | 单 key 触发限流/失败时自动切换到其它 key，供应商间可 failover |
| 对外形式 | 统一的搜索服务，接入 DeepSeek Harness |
| 部署形态 | **个人单机单实例**（已确认） |

---

## 2. DeepSeek Harness 现有网页搜索架构（本地源码调研，硬结论）

### 2.1 调用链

```
模型调用 web_search 工具
   │  (@deepseek-ai/dsh-tool-web 负责 schema / 校验 / 结果格式化)
   ▼
ctx.web.search(request, signal)
   │  (@deepseek-ai/dsh-web 的 WebRuntime，能力 seam)
   ▼
选中的 WebSearchProvider.search(request, signal)
   │  (provider 负责真正的网络访问)
   ▼
归一化的 WebSearchResult { content?, sources[], truncated }
```

### 2.2 `WebSearchProvider` 接口（`@deepseek-ai/dsh-web`）

```ts
interface WebSearchProvider {
  readonly id: string;
  available(): boolean;          // 本地可用性检查，不能发网络请求
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
interface WebSearchRequest { query: string; maxResults?: number; }
interface WebSearchResult { content?: string; sources: WebSearchSource[]; truncated: boolean; }
interface WebSearchSource { url: string; title?: string; snippet?: string; publishedAt?: string; }
```

### 2.3 关键约束（决定方案的核心）

1. **seam 只选单一 provider**。选择语义：
   - 配置了 `searchProvider`（或 `$DSH_WEB_SEARCH_PROVIDER`）→ 用它；
   - 未配置且恰好一个可用 provider → 自动选它；
   - 未配置且多个可用 provider → 抛 `WEB_PROVIDER_AMBIGUOUS`。
   - ⇒ **多 key/多供应商的负载均衡不能靠「注册多个 provider」，只能封装在一个 provider 内部。**

2. **内置 provider 仅 `deepseek-official`**（`@deepseek-ai/dsh-web-search-deepseek`），单 key，走 DeepSeek Anthropic 兼容 Messages API。**没有内置 Tavily/Exa provider。**

3. **动态 Cordis 插件的 Host 沙箱没有 `fetch`**（实测 Builtin 仅 `ctx/harness/console/btoa/atob/TextEncoder/TextDecoder`；Service 目录无 HTTP 客户端）。而内置 provider 是在真实 Node 包（composition 插件）里直接 `fetch(...)` 的。⇒ **要发 HTTP 的 provider 必须写成 composition 插件**，挂载到 `agent.cordis.yml`。

4. **凭据走 `ctx.credentials`**。`CredentialRef` 是 POSIX 风格环境变量名（如 `TAVILY_API_KEY_1`），每次操作 `resolve(ref)` 读取，换 key 无需重启。key 池最干净的做法：配置里放一组 `credentialRef`，运行时逐个 resolve。

5. **provider 是「实现包」，不发布服务、只消费 `web` 服务**（`inject: ['web']`）。按 composition 规则，它可以 loose 地放在 preset 里，无需 `isolate` realm。

### 2.4 落地位置

- 用户 preset 目录：`~/.dsh/.agent-presets/<id>/agent.cordis.yml`（本机当前此目录尚不存在，说明在用 shipped preset；按规则需先 `copy()` 一份再改）。
- provider 包本身：一个本地 npm 包（或发布到 registry），在 `agent.cordis.yml` 里用包名挂载，配置走 Settings 段（参考 `dsh-web-search-deepseek` 的 `installSettingsSection` 模式）。

---

## 3. GitHub / 开源项目调研汇总

### 3.1 搜索 API 专项项目（直接相关）

| 项目 | 定位 | 匹配度 | 缺口 |
|---|---|---|---|
| `@iflow-mcp/tavily-mcp-loadbalancer`（npm + Docker，GitHub 仓库未检索到） | Tavily 专用多 key 池负载均衡 MCP server | 覆盖「同供应商多个 Tavily key」这一半 | 仅 Tavily 单供应商，无 Exa；限流算法/持久化细节未确认；对外是 MCP 工具非 REST |
| `ykq007/mcp-nexus` | 多搜索供应商聚合 MCP（Tavily + Brave 等） | 方向正确（多供应商统一） | 「同供应商多 key 池 + 按限流均衡」与 Exa 支持均未证实 |
| `smithyyang/pi-web-lite` | Pi 的 web 搜索扩展，Exa/Tavily/Brave/Doubao + routing + failover + tests | **架构同构**（多供应商路由 + failover） | 官方描述**未声明**同供应商多 key |
| `WDAPM`（WebDataApiProxyManager） | AI 搜索中转，聚合 Exa+Tavily + 代理池管理 | 定位最对口 | 仓库地址、限流机制、API 格式、部署方式均未检索到，无法选型 |
| `Khamel83/argus` | 多供应商搜索代理（14 providers 含 Tavily），预算感知路由，单一 API | 可作中转站参考 | 细节未深究 |
| `llm-keypool`（piyush-tyagi-13） | key 轮换 + 冷却 + OpenAI 兼容代理 | 可作 KeyPool 层参考 | 面向 LLM |

### 3.2 通用 LLM 网关（模式参考，非直接可用）

| 项目 | 值得借鉴的模式 |
|---|---|
| **LiteLLM** | deployment 池（同模型多 key）+ `round-robin / least-busy / usage / latency / weighted` 路由 + `cooldown`/`allowed_fails` 熔断 + 跨供应商 `fallbacks` + Redis 分布式限流。**首选架构参考**。教训：Retry-After 解析在 LiteLLM 自身都历经 bug，自研时要把「429 + Retry-After → 自适应冷却」做成一等公民。 |
| **one-api / new-api** | 「渠道 = 一个 key」+ 权重 + 优先级 + 按成功率自动禁用 + 定时恢复。**最小可运营参考**。短板：无请求级限流预分配，failover 偏粗粒度。 |
| Portkey | loadbalance / fallback / conditional / pin 路由组合 + 熔断器 |
| Kong / APISIX | 限流算法成熟（固定/滑动窗口、漏桶、Redis 同步），但无「上游 key 池」概念，需重写业务层 |

### 3.3 调研结论

**没有现成项目可直接满足需求**。但结论很清晰：把 LLM 网关的「key 池 + 限流 + 冷却 + failover」模式，套到搜索 API（Tavily/Exa）上即可。这个核心逻辑很薄，自研成本低。

---

## 4. 两种方案对比（结论：方案 A 定稿）

### 方案 A：在 DSH 内写「多 key 多供应商」provider 插件

一个 `WebSearchProvider`（id 如 `search-pool`），内部实现 key 池 + 限流 + 调度 + Tavily/Exa 适配 + failover。写成 composition 插件挂载到 `agent.cordis.yml`。

**优点**
- 原生契合 DSH 架构（seam 本就要求「单一 provider 内部封装」）。
- 无额外服务、无多一跳延迟、无运维负担。
- 个人单实例场景，内存限流（令牌桶/滑动窗口）完全够用。
- 配置走 DSH Settings + `ctx.credentials`，换 key 不用重启。

**缺点**
- key 池/限流/熔断逻辑需自研（但很薄）。
- 限流状态在进程内存：多实例/多进程共享 key 池时需额外方案（见第 5 节扩展备忘）。
- 只能被 DSH 用，其它客户端复用不了（见第 5 节扩展备忘）。

### 方案 B：API 中转站 + DSH 简单 provider（当前不采用，留作扩展）

独立起一个中转服务，统一入口做 key 池 + 限流 + 多供应商，暴露统一 API。DSH 侧只写一个「单 endpoint 转发」的简单 provider。详见第 5 节。

### 对比表

| 维度 | 方案 A（DSH 内 provider） | 方案 B（中转站） |
|---|---|---|
| 契合 DSH 架构 | ★★★★★（seam 本就要求单 provider 封装） | ★★★（DSH 侧仍要写 provider） |
| 部署运维成本 | 无额外服务 | 需常驻服务 + 存储 |
| 多实例/多客户端复用 | ✗ | ✓ |
| 限流状态持久化 | 内存（单实例够） | 可 Redis/DB |
| 延迟 | 直连供应商 | 多一跳 |
| 自研工作量 | key 池 + 限流 + 2 个 adapter | 中转站全套 + DSH 转发 provider |
| 复用现成项目 | 借鉴模式 | 可借鉴/改造 one-api、WDAPM |

**决策依据（方案 A）**：
1. 你明确要接入 DSH，而 DSH 的 seam 架构天然指向「单 provider 内部做均衡」——方案 A 是架构正解。
2. 「同供应商多 key + Exa」这类个人/小团队量级，单实例内存限流足够，方案 B 的 Redis/DB/常驻服务是过度设计。
3. 现成项目都不完整（tavily-mcp-loadbalancer 无 Exa、WDAPM 细节不可得、pi-web-lite 无同供应商多 key），「改造现成」不如「自研薄层」。
4. 自研核心逻辑非常薄：key 池（~100 行）+ 令牌桶/滑动窗口（~50 行）+ 429 冷却（~30 行）+ Tavily/Exa 两个 adapter（各 ~60 行）。

---

## 5. 扩展备忘：多实例 / 多客户端共享 key 池

> **本节当前不实施**，仅作为未来升级的设计依据。核心调度库从一开始就与 DSH 解耦，保证本节任一方案都能「套壳」落地而不重写核心逻辑。

### 5.1 触发条件（满足任一即考虑升级）

1. 需要**多个 DSH 进程/实例**共享同一批 key 的限流状态（例如多机、多容器、或同一台机器跑多个 harness 实例）。
2. key 池要服务 **DSH 之外的客户端**（其它 agent 框架、MCP、脚本、HTTP 调用方、其它应用）。
3. 需要**持久化的用量统计 / 计费 / 审计**（内存态重启即丢）。

### 5.2 关键设计前提（现在就要遵守，避免未来返工）

1. **核心调度库不依赖 DSH**：KeyPool / RateLimiter / Scheduler / Adapters 用纯函数/纯类实现，接口只收 `{ query, maxResults, signal }` 返回归一化结果。这样既能被 DSH provider 调，也能被 HTTP 服务调。
2. **限流器抽象出「存储后端」接口**：内存实现（现在）与 Redis 实现（未来）实现同一接口，切换只换实现、不改调度逻辑。
3. **冷却与失败计数是可序列化状态**：未来可直接映射到 Redis key/TTL 与 INCR。

### 5.3 三个升级路径（按改动量递增）

#### 路径 B2：Redis 分布式限流（最小改动，仍只服务 DSH）

保持 DSH 内 provider，仅把限流计数从内存换成 Redis。

- 令牌桶原子化：Redis **Lua 脚本**（取令牌 → 减计数 → 返回剩余/等待时间）保证并发安全。
- 冷却状态：`SET key EX cooldownSec`，TTL 自动过期。
- 失败计数：`INCR` + 阈值判断（`allowedFails`）。
- 各实例指向同一 Redis；时钟用服务端时间，避免多机时钟漂移。
- 适用：多实例但仍只给 DSH 用。

#### 路径 B1：独立 HTTP 中转站（推荐，通用性最强）

把核心库包装成 HTTP 服务，对外暴露统一入口。

- 服务形态：Node/Express（或复用 one-api 渠道模型 / LiteLLM deployment 池思路改造）。
- 状态持久化：**SQLite（单机）/ PostgreSQL + Redis（分布式）**；限流计数与冷却在 Redis（同上 Lua 令牌桶）。
- 对外 API：`POST /search`，可兼容 Tavily 原生请求格式（`{ api_key, query, max_results }`）以最小化客户端适配成本；内部按 key 池调度。
- DSH 侧：provider 改为「单 endpoint 转发」（一个 endpoint + 一个中转站 token，不再持有 11 个 key）。
- 适用：要服务 DSH 之外的客户端，或需要集中计量。

#### 路径 B3：复用/改造现成网关（省自研，但需适配）

- **one-api / new-api**：渠道=key + 权重 + 优先级 + 按成功率自动禁用。需补「请求级限流预分配」与「请求级 failover」。
- **LiteLLM**：deployment 池 + cooldown + fallback + Redis 限流。需扩展「非 LLM 搜索 API」的适配（Tavily/Exa 不在其内置 provider 列表，属社区 feature 讨论阶段）。
- 适用：不想自研中转站、接受其约束时。

### 5.4 演进路径图

```
当前（方案 A）          未来升级
┌────────────────┐      ┌──────────────────────┐
│ DSH provider   │      │ 多实例共享限流（B2）   │  ← 加 Redis 后端，provider 不变
│  ├ 核心调度库   │ ───▶ │ 或                    │
│  ├ 内存限流     │      │ HTTP 中转站（B1）      │  ← 核心库包 HTTP 壳，DSH 改转发
│  └ Tavily/Exa   │      │ 或                    │
└────────────────┘      │ 现成网关改造（B3）      │
                        └──────────────────────┘
```

---

## 6. 开发计划

### 阶段 0：需求确认（半天）

- [x] 使用场景：**个人单机单实例**（已确认）。
- [x] 限流值：免费额度为**额度制**（Tavily ~1000 credits/月、Exa ~1000 请求/月），官方文档未给出免费档的每请求硬限速（RPM/RPS）；按 2026-08-14 会话约定，**默认 60 rpm（1 次/秒）**，实现为配置驱动，换真实值不改代码。来源：[Tavily Rate Limits](https://docs.tavily.com/documentation/rate-limits)、[Tavily free tier: 1000 calls/month](https://theneuralbase.com/tavily-api/learn/beginner/free-tier-1000-calls-month/)、[Exa free tier](https://theneuralbase.com/exa-api/learn/beginner/free-tier-limits/)。
- [x] 结果要求：`maxResults` 沿用 DSH `tool-web` 默认 8（seam 层统一截断）；Tavily `answer` → `content`，Exa 无答案则省略 `content`。

### 阶段 1：核心调度库（自研，纯函数/纯类，可独立单测，不依赖 DSH）

1. **KeyPool**：`entries: { id, provider, credentialRef, rpm, cooldownUntil, failCount }[]`，提供 `nextUsable()`。
2. **RateLimiter**：每 key 一个令牌桶（token bucket，capacity=rpm, refill=rpm/60s）或滑动窗口；`tryAcquire(entry)` 返回是否放行。**抽象「存储后端」接口**，内存实现 + 未来 Redis 实现（第 5.2 条）。
3. **Scheduler**（核心）：
   - 候选 key = 未冷却 && 令牌可用的 key；
   - 策略默认 `weighted-round-robin`（按 key 的 rpm 权重轮询），可选 `least-used`；
   - 供应商优先级：默认 Tavily 优先、Exa 兜底（可配置 `providerPriority`）；
   - 失败处理：HTTP 429 → 解析 `Retry-After`（或退避默认值）→ 该 key 进入 `cooldown` → 立即换下一个 key；连续失败 `allowedFails` 次 → 熔断一段时间；供应商内 key 全不可用 → failover 到下一供应商。
4. **可复用性**：这一层不依赖 DSH，之后既能被 provider 用，也能被 HTTP 外壳（第 5 节路径 B1）用。

### 阶段 2：供应商适配器

统一接口 `SearchAdapter { search(query, apiKey, maxResults, signal) => WebSearchResult }`：

1. **TavilyAdapter**：`POST https://api.tavily.com/search`，body 含 `api_key`/`query`/`max_results`，`results[]` → `WebSearchSource`，`answer` → `content`。429 → 抛可识别的限流错误（带 Retry-After）。
2. **ExaAdapter**：`POST https://api.exa.ai/search`（header `x-api-key`），`results[].text` → `snippet`，`publishedDate` → `publishedAt`。429 同样识别。

> 均需以官方文档校准字段（Tavily [docs.tavily.com](https://docs.tavily.com/documentation/api-reference/endpoint/search)、Exa [docs.exa.ai](https://docs.exa.ai/reference/search)）。

### 阶段 3：DSH provider 封装（composition 插件）

仿照 `@deepseek-ai/dsh-web-search-deepseek` 的结构，写一个包（建议名 `dsh-web-search-pool`）：

- `inject: ['web']`，`apply(ctx, config)` 里 `ctx.web.registerSearchProvider(new SearchPoolProvider(() => resolveOptions(ctx, current())))`。
- `available()`：至少一个 key 可 resolve（本地检查，不发网络）。
- `search()`：resolve 出本次 key 池 → Scheduler 选 key → 对应 adapter 调用 → 归一化返回；429 自动换 key 重试（有上限）。
- 用 `installSettingsSection` 提供配置段；凭据用 `ctx.credentials`（`credentialRef`），每次操作 resolve，不缓存。
- 可选：用 `ctx.logger` 记录每次用了哪个 key / 是否 429（可观测性）；不要直接 `session.append` 未标记 `ignorable` 的自定义事件，rc.6 会话读取端会拒绝整个历史。

### 阶段 4：配置 schema

```yaml
- id: search-key-pool
  name: 'dsh-web-search-pool'   # 实际包名/本地路径
  config:
    providers:
      tavily:
        keys:
          - apiKeyEnv: TAVILY_API_KEY_1
            rpm: 60
          - apiKeyEnv: TAVILY_API_KEY_2
            rpm: 60
          # ... 共 10 个
      exa:
        keys:
          - apiKeyEnv: EXA_API_KEY_1
            rpm: 30
    strategy: weighted-round-robin   # 或 least-used
    providerPriority: [tavily, exa]
    allowedFails: 3
    cooldownMs: 30000
    retryAfterFallbackMs: 1000
```

- key 不进配置，`apiKeyEnv` 是 `CredentialRef`（环境变量名），值存 `ctx.credentials` 或进程环境。
- 若已有 `deepseek-official` provider 也在挂载，需显式配置 `searchProvider: search-pool`（或 `$DSH_WEB_SEARCH_PROVIDER=search-pool`），否则会 `WEB_PROVIDER_AMBIGUOUS`。

### 阶段 5：挂载与验证

1. `agentPresets.copy(from='standard', id=..., name=...)` 复制一份用户 preset。
2. 在复制的 `agent.cordis.yml` 加 provider row（本地包用 `file:` 依赖或 `npm link`，或发布到 registry 后用包名）。
3. `standingKeyFor(id)` 做 mount-validation（不能用 `list()` 的 `broken` 字段代替）。
4. 开一个真实 session 确认 `web_search` 走新 provider、多 key 轮换生效。

### 阶段 6：测试

- 单元：KeyPool 轮询/冷却、令牌桶限流、Scheduler 的 429 换 key 与 failover。
- 集成：用 mock HTTP（或 nock）模拟 429 + `Retry-After`，断言自动切换与重试上限。
- 实测：并发打 11 个 key，观测分布是否贴合 rpm 权重、无单 key 超限。

### 阶段 7：多实例 / 多客户端升级（未来，触发条件见第 5.1 节）

按第 5.3 节选择路径 B1 / B2 / B3。核心库与限流后端已抽象，切换实现即可，不重写调度逻辑。

---

## 7. 风险与待确认事项

| 项 | 说明 | 状态 |
|---|---|---|
| 供应商限流数值 | 各 key 的 rpm 需按实际 plan 配置，否则令牌桶参数不准。 | 待确认 |
| 429 语义差异 | Tavily/Exa 的 429 响应体与 `Retry-After` 头需实测，adapter 要做容错解析（有则用，无则用 `retryAfterFallbackMs`）。 | 待实测 |
| provider 包分发 | 本地 npm 包如何被 cordis loader 解析（`file:` / link / 发布），需按实际 loader 确认。 | 待确认 |
| 与 deepseek-official 并存 | 需显式配置 `searchProvider: search-pool` 避免 `WEB_PROVIDER_AMBIGUOUS`。 | 已识别，实现时处理 |
| 多实例扩展 | 已留设计备忘（第 5 节），当前不实施。 | 备忘 |

---

## 8. 参考资料

DSH 本地（已读源码）：
- `@deepseek-ai/dsh-web`（`ctx.web` seam 与 `WebSearchProvider` 契约）
- `@deepseek-ai/dsh-web-search-deepseek`（唯一内置 provider，单 key，fetch 实现在真实 Node 包内）
- `@deepseek-ai/dsh-tool-web`（`web_search` 工具、`WEB_SEARCH_MAX_RESULTS`）
- `@deepseek-ai/dsh-credentials`（`CredentialRef` / `resolve`）

开源项目（web 检索，2026-08-14）：
- LiteLLM 路由/负载均衡：https://docs.litellm.ai/docs/routing
- one-api 渠道负载均衡：https://jiekou.ai/zh/blog/one-api-multi-channel-load-balancing
- tavily-mcp-loadbalancer：https://socket.dev/npm/package/@iflow-mcp/tavily-mcp-loadbalancer/overview/2.1.0
- mcp-nexus：https://github.com/ykq007/mcp-nexus
- pi-web-lite：https://github.com/smithyyang/pi-web-lite
- WDAPM 中文介绍：https://www.80aj.com/2026/06/11/ai-search-proxy-manager-wdapm/
- Tavily 多 key 最佳实践：https://docs.tavily.com/documentation/best-practices/api-key-management
- llm-keypool：https://github.com/piyush-tyagi-13/llm-keypool
- Tavily 限流：https://docs.tavily.com/documentation/rate-limits

---

## 9. 实现状态（2026-08-15 更新）

> 方案 A 的核心开发、挂载与设置页卡片均已落地；真实搜索需填 Tavily/Exa key。
> 机制结论均来自对已安装 DSH 源码的直接阅读（来源见 `docs/挂载指南.md` 第 6 节）。

| 计划阶段 | 状态 | 产出 |
|---|---|---|
| 阶段 1 核心调度库 | ✅ 完成 | `src/core/`：KeyPool（冷却/熔断）、TokenBucketLimiter（令牌桶 + 存储后端抽象）、Scheduler（smooth WRR / least-used + 429 换 key + failover） |
| 阶段 2 供应商适配器 | ✅ 完成 | `src/adapters/`：TavilyAdapter（answer→content、429→Retry-After）、ExaAdapter（无 answer） |
| 阶段 3 DSH provider 封装 | ✅ 完成 | `src/dsh/`：SearchPoolProvider（id `search-pool`）、Config schema、`apply`；client half `client.js` 注册设置页卡片 |
| 阶段 4 配置 schema | ✅ 完成 | schemastery schema：`enabled`（搜索开关）、`providers.{tavily,exa}.keys[]`（含 `remark` 备注）、`strategy`、`providerPriority`、`allowedFails`、`cooldownMs`、`retryAfterFallbackMs`、额度控制（`usageCacheMs`/`quotaReserveCredits`/`quotaExhaustedCooldownMs`）、运行时字段（`usage`/`usageRefreshTick`/`usageDiagnostic`） |
| 阶段 5 挂载与验证 | ✅ 完成 | 已挂载到 web profile（`cordis.patch.yml` + junction）；provider 已挂载；设置页卡片可读配置/编辑/开关；api-proxy 白名单脚本 `scripts/patch-api-proxy-namespace.mjs`；额度命令行脚本 `scripts/check-usage.mjs` |
| 阶段 6 测试 | ✅ 完成 | 59 个 node:test 用例全过（KeyPool/RateLimiter/Scheduler/Adapters/Provider/query-intent/resolve-params） |
| 阶段 7 多实例升级 | 📝 备忘 | 核心库已与 DSH 解耦，存储后端已抽象，升级路径见第 5 节 |

### 关键实现决策（相对计划的补充/修正）

1. **挂载位置修正**：host 层 `web` row 已显式配置 `searchProvider: deepseek-official`，且
   `WebRuntime.searchProviderId = config.searchProvider ?? env`（config 优先），所以仅设
   `$DSH_WEB_SEARCH_PROVIDER=search-pool` **不生效**。必须覆盖 host `web` row 的 config，因此 provider
   挂到 host 层（profile `cordis.patch.yml`），而非计划阶段 5 预设的 preset（`agent.cordis.yml`）。
   详见 `docs/挂载指南.md`。

2. **结果要求（阶段 0 待确认项）已按现状处理**：`maxResults` 沿用 DSH `tool-web` 默认 8（seam 层统一截断）；
   Tavily 的 `answer` 映射为 `result.content`，Exa 无答案则省略 `content`。无需额外改动。

3. **限流值（rpm）已定默认**：免费额度为额度制（Tavily/Exa 各约 1000/月），官方文档未给出免费档每请求硬限速，
   故默认 60 rpm（1 次/秒，即代码 schema 默认值）。令牌桶参数完全由配置驱动，换真实值不改代码。

4. **高级功能「打开 / AI 可选」**（2026-08-14 追加，参考 [WebSearch 工具对比](https://www.xiaogenban1993.com/blog/26.03/WebSearch%E5%B7%A5%E5%85%B7%E5%AF%B9%E6%AF%94)）：
   文档强调 Tavily 的 `answer` + `search_depth`、Exa 的深度提取/`useAutoprompt` 对 agent 友好。据此：
   - **默认打开**：Tavily `search_depth: advanced` + `include_answer: true`（一次搜索替代 search+fetch，计 2 credits）；
     Exa `useAutoprompt: true` + `contents: { text, highlights, summary }`。
   - **AI 可选（auto）**：日期/域名/主题等依赖 query 的参数默认 `auto`，由 `src/core/query-intent.js` 按 query 语义
     决定（时间词、`site:` 语法、新闻/财经主题词），`src/core/resolve-params.js` 做三态解析（auto/具体值/off）。
     说明：DSH 的 `web_search` 工具 schema 只有 `query`，模型无法传额外参数，故「AI 可选」落地为 provider 层的
     query 语义解析，而非扩展工具参数。

5. **设置页卡片（client half 固化）**：设置卡片通过包内 `client.js`（`dsh.client` 声明）注册到
   `settings.plugin.item`（order 21），展示/编辑 key 池配置、搜索开关、key 备注；重启不丢。
   卡片默认收起；已保存/匿名的 key 默认折叠为一行摘要（名称、额度、状态），点开才是完整编辑区。
   密钥输入按 key 行独立 `_uid` 暂存，`apiKeyEnv` 为空也能输入，保存时校验并提示先填环境变量名。
6. **搜索开关**：`enabled=false` 时通过 loader 更新 `include:web` 的 `searchProvider` 为 `deepseek-official`，
   开启时切回 `search-pool`（已验证运行时切换可行）。
7. **settings 暴露必须白名单**：rc.6 仅白名单内 namespace 可被浏览器读写；`web-search-pool` 需进入
   `api-proxy` 的 `WEB_SETTINGS_NAMESPACES`。升级覆盖后用脚本恢复（见挂载指南 3.4）。
8. **会话事件兼容事故**：曾用 `session.append` 写未注册自定义事件导致历史加载失败；已改用 `ctx.logger`。
   禁止再写未注册且未标记 `ignorable` 的会话事件。
9. **Exa 匿名免费使用（2026-08-15）**：Exa 官方托管 MCP（`https://mcp.exa.ai/mcp`）的默认工具
   `web_search_exa` 无需 API key，匿名有免费 rate limit（来源：[Exa MCP](https://exa.ai/docs/reference/exa-mcp)、
   [exa-labs/exa-mcp-server](https://github.com/exa-labs/exa-mcp-server)）。
   ExaAdapter 双模式：`apiKey` 有值走 `api.exa.ai/search` REST（高级参数全支持）；无值/未配置凭据走 MCP
   JSON-RPC（initialize → initialized → tools/call），已实测匿名搜索成功。匿名模式只传 `query`/`numResults`，
   高级参数忽略。配置侧：Exa `apiKeyEnv` 留空生成匿名 entry（`anonymous: true`）；填写但未配置凭据也会自动降级匿名。
   **匿名免费层强制全局 1 秒 1 次**：无论配置多少个匿名 Exa key 或调高 rpm，都由 provider 内的共享令牌桶
   （`capacity: 1, refillPerSec: 1`）硬性限制，配置不可覆盖；有 key 的 REST 模式不受此限制。
10. **Tavily 剩余额度可查（2026-08-15 实测）**：`GET https://api.tavily.com/usage`（Authorization: Bearer key）返回
    `key.usage` / `account.plan_usage` / `account.plan_limit`；`scripts/check-usage.mjs`
    可批量查询并按 plan / usage / limit / remaining 汇总。
    Exa 普通搜索 key 没有公开余额接口（官方 usage 属于 Team Management，需要 service key + api_key_id）；
    匿名 MCP 免费层是 rate limit 而非 credits，无剩余额度可查。
11. **Tavily 额度总览与耗尽长冷却（2026-08-15）**：Host 侧通过 `GET https://api.tavily.com/usage` 每
    `usageCacheMs`（默认 5 分钟）刷新各 Tavily key 额度，汇总总已用/总上限/总可用写入 settings 的运行时
    `usage` 字段，Client 设置页自动显示。额度低于 `quotaReserveCredits`（默认 2，advanced search 成本）时，
    该 key 进入 `quotaExhaustedCooldownMs`（默认 30 天）长冷却；额度恢复并刷新后自动解除（先恢复再 acquire）。
    Exa 无公开余额接口，不计入总额。
12. **额度发布通道与手动刷新（2026-08-15）**：Host 取 settings 服务必须用 `ctx.inject(['settings'])`
    （`ctx.get('settings')` 在插件上下文可能拿不到），发布失败写 `usageDiagnostic`；Client「立即刷新」用
    `api.settings.mutate` 且不带 `expectedRevision`，避免 Host 刚写 usage 后 revision 冲突导致点击无反应。
    2026-08-15 追加修复：Host 刷新带 15 秒总超时，查询失败会连同失败 key 写进 `usageDiagnostic`；
    Client 不再吞掉 mutate 错误，点击后显示「已请求刷新 / 刷新请求失败」，避免刷新静默无反馈。
    实测发现 `installSettingsSection` 的 `scope.watch` 在 include/loader 场景下已注册但未触发刷新，
    因此插件入口同时监听 `settings/updated` 事件并用事件 `next` 触发 `refreshUsage` 兜底。
    修改 Host/client.js 后必须重启 DSH 进程，仅刷新浏览器不会加载新代码。

### 待办

1. 真实搜索验证：Tavily 真实 key 已验证；Exa 匿名免费层已实测；后续可填 Exa key 走 REST 高配额后复测。
   手动刷新静默失败问题已修复（`settings/updated` 事件兜底 + Host 写 `usageDiagnostic` + 超时，
   Client 显示请求/失败提示），重启 DSH 后最终验证设置页「Tavily 额度总览」与「立即刷新」更新时间。
2. 阶段 3（运行时状态）：每个 key 的冷却 / 限流 / 失败徽章，需要 provider 在 Host 侧暴露实时状态。
3. 若 DSH 升级覆盖 npm 安装目录：运行 `scripts/patch-api-proxy-namespace.mjs` 恢复 settings 白名单。
