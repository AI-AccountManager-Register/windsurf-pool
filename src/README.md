# `src/` 目录

## 现状

本工程是从 `windsurf-pool-7.4.0.vsix` 反向重建而来。原作者使用 `tsc -p ./` 编译 `src/*.ts` → `out/*.js`，但 **`src/` 目录的原始 `.ts` 文件未随 vsix 发布**，因此本目录初始为空（仅本说明）。

## 开发模式

`tsconfig.json` 已配置 `allowJs: true`，所以两种工作流都可以：

### 模式 A：直接编辑 `out/*.js`（推荐，零摩擦）

`out/` 下的 `.js` 文件是 `tsc` 直出，**未混淆未压缩**，函数名/中文注释完整，可读性等同于 `.ts`。直接修改 `.js` 即可生效，不需要编译。

```bash
# 改完 out/X.js 后直接打包
npm run package
```

### 模式 B：渐进式升级到 `.ts`

挑一个想重构的模块，把 `out/X.js` 复制为 `src/X.ts`：

```powershell
Copy-Item out\someModule.js src\someModule.ts
```

然后：

1. 把 CommonJS 风格转成 ES Module：
   - `var __importStar = ...; const vscode = __importStar(require("vscode"));` → `import * as vscode from 'vscode';`
   - `Object.defineProperty(exports, "__esModule", { value: true });` → 删除
   - `exports.foo = foo;` → 在 `function foo(...)` 前加 `export`
2. 加类型注解（参数、返回值、变量）
3. `npm run compile` 会自动产出 `out/X.js`，**覆盖**原来那份

## 注意

- 如果同时有 `src/X.ts` 与 `out/X.js`，编译后 `out/X.js` 会被覆盖。一旦放进 `src/` 就要承担起源码维护责任。
- 暂时不需要重构的模块**完全不用动**——`out/` 现有 `.js` 文件已经能正常工作。

## 公共基础设施（v7.5.5+）

- `out/util/logger.js`：统一日志工具
  - `const L = require('./util/logger').get('mod-name');`
  - `L.info('xxx')`, `L.warn(...)`, `L.error(err)`, `L.swallow('label', fn)`
  - 输出会进入命名为 `Windsurf 号池 · 日志` 的 OutputChannel
- `resources/webview/lib/state.js`：webview 状态持久化 (`wsState.bind(vscode)`, `wsState.get/set/update`)
- `resources/webview/lib/toast.js`：统一 toast (`wsToast.success/warn/error/info`)
- `resources/webview/lib/template.js`：安全 HTML 模板 (`wsHtml\`...\``, `wsRaw(...)`)

webview 端通过 `sidebarProvider._getHtmlForWebview` 自动按顺序加载这三个 lib，再加载 `main.js`。

## 后续 TS 重构推荐顺序

1. `src/types.ts` – 收口 Account / UsageSnapshot / SwitchResult 等共用类型。
2. `src/util/logger.ts` – 将 `out/util/logger.js` 升为 TS（注意保持 CommonJS 导出语义）。
3. 把 `out/sidebarProvider.js` 中的 HTML 模板拆为 `src/webview/templates/*.html` + `src/webview/sidebarHtml.ts`。
4. 把 `resources/webview/main.js` 按区分拆为 `lib/` + `modules/` + `main.js` 入口。
