# rc.7 重构研究简报：AI 搜索 Key 池负载均衡

> 调研日期：2026-08-18
> 目标版本：本机实际安装的 DeepSeek Harness `@deepseek-ai/dsh@0.1.0-rc.7`
> 研究范围：本地 rc.7 源码、官方 GitHub/NPM 元数据、官方插件实现、开源路由/限流模式。

## 1. 结论

现有项目的核心架构仍然适合 rc.7：它已经把多 key、多供应商和 failover 封装在单个 `WebSearchProvider` 内，符合 DSH 的单 provider seam。升级重点是安装/客户端契约和 rc.7 兼容性修复，而不是推翻核心调度器。

必须完成的升级：

1. 把包改成 rc.7 原生 bundle：`package.json` 增加 `dsh.bundle.patch`，通过 `dsh plugin --profile web add <package-spec>` 安装，自动加入 `dsh.profile.bundles`。
2. 停止依赖 rc.6 的 `WEB_SETTINGS_NAMESPACES` 安装目录 patch。rc.7 的 `dsh-host-apiproxy` 对所有已注册 Settings namespace 提供 `settings.describe/update/mutate`，无需改 npm 安装目录。
3. 修正 rc.7 keyed slot：`settings.plugin.item` 注册必须使用 `key: 'web-search-pool'`，现有 client 使用 `id` 会在 rc.7 被拒绝。
4. 将 DSH peer 版本收紧到 `^0.1.0-rc.7`，避免 `@deepseek-ai/*` 的陈旧 `latest` 标签安装到 rc.1；安装文档使用精确 rc.7 或 `next`。
5. 保留 host-plane provider 与 `web` row 覆盖；不要把 web 服务或搜索 provider 放进 agent preset。
6. 修复当前测试基线已暴露的脚本测试回归，新增 bundle/package/client-contract 验证。

## 2. 证据与来源

### 2.1 官方 GitHub / 发布信息

