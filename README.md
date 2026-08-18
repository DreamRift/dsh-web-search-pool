# dsh-web-search-pool

![Version](https://img.shields.io/npm/v/dsh-web-search-pool.svg) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![DSH Version: rc.7](https://img.shields.io/badge/DSH%20version-%E2%96%B2%20rc.7-orange)

DeepSeek Harness 的 **多供应商搜索负载均衡插件**。将多个 Tavily 和 Exa API keys 组织成智能池，自动按限流调度并故障切换。

## ✨ Features

- 🔑 **Multi-key Pool**: 支持多个 Tavily + Exa keys，统一管理
- ⚖️ **Smart Load Balancing**: 基于 RPM（每分钟的请求数）加权轮询调度
- 🔄 **Automatic Fallback**: 429 rate limit、额度耗尽、网络错误时自动切换到下一个 key
- 📊 **Usage Dashboard**: Settings 页卡片实时查看已用额度、总限额、刷新按钮
- 🔒 **Secure**: API keys 通过 DSH credentials service 保存，不写入配置文件
- 🎯 **Exa Anonymous Free Tier**: 内置免费匿名层（1 req/sec），有 key 走 REST 提配额
- 🏗️ **Native Bundle (rc.7)**: DeepSeek Harness 官方式原生 Bundle 集成

## 📦 Installation

```bash
# Build distribution package
npm pack

# Install to your profile
dsh plugin --profile web add ./dsh-web-search-pool-0.3.0.tgz
```

### Prerequisites

- ✅ **DeepSeek Harness** 0.1.0-rc.7 or higher
- 🔐 At least one search provider API key (Tavily / Exa)

## ⚙️ Configuration

After installation, configure via DSH Settings UI:

1. Open **DeepSeek Harness** → **Settings** → **Plugins**
2. Find **"搜索 Key 池"** card and expand it
3. Add your Tavily/Exa keys with:
   - **Environment Variable Name** (e.g., `TAVILY_API_KEY_1`)
   - **Rate Limit (RPM)**: requests per minute
   - **Remark**: friendly name (optional)
4. Click **Save** - secrets are stored securely via credentials

> 🔐 All API keys are stored in DS H's credential system, never in plain-text configs.

## 🛠️ Usage

Once configured, the plugin automatically becomes your default `web_search` tool. No manual selection needed!

The provider will:
- Select optimal key based on current quota and load
- Switch providers (Tavily ↔ Exa) on failure
- Respect rate limits and quotas across all keys
- Return structured errors without exposing sensitive data

## 🧪 Testing

```bash
# Run test suite
npm run test

# Syntax check
node --check src/**/*.js scripts/*.mjs

# Pack integrity check
npm pack --dry-run
```

## 📄 Documentation

- [Installation Guide](docs/挂载指南.md) - Quick setup for rc.7
- [Upgrade & Rollback Guide](docs/升级与回滚指南.md) - Migrate from v0.2.x, troubleshooting
- [Development History & Specs](docs/superpowers/) - Design decisions and specifications
- [Architecture Overview](AI搜索Key池负载均衡 - 开发计划.md) - Technical architecture and trade-offs

## 🔧 Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No settings card | Legacy rc.6 slot registration | Update to use `key: web-search-pool`, restart DSH |
| Still using official search | Bundle patch not loaded | Reinstall tarball, verify `searchProvider: search-pool` |
| Usage refresh fails | Invalid credentials or quota exhausted | Check credentials config, wait for quota recovery |

See [Upgrade Guide](docs/升级与回滚指南.md#故障排查) for complete table.

## 🏗️ Architecture

See technical design docs:
- [Bundle Contract Specification](docs/superpowers/specs/2026-08-18-native-bundle-rc7-design.md)
- [Key Pool & Scheduler Logic](src/core/)
- [RC7 Migration Report](v0.3.0-升级实施计划.md)

## 🔐 Security

This plugin follows **Zero Trust** for credentials:
- No hardcoded secrets or API keys
- Keys only stored via DSH credentials service
- Never logged or exposed in responses
- Public anonymous mode available (Exa free tier)

## 📜 License

MIT License - see LICENSE file

## 🤝 Contributing

Issues and PRs welcome! Please follow existing patterns:
- Core logic in `src/core/` (DSH-independent)
- Provider implementation in `src/dsh/` (Host half)
- Client UI in `src/dsh/client.js` (Web half)
- Tests parallel production coverage (TDD)

See [Development Guidelines](docs/开发事故复盘与规范.md) for best practices.

---

Built for **DeepSeek Harness** community · Part of native ecosystem