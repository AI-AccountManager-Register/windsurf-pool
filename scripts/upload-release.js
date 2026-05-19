#!/usr/bin/env node
/**
 * 发布脚本占位
 *
 * 原 package.json 的 `package:release` 与 `upload` 命令引用此文件 (`node scripts/upload-release.js`)。
 * 原作者实际逻辑（推送到 GitHub Releases）未在 vsix 中分发，这里给出最小占位，避免命令报错。
 *
 * 如需真实上传，自行实现：
 *   1. 调用 GitHub Releases API 创建 release (POST /repos/:owner/:repo/releases)
 *   2. 上传 .vsix 资产 (POST /repos/:owner/:repo/releases/:id/assets)
 *   3. 读取 GITHUB_TOKEN / repoOwner / repoName 等环境变量
 */
'use strict';

console.log('[upload-release] 占位脚本：未实现自动发布。');
console.log('[upload-release] 请手动把 .vsix 上传到 GitHub Releases，或自行编辑 scripts/upload-release.js。');
process.exit(0);
