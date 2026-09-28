# Changelog

All notable changes to this project.

## [0.4.0] - 2026-09-28

### Added
- **支持 DSH 0.2.0 线**：peer 范围从 `^0.1.7-rc.1` 扩为
  `^0.1.7-rc.1 || ^0.2.0-rc.1`（0.1.7 与 0.2.0 双线并存），桌面版 0.2.0-rc.1
  的启动兼容门（`evaluatePluginCompatibility`，`satisfies(运行时, 区间, {includePrerelease})`）
  放行本 bundle 层。
- `scripts/privacy-scan.mjs`：扫描 git 全部历史 commit 快照里的个人用户名、
  `C:\Users\<用户名>` 绝对路径、真实长度 API key、邮箱、Bearer token；接入
  `docs/开发规范与事故复盘.md` 发布流程第 5 步（发布前必跑）。
- `scripts/e2e-boot.mjs` 新增两个能力：
  - `--user-patch <cordis.patch.yml>`：把一份真实用户 patch 复制为隔离 profile
    的用户层，验证组合编译，并断言用户层完整覆盖 `web-search-pool` 行配置、
    行配置不含已移除的运行时字段；
  - `--live-search <query>`：注入真实凭据后经完整 `web` seam 真机搜索一次
    （ Tavily 实测约 3.5s 返回，含 answer 摘要）。

### Changed
- **0.2.0 适配核对（无行为改动）**：0.2.0 把 loader 拆为独立包
  `@deepseek-ai/cordis-plugin-loader`（cordis 4.0.4 的 peer），逐项核对宿主 app.asar
  源码确认本插件依赖的契约无破坏性变化——`ctx.web.registerSearchProvider` 与 provider 面
  （`id`/`available()`/`search()`）、`loader.resolve/update` 与
  **`loader/volatile-update`**、Config schema 的 volatile 投影与 Ref 运行期、
  `plugins.row.config` keyed slot（key = `<包名>#<行 id>`）、`ctx.configForms`
  （`get`/`whileServed`/`mutate(ops, revision)`）、`ctx.remote.credentials` describe/set
  与转发事件 `credentials/reference-updated`、`dsh.client.inject` 三包到达顺序、
  dsh-base 根组 `web` 行（`searchProvider`/`fetchProvider` 双字段 restate 语义）。
  因此 0.2.0 线只放宽 peer 范围，src/ 无功能改动。

### Verified
- 桌面版 **0.2.0-rc.1**（`resources/app.asar` 提取）源码核对 + `scripts/e2e-boot.mjs`
  真实启动全绿：skippedBundles 为空、`web` 行 patch 生效（searchProvider=search-pool 且
  fetchProvider 保留）、`web-search-pool` 行 ACTIVE、settings.describe 投影全部字段、
  settings.update 端到端（不重挂 + volatile 就地提交 + web 行双向同步 + patch 落盘）、
  client-modules 图谱下发本插件浏览器 bundle。
- 本地测试 122 个用例全绿（peer 包已同步为 0.2.0-rc.1 副本）。

## [0.3.0] - 2026-09-25

### Changed (Breaking)
- **适配 DSH 0.1.7（官方桌面版 0.1.7-rc.2 实测）**，不再支持 0.1.1-rc.x / 0.1.2：
  peer 范围收紧为 `^0.1.7-rc.1`（DSH 启动兼容门用 `satisfies(运行时, 区间, {includePrerelease})`
  判定，不满足的 bundle 层会被整体跳过）。
- **设置体系重写**：0.1.7 移除了 `settings.installSection` / `installSettingsSection`
  （0.1.2 已移除前者依赖的 helper），设置表单改为 loader 行 **Config schema 自动投影**
  （namespace = 行 id `web-search-pool`）。`Config` 全部用户可编辑字段改为 `.volatile()`，
  运行期是 Ref（`config.enabled.get()`），编辑经 `settings.mutate` 写 profile patch 后
  就地提交（`loader/volatile-update`，不重挂插件）。
- **Client half 重写**：`settings.plugin.item` keyed slot → **`plugins.row.config`**
  keyed slot（key = `dsh-web-search-pool#web-search-pool`）；数据面 `ctx.settingsScope`
  → **`ctx.configForms`**（`get(ns)` + `whileServed` 门控）；写入走 `form.mutate(ops, revision)`。
- **运行时状态移出 settings**：`usageRefreshTick` / `usageDiagnostic` / `usage` 三个字段从
  schema 删除——0.1.7 的 settings 写入即持久化进用户 profile patch，Host 周期发布的运行时会话
  数据不能落盘。Tavily 额度快照改为 `ctx.logger` 观测（`search-pool usage used=… limit=…`），
  设置卡片不再展示额度总览与「立即刷新」按钮（Host 仍按 `usageCacheMs` 后台自动刷新，
  额度闸门/长冷却/自动恢复逻辑不变）。
