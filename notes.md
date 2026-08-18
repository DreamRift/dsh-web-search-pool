# 研究与实现记录

## 2026-08-18 初始盘点

- 工作区：`C:\Users\cty05\Documents\AI\deepseek Harness\Harness插件`
- 项目仓库：`AI搜索Key池负载均衡/`，Git `main`，初始工作区干净，最近提交为 `e398750 fix: whitelist patch switches to array-end insertion to avoid cross-plugin corruption`。
- 本地 DSH：`C:\Users\cty05\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`，版本 `0.1.0-rc.7`。
- 当前 web profile：`$DSH_HOME/profiles/web/package.json` 只挂载 `dsh-thinking-efforts` tgz；`cordis.patch.yml` 为空。
- 当前项目 v0.2.0 代码已在 Git 追踪，glob 的嵌套模式需要明确包含 `/` 才能命中。

## 已知旧版风险

- 旧文档主要基于 rc.6，明确依赖 `WEB_SETTINGS_NAMESPACES` 的安装目录 patch；必须以 rc.7 源码重新确认。
- 项目已有核心调度、Tavily/Exa 适配和 87 个测试，但用户要求“最新版 + 官方插件一样安装”，安装契约和官方 package/patch 形态是升级重点。
- 所有 DSH 机制结论必须写明调研日期和来源，不能把旧文档中的 rc.6 结论直接当 rc.7 事实。

## 待核验

- GitHub 官方仓库当前分支/发布版本、插件 package 元数据与 profile bundle/patch 机制。
- rc.7 `dsh-web-search-deepseek`、settings/api-proxy、loader/include、官方插件的实际入口。
- 是否能通过普通 npm 包 + `dsh` 元数据自动装配，还是仍需要 profile patch；若后者，做成用户自己的 profile composition/安装脚本，不直接改 shipped install。
