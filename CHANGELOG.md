# Changelog

All notable changes to this project.

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
