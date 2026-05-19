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
