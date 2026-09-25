# dsh-web-search-pool

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![DSH: 0.1.7+](https://img.shields.io/badge/DSH-0.1.7%2B-orange)

多供应商搜索负载均衡插件，为 **DeepSeek Harness** 提供 `web_search` 能力：把多个 Tavily / Exa key 组成一个智能池，按各自限流调度，失败自动切换。

## ✨ Features

- 🔑 **Multi-key pool** — 统一管理任意数量的 Tavily / Exa key，key 只以凭据引用形式存在
- ⚖️ **Rate-limit aware scheduling** — smooth weighted round-robin（按 rpm 加权）或 least-used
- 🔄 **Automatic failover** — 429 / 额度耗尽 / 网络错误 / 超时自动换 key，供应商间（Tavily ↔ Exa）自动兜底
- 🧯 **Quota gate** — Tavily 剩余额度低于保留值自动进入长冷却，刷新恢复后自动解除（快照进 DSH 日志）
- 🆓 **Exa anonymous free tier** — 不填 key 即用官方托管 MCP（1 req/s），有 key 走 REST 提配额
- 🧩 **Native Bundle** — 官方 `cordis.patch.yml` 装配 + 插件管理页行配置卡片，适配 DSH 0.1.7+（桌面版实测 0.1.7-rc.2）

## 📦 Installation

桌面版 DSH（0.1.7+）推荐用**应用内插件管理**安装：

1. `npm pack` 打出 tgz
2. 打开 DeepSeek Harness 桌面版 → 设置 → 插件 → 安装 → 选择本地 tgz
3. 在 `dsh-web-search-pool` 的 Bundle 页找到 `web-search-pool` 行 → 配置 → 「搜索 Key 池」卡片

命令行（非 desktop profile，如 headless / 自建 profile）：

```bash
npm pack
dsh plugin --profile <profile> add ./dsh-web-search-pool-<version>.tgz
```

前置：DSH 0.1.7+，`pnpm` 在 PATH，至少一个搜索 key（Exa 可用匿名免费层）。
完整步骤、升级、回滚与排障见 [安装与升级](docs/安装与升级.md)。

## ⚙️ Configuration

**设置 → 插件 → dsh-web-search-pool → `web-search-pool` 行 → 配置**：添加 key（环境变量名 / 限流 RPM / 备注）→ 保存。

- 密钥只经 DSH credentials 服务保存，**不写入 settings / profile patch**；Exa 的环境变量名留空即启用匿名免费层。
- 保存是单次 `mutate` 事务：只写变化的字段，volatile 字段就地生效（不重挂插件）。
- 字段与默认值全表见 [架构与机制 §6](docs/架构与机制.md)。

## 🛠️ Usage

安装后自动接管 `web_search`，无需手动选择 provider：按当前限流与额度选 key → 失败自动换 key / 换供应商 → 返回结构化结果与错误（不暴露密钥）。

## 🧪 Testing

```bash
node scripts/run-tests.mjs        # 122 个 node:test 用例（免 spawn，跨平台）
npm test                          # 等价入口：node --test tests/
node --check src/dsh/index.js     # 语法检查
npm pack --dry-run                # 打包内容校验
node scripts/e2e-boot.mjs <app.asar 提取目录>   # 真实运行时端到端（见脚本头说明）
```

## 📄 Documentation

| 文档 | 内容 |
|---|---|
| [安装与升级](docs/安装与升级.md) | 安装 / 验证 / 配置 / 升级 / 回滚 / 故障排查 |
| [架构与机制](docs/架构与机制.md) | DSH seam 与 Bundle 装配、0.1.7 设置体系、调度核心、配置模型、错误映射、扩展路径 |
| [开发规范与事故复盘](docs/开发规范与事故复盘.md) | 六类真实事故的根因与教训、开发检查清单、发布流程 |
| [CHANGELOG](CHANGELOG.md) | 版本变更历史 |

## 🔧 Troubleshooting

| 现象 | 处理 |
|---|---|
| 插件没出现在插件页 / 设置里没有「搜索 Key 池」 | 确认 DSH ≥ 0.1.7；插件管理页刷新；重启桌面版 |
| web 启动报错 / `Failed to load plugins` | 0.2.1 及更早版本在 0.1.7 上会等一个已移除的服务（`settingsScope`）→ 升级到 0.3.0 |
| 仍走官方搜索 | 检查 `web-search-pool` 行的 `enabled` 开关；profile patch 里 `include:web` 的 `searchProvider` |
| 保存设置被拒 | 别处同时改了同一 namespace；重新打开卡片再保存 |

完整排查表见 [安装与升级 §9](docs/安装与升级.md)。

## 🔐 Security

- 无硬编码密钥；key 只经 DSH credentials 服务读写，每次操作 resolve，不缓存明文
- 日志只记 `provider/keyId/ok/code`，不含密钥；错误信息不泄露凭据
- 不写未注册的会话事件（避免污染会话历史）

## 📜 License

MIT — see [LICENSE](LICENSE).

---

Built for the DeepSeek Harness community · part of the native plugin ecosystem