- `cordis.patch.yml` 的注释补明 0.1.7 行 id 语义（patch 按短 id `web` 匹配；loader 完整 id
  是 `include:web`，宿主侧运行时探测两者）。

### Fixed
- **修复 0.1.7 上「安装后无插件页面 + 重启 dsh 报错」**：0.2.1 的 client half 在
  `exports.inject` 里等服务 `settingsScope`（0.1.2 的服务，0.1.7 已移除），浏览器 loader
  entry 永远 pending，web boot 失败（桌面版崩溃日志实证
  `dsh-web-search-pool: pending (waiting for service: settingsScope)`）。

### Added
- 插件显示元数据 `locale/en.json` + `locale/zh.json`（插件管理页的标题/描述），
  `exports` 增加 `./locale/*.json`。
- 测试：`tests/dsh-host-apply.test.js`（真实 cordis + vendored Loader + schemastery 驱动
  host half：provider 注册、volatile Ref、就地提交不重挂、web 行同步、搜索链路）；
  `tests/dsh-client-contract.test.js`（vm 物化浏览器 bundle，守住新 slot/configForms/inject
  契约）；`tests/dsh-version-compat.test.js` 重写（迷你 semver 兼容门 + patch 目标 + volatile
  形态）。合计 122 个用例全绿。
- `scripts/e2e-boot.mjs`：用桌面版 app.asar 里的真实运行时，在隔离 DSH_HOME 的临时 profile
  端到端启动整棵宿主树，验证 bundle 加载、patch 生效、插件 ACTIVE、settings.describe 投影、
  settings.update 落盘 + 就地提交、client-modules 图谱下发。
- `scripts/sync-peer-deps.mjs`：把宿主 app.asar 的 peer 包同步进本地 node_modules（仅供测试）。

## [0.2.1] - 2026-09-08

### Fixed
- **Client half 的 `remote` 命名空间必须显式 inject**：cordis 把每个 Remote 命名空间注册为服务
  `remote.<namespace>`，不声明就访问会抛 `cannot get property "remote.credentials" without inject`，
  表现为 Web UI 里的「Failed to load plugins / dsh-web-search-pool / failed to apply loader entry」。
  改为 `ctx.inject(["remote", "remote.credentials"], (rctx) => …)` 的 scoped 注入（0.1.1-rc.x 无此服务 →
  回调不执行 → 自动退回 `connection.api`），与官方 `dsh-client-ui-settings`（`inject = ["remote", "remote.settings"]`）一致。
- 回归守卫：`tests/dsh-version-compat.test.js` 禁止 `ctx.get("remote")` 写法，并断言 scoped inject 形态。

### Verified
- 用真实 `@deepseek-ai/cordis`（0.1.2-rc.1）复现旧写法报错，并验证新写法下真实 client bundle `apply()` 通过。

## [0.2.0] - 2026-09-08

### Changed (Breaking)
- 适配 DSH 0.1.2-rc.1：`@deepseek-ai/dsh-settings` 移除了 `installSettingsSection` /
  `settingsNamespace` / `deepEqualJson`，Host half 改为 `settings.installSection(owner, ns, schema, entry, hooks)`。
- 旧符号改为**动态导入**回退：静态命名导入在 0.1.2 会于 ESM 链接期抛 SyntaxError，
  导致 loader 无法导入插件、整棵插件树启动失败（0.1.2 升级事故的根因）。
- Client half 适配 Typert Remote：`ctx.connection.api`（IApiClient，随 dsh-host-apiproxy 移除）
  改为 `ctx.remote.credentials.describe/set`；settings 写入优先走 `settingsScope.bind().mutate(ops)`。
- `dsh.client.inject` / `peerDependencies` 移除已停止发布的 `@deepseek-ai/dsh-client-runtime`。
- `cordis.patch.yml` 的 `web` 行补回 `fetchProvider: http`（id 定位 patch 是整体替换，
  0.1.2 官方 web 行新增该字段，只写 searchProvider 会把它抹掉）。
- Host 侧 `syncSearchProvider` 改为读取该行现有 config 再合并，避免运行时把 fetchProvider 抹掉。

### Compatibility
- 同一份代码同时支持 DSH 0.1.1-rc.x（旧 settings helper）与 0.1.2+（installSection + Remote）。

## [0.1.0-rc.7] - 2026-08-18

### Changed (Breaking)
- RC7 native Bundle integration with cordis.patch.yml
- Keyed slot registration (key: instead of id:)
- Peer dependencies pinned to ^0.1.0-rc.7

### Added
- Native Bundle support for rc.7
- Anonymous Exa free tier support
- Complete contract tests

### Fixed
- Settings card visibility issues
- Usage refresh feedback loop
