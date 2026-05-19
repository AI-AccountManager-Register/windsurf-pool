"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEnhSettingsPath = getEnhSettingsPath;
exports.readEnhSettings = readEnhSettings;
exports.writeEnhSettings = writeEnhSettings;
exports.mergeEnhSettings = mergeEnhSettings;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
/**
 * 增强设置共享存储（enh-settings.json）
 *
 * 用途：
 * VS Code 侧栏 webview 的 localStorage 与 workbench.html 的 localStorage 因 origin
 * 隔离不能直接同步。本模块将设置持久化到磁盘文件，由扩展宿主作为中转：
 *
 *   侧栏 webview → postMessage → 扩展宿主 → 写入 enh-settings.json
 *                                       └─→ 注入 workbench.html 时嵌入为全局变量
 *                                              ↓ reload 后
 *                                       windsurf-better.js 读取生效
 *
 * 真相源：本模块管理的 JSON 文件
 */
const ENH_SETTINGS_FILE = 'enh-settings.json';
function getEnhSettingsPath() {
    return path.join((0, utils_1.getPoolRoot)(), ENH_SETTINGS_FILE);
}
/**
 * 读取增强设置（不存在时返回 {}）
 */
function readEnhSettings() {
    try {
        const p = getEnhSettingsPath();
        if (!fs.existsSync(p))
            return {};
        const raw = fs.readFileSync(p, 'utf8');
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object')
            return {};
        // 兼容：旧版本在此文件里写了 __bridgePort/__bridgeToken（多实例会互相覆盖）。
        // 新版本 bridge 信息改由 sidebar postMessage 广播，这里剥离掉避免污染 hash。
        if ('__bridgePort' in obj || '__bridgeToken' in obj) {
            delete obj.__bridgePort;
            delete obj.__bridgeToken;
        }
        return obj;
    }
    catch {
        return {};
    }
}
/**
 * 写入增强设置（原子替换）
 */
function writeEnhSettings(settings) {
    try {
        (0, utils_1.ensureDir)((0, utils_1.getPoolRoot)());
        const p = getEnhSettingsPath();
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
        fs.renameSync(tmp, p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 合并部分设置后写回（用于 webview 的 saveEnhanceSettings 增量同步）
 */
function mergeEnhSettings(patch) {
    const current = readEnhSettings();
    const updated = { ...current, ...patch };
    writeEnhSettings(updated);
    return updated;
}
//# sourceMappingURL=enhSettingsStore.js.map