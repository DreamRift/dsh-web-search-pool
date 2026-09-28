# dsh-web-search-pool

为 DSH 提供 Tavily / Exa 多 key 搜索：按限流调度、失败切换及额度门禁；支持 Exa 匿名通道。密钥仅以凭据引用保存，不写入设置和日志。

适配基线为 DSH 0.1.7-rc.2；不要据此推定所有后续宿主兼容。当前包版本、peer 范围和命令以 [package.json](package.json) 为准。

## 按任务读取

| 需要 | 入口 |
|---|---|
| 安装、配置、升级、回滚或排障 | [安装与升级](docs/安装与升级.md) |
| 调度策略、Bundle、设置与凭据机制 | [架构与机制](docs/架构与机制.md) |
| 改入口、事件、宿主适配或发布 | [开发规范与事故复盘](docs/开发规范与事故复盘.md) |
| 查已发布变更 | [CHANGELOG](CHANGELOG.md) |

## 开发

在本项目目录运行 `npm run test:local`，或按改动运行对应测试。`npm pack --dry-run` 用于包内容检查。

真实宿主 E2E 是单独验证，不是日常文档检查；使用真实凭据及联网选项前先核对 [安装与升级](docs/安装与升级.md) 中的副作用。不要把旧测试计数当作当前通过记录。

[MIT License](LICENSE)。
