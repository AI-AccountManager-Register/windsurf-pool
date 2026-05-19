# windsurf-pool 二次开发指南

> **本工程不是原作者发布的源码仓库。**
>
> 原作者：`soulvon`，原仓库：`https://github.com/soulvon/windsurf-pool-releases`（仅发布预编译 vsix，无源码）。本目录是基于 `windsurf-pool-7.4.0.vsix` 与 `windsurf-pool-7.5.3.vsix` 重建的可二次开发工程，所有 `out/*.js` 来源于原 vsix 解压产物（未混淆未压缩，等同源码）。
>
> 二次开发请保留 `LICENSE.txt` 与原作者署名。

---

## 工程来源

| 项 | 说明 |
|---|---|
| 基础版本 | `windsurf-pool-7.4.0.vsix` 解压 |
| 已合并 | `windsurf-pool-7.5.3.vsix` 的 5 个实质代码改动 |

7.4.0 → 7.5.3 实质合入清单：

| 文件 | 字节增量 | 说明 |
|---|---|---|
| `out/healthCheckPanel.js` | +7,857 | 测活面板核心逻辑 |
| `resources/webview/health-check.js` | +7,608 | 测活 Webview JS |
| `resources/webview/health-check.css` | +2,011 | 测活样式 |
| `out/loginService.js` | +1,052 | 登录服务 |
| `out/statusBar.js` | +424 | 状态栏 |
| `package.json` | 0 | 版本号 7.4.0 → 7.5.3 |

7.5.3 其它差异都是 `.vscodeignore` 瘦身（移除 `orderProject/`、设计稿 HTML、source map 等），本工程已通过 `.vscodeignore` 同步处理。

---

## 目录结构

```
windsurf-pool/
├── out/                       已编译产物 (= 源码，可直接编辑)
│   ├── extension.js           扩展入口
│   ├── sidebarProvider.js     侧栏 Webview
│   ├── healthCheckPanel.js    测活面板 (7.5.3 重点更新)
│   ├── updater.js             自动更新
│   ├── enhancementInjector.js 注入 windsurf-better.js 到 workbench
│   └── ... (共 31 个 .js 模块)
├── resources/
│   ├── webview/               侧栏/面板的前端 JS/CSS/HTML
│   └── windsurf-better.js     注入到 Windsurf 主窗口的脚本 (自动继续/恢复等)
├── src/                       (空) 渐进式 .ts 重构入口，参见 src/README.md
├── scripts/
│   └── upload-release.js      发布占位脚本
├── docs/                      原作者设计文档
├── orderProject/              原作者研发资料 (与产品功能无关，已加入 .vscodeignore)
├── package.json
├── tsconfig.json              allowJs 模式
├── .vscodeignore              复刻 7.5.3 瘦身策略
├── LICENSE.txt                原作者 MIT 许可
└── BUILD.md                   本文件
```

---

## 开发流程

### 1. 安装依赖

```bash
npm install
```

如果速度慢可换源：

```bash
npm install --registry=https://registry.npmmirror.com
```

### 2. 运行/调试

VS Code 打开本目录，按 `F5` 启动 "Extension Development Host"。

或者直接打包安装到本地 Windsurf：

```bash
npm run package
# 生成 windsurf-pool-7.5.3.vsix
```

### 3. 修改代码

#### 3.1 改 `out/*.js`（推荐）

直接编辑 `out/` 下的 .js 文件。代码完整保留中文注释，结构清晰：

| 模块 | 功能 |
|---|---|
| `extension.js` | 扩展激活，命令注册 |
| `sidebarProvider.js` | 侧栏主面板 (164KB，最大模块) |
| `accountStore.js` | 账号存储 |
| `accountLock.js` | 多实例账号锁 |
| `instanceManager.js` | 实例管理 (多 user-data-dir) |
| `sessionInjector.js` | 注入 session token 到 Windsurf |
| `windsurfOAuthService.js` | Windsurf OAuth 流程 |
| `loginService.js` | 登录服务 (7.5.3 微调) |
| `statusBar.js` | 底部状态栏 (7.5.3 微调) |
| `healthCheckPanel.js` | 测活面板 (7.5.3 重大更新) |
| `usageService.js` / `usageTracker.js` | 配额抓取与统计 |
| `enhancementInjector.js` + `resources/windsurf-better.js` | 注入自动继续/汉化 |
| `updater.js` | GitHub Releases 自动更新 |
| `bridgeServer.js` / `signalBridge.js` | localhost HTTP 桥（webview ↔ 扩展） |
| `cascadeProbe.js` | Cascade 探针 |
| `checksumFixer.js` | 修复 product.json 校验值 |
| `elevatedFs.js` | UAC 提权写文件 |

#### 3.2 升级到 `.ts`（可选）

参见 `src/README.md`。

### 4. 重新打包

```bash
npm run package
```

生成的 `.vsix` 安装到 Windsurf：命令面板 → "Extensions: Install from VSIX..."。

---

## 自动更新指向

`package.json` 的默认 `windsurfPool.update.repoOwner=soulvon` / `repoName=windsurf-pool-releases`。

**如果你二次发布**，强烈建议改为自己的仓库（避免误把用户引向上游 release）：

```jsonc
// package.json 里的 contributes.configuration.properties
"windsurfPool.update.repoOwner": { "default": "<你的 github 用户名>" },
"windsurfPool.update.repoName":  { "default": "<你的 release 仓库名>" },
```

---

## 关于版权

- 原作者：`soulvon`
- 许可：MIT (见 `LICENSE.txt`)
- 二次发布请保留原 `LICENSE.txt` 与作者署名，并在 README 中说明你的修改范围。
- 不要把本工程冒充为原项目，避免与 `soulvon/windsurf-pool-releases` 的自动更新通道冲突。
