# GitHub 仓库部署指南

## 已完成的工作

1. README.md - GitHub 友好的仓库说明（带徽章、功能列表、文档链接）
2. .gitignore - 已包含 node_modules, credentials, .tgz 等敏感文件
3. package.json - 更新为公开发布格式
4. CHANGELOG.md - 语义化版本变更日志
5. RELEASE.md - v0.1.0-rc.7 发布说明（含 breaking changes）
6. cordis.patch.yml - RC7 Bundle patch（核心功能）
7. 测试套件 - 104/104 测试通过
8. npm pack --dry-run - 打包验证通过

## 部署步骤

### 1. 在 GitHub 创建仓库
- 仓库名: dsh-web-search-pool
- 不要添加 README/.gitignore/license（已包含）

### 2. 推送到 GitHub

```bash
git remote add origin https://github.com/dreamrift/dsh-web-search-pool.git
git push -u origin main
```

### 3. 创建 GitHub Release
1. 打开 Releases 页面
2. 创建新 release
3. Tag: v0.1.0-rc.7
4. 标题: v0.1.0-rc.7 - RC7 Native Bundle Release
5. 说明: 使用 RELEASE.md 内容
6. 附件: 上传 dsh-web-search-pool-0.1.0-rc.7.tgz

### 4. 可选: 发布到 npm

```bash
npm login
npm publish
```

## 安全检查清单

- [x] API keys 未硬编码在任何源码中
- [x] credentials.yaml 和 .env 不在 git 跟踪
- [x] node_modules 已在 .gitignore 中排除
- [x] README 中不包含任何密钥示例
- [x] CHANGELOG 不包含敏感信息

## 后续维护

1. 更新版本: 修改 package.json version + CHANGELOG
2. 发版流程: npm test -> npm pack -> GitHub release
3. 配置 GitHub Issues 和模板