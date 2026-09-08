# dsh-web-search-pool

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![DSH: 0.1.1-rc.x / 0.1.2+](https://img.shields.io/badge/DSH-0.1.1--rc.x%20%7C%200.1.2%2B-orange)

多供应商搜索负载均衡插件，为 **DeepSeek Harness** 提供 `web_search` 能力：把多个 Tavily / Exa key 组成一个智能池，按各自限流调度，失败自动切换。

## ✨ Features

- 🔑 **Multi-key pool** — 统一管理任意数量的 Tavily / Exa key，key 只以凭据引用形式存在
- ⚖️ **Rate-limit aware scheduling** — smooth weighted round-robin（按 rpm 加权）或 least-used
- 🔄 **Automatic failover** — 429 / 额度耗尽 / 网络错误 / 超时自动换 key，供应商间（Tavily ↔ Exa）自动兜底
- 📊 **Usage dashboard** — 设置页卡片显示 Tavily 已用/总额度与「立即刷新」，额度耗尽自动长冷却
- 🆓 **Exa anonymous free tier** — 不填 key 即用官方托管 MCP（1 req/s），有 key 走 REST 提配额
- 🧩 **Native Bundle** — 官方 `cordis.patch.yml` 装配 + 设置页卡片，兼容 DSH 0.1.1-rc.x 与 0.1.2+

## 📦 Installation

```bash
npm pack
dsh plugin --profile web add ./dsh-web-search-pool-<version>.tgz
dsh --profile web --dump-config      # 期望：searchProvider: search-pool
```

前置：DSH 0.1.1-rc.x / 0.1.2+，`pnpm` 在 PATH，至少一个搜索 key（Exa 可用匿名免费层）。
完整步骤、升级、回滚与排障见 [安装与升级](docs/安装与升级.md)。

## ⚙️ Configuration

**Settings → Plugins → 「搜索 Key 池」** 卡片：添加 key（环境变量名 / 限流 RPM / 备注）→ 保存。

密钥只经 DSH credentials 服务保存，**不写入 settings.yaml**；Exa 的环境变量名留空即启用匿名免费层。
字段与默认值全表见 [架构与机制 §6](docs/架构与机制.md)。

## 🛠️ Usage

安装后自动接管 `web_search`，无需手动选择 provider：按当前限流与额度选 key → 失败自动换 key / 换供应商 → 返回结构化结果与错误（不暴露密钥）。

## 🧪 Testing

```bash
node scripts/run-tests.mjs        # 112 个 node:test 用例（免 spawn，跨平台）
npm test                          # 等价入口：node --test tests/
node --check src/dsh/index.js     # 语法检查
npm pack --dry-run                # 打包内容校验
```

## 📄 Documentation

| 文档 | 内容 |
|---|---|
| [安装与升级](docs/安装与升级.md) | 安装 / 验证 / 配置 / 升级 / 回滚 / 故障排查 |
| [架构与机制](docs/架构与机制.md) | DSH seam 与 Bundle 装配、调度核心、配置模型、错误映射、扩展路径 |
| [开发规范与事故复盘](docs/开发规范与事故复盘.md) | 五类真实事故的根因与教训、开发检查清单、发布流程 |
| [CHANGELOG](CHANGELOG.md) | 版本变更历史 |

## 🔧 Troubleshooting

| 现象 | 处理 |
|---|---|
| 设置页没有卡片 / `keyed slot requires options.key` | 升级到 0.2.0+ 并重启 DSH |
| Web UI 报 `Failed to load plugins / dsh-web-search-pool` | 升级到 0.2.1+（client 需声明 `remote` 命名空间 inject） |
| 仍走官方搜索 | `dump-config` 检查 `include:web` 的 `searchProvider` |
| 点击「立即刷新」无变化 | 重启 DSH，查看 `usageDiagnostic` |

完整排查表见 [安装与升级 §9](docs/安装与升级.md)。

## 🔐 Security

- 无硬编码密钥；key 只经 DSH credentials 服务读写，每次操作 resolve，不缓存明文
- 日志只记 `provider/keyId/ok/code`，不含密钥；错误信息不泄露凭据
- 不写未注册的会话事件（避免污染会话历史）

## 📜 License

MIT — see [LICENSE](LICENSE).

---

Built for the DeepSeek Harness community · part of the native plugin ecosystem