- 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- rc.7 发布：[Release dsh-v0.1.0-rc.7](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7)
- rc.7 发布提交：[bb4ca698](https://github.com/deepseek-ai/deepseek-harness/commit/bb4ca698d63714e753f5621b07400e6ebb0b5d97)
- 架构：[architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/architecture.md)
- 发布/开发文档：[publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/user/develop/basic/publish.md)
- Web bundle：[packages/bundle/web-app](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/web-app)
- Client modules：[packages/client/modules](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/modules)
- 官方搜索 provider：[packages/web/web-search-deepseek](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web-search-deepseek)
- rc.7 官方插件加载问题的社区记录：[Issue #165](https://github.com/ysr666/dsh-vision-router/issues/165)

GitHub 正文在本机无法稳定直连，以上链接通过 web_search 获得；契约事实以本机 rc.7 安装源码复核为准。

### 2.2 本地 rc.7 源码

| 能力 | 本地来源 | 关键事实 |
|---|---|---|
| CLI/profile/bundle | `C:/Users/<user>/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/README.zh.md`、`lib/plugin-*.js`、`node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` | `dsh plugin --profile <name> <pnpm args>`；包声明 `dsh.bundle.patch` 后自动进入 profile bundle；profile patch 层叠加在 bundle 后。 |
| Bundle patch | `node_modules/@deepseek-ai/dsh-web-app/package.json`、`cordis.patch.yml` | 官方 bundle 使用 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。 |
| Web seam | `node_modules/@deepseek-ai/dsh-web/lib/index.js`、`package.json` | 单一 `WebSearchProvider`；`available()` 不发网络；显式 `searchProvider` 优先；多 provider 未配置时抛 `WEB_PROVIDER_AMBIGUOUS`；seam 负责 `maxResults` 截断。 |
| 官方 provider 范本 | `node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js`、`package.json` | `inject: ['web']`、`installSettingsSection`、每次搜索快照、按请求解析凭据；rc.7 peer 为 `^0.1.0-rc.7`。 |
| Settings | `node_modules/@deepseek-ai/dsh-settings/README.md`、`lib/index.js` | namespace 自动注册；`update/replace/mutate` JSON 边界和 revision 冲突；`settings/updated` 事件。 |
| API proxy | `node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`、`README.md` | `settings.describe` 映射全部已注册 namespace；rc.7 不再有 `WEB_SETTINGS_NAMESPACES` 白名单。 |
| Client modules | `node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`、`lib/client.js` | `dsh.client` 声明 + `exports['./client']`；浏览器包为 `window.__ModuleLoader__.load` factory；缺构建包会在激活时 fail loud。 |
| Settings UI | `node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/package.json`、`lib/client.js` | `settings.plugin.item` 是 keyed slot，官方用 `{ name, key: namespace, ... }`；rc.7 不接受仅有 `id`。 |
| Loader | `node_modules/@deepseek-ai/cordis-plugin-loader/README.md`、`lib/index.js` | `loader.update('include:web', { config: { searchProvider } })` 仍可动态更新并重载 host row。 |

### 2.3 本项目现状

- 项目：`AI搜索Key池负载均衡/`，Git `main`，基线最近提交 `e398750`。
- 现有实现：`src/core/`、`src/adapters/`、`src/dsh/`，核心不依赖 DSH；package `0.2.0`。
- 当前安装状态：本机 `$DSH_HOME/profiles/web/cordis.patch.yml` 为空，未实际挂载本项目；因此不能把旧版本“已挂载”文档当成 rc.7 运行时证据。
- 当前测试：`npm run test:local` 87 例中 85 通过、2 失败，均在 `tests/scripts.test.js`：空格缩进期望与末尾插入实现冲突；错误消息期望与实现不一致。
- 当前 client 明确问题：`src/dsh/client.js` 末尾注册 `settings.plugin.item` 时传 `{ id: 'search-pool' }`，rc.7 应改为 `{ key: 'web-search-pool' }`。
- 当前文档过时部分：`docs/挂载指南.md` §3.4 仍要求 patch `WEB_SETTINGS_NAMESPACES`，需删除并改成 rc.7 原生安装流程。

## 3. 开源路由/限流调研

- [LiteLLM Routing](https://docs.litellm.ai/docs/routing)：可复用“deployment/key 池 + weight + cooldown + fallback”的抽象；不直接复用其 LLM 特有实现。
- [one-api](https://github.com/songquanpeng/one-api)：渠道优先级/权重可作参考；其随机/重试选择边界不作为本项目实现依据。
- [new-api](https://github.com/QuantumNous/new-api)：重试期间动态禁用渠道可能造成索引错位；本项目应使用请求级候选快照，状态变更只影响后续 acquire。
- [Portkey](https://portkey.ai/docs/product/ai-gateway/concepts/route-requests)：fallback/conditional route 的概念可作错误分级参考。
- [SearXNG](https://github.com/searxng/searxng)：并行扇出、每引擎独立超时和部分失败容忍适合未来的并行搜索模式，本次不引入以保持单请求成本可控。

共识模式：权重/优先级、熔断、冷却、fallback、可观测性。反面教训：Retry-After 不能被固定重试覆盖；取消不能被当成失败计数；动态状态不能改变当前请求已经选出的候选集合。

## 4. 事实、推断与置信度

| 结论 | 类型 | 置信度 |
|---|---|---|
| rc.7 的官方安装中心是 profile dependency + `dsh.bundle.patch` | 本地源码事实 | 高 |
| rc.7 不需要 settings namespace 白名单 patch | 本地源码事实 | 高 |
| `settings.plugin.item` 必须使用 `key` | live Slot Inspect + 官方 client 源码 | 高 |
| 当前 provider 的 core 调度架构可保留 | 基于 seam/现有代码的工程推断 | 高 |
| npm `latest` 对部分官方子包陈旧，应用精确 rc.7/next | npm/web 调研结果，未对每个包逐一复现 | 中高 |
| GitHub master 必然等于 rc.7 | 未作此假设；发布版与 master 可能漂移 | 低/未决 |

## 5. 被拒绝的方向

1. 继续 patch DSH 安装目录：升级会覆盖，rc.7 已删除目标白名单，增加维护风险。
2. 把 provider 放进 agent preset：web seam 属 host plane，preset 只负责 agent 级工具/提示词；这样会造成服务可见性和多 session 冲突。
3. 重新做一个独立 HTTP 中转服务：当前目标是官方插件式安装，额外服务增加部署和故障面；核心已保留未来 HTTP/Redis 扩展接口。
4. 为兼容 rc.7 删除设置页：官方 client contract 仍支持外部 `dsh.client`，修正 keyed slot 即可保留功能。

## 6. 未决风险

- 当前尚未在本机重启 rc.7 web 进程完成真实设置页和搜索切换验收。
- 本项目浏览器 client 是手写 factory，不是官方 TypeScript build；需要增加纯度/manifest/package contract 测试。
- profile 的当前 `node_modules` 有陈旧 junction 痕迹，安装后应执行 `dsh plugin --profile web install`/`pnpm install` 并检查解析到项目包。
- 供应商真实额度、网络可用性和 Exa 匿名 MCP 仍不能用单元测试替代。

## 7. 研究决策

推荐采用“原生 bundle + host provider + 兼容 settings card”的最小升级路径：保持稳定的 core/adapters，升级 package/install contract，移除 obsolete patch，修复 keyed slot，补齐测试和 rc.7 验证脚本。这样既与官方插件安装形态一致，又不把一次版本迁移扩大成无必要的调度器重写。
