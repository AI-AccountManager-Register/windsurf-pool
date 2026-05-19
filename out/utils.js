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
exports.isLinux = exports.isMac = exports.isWindows = void 0;
exports.getAppDataDir = getAppDataDir;
exports.getPoolRoot = getPoolRoot;
exports.ensureDir = ensureDir;
exports.isWritable = isWritable;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
exports.isWindows = process.platform === 'win32';
exports.isMac = process.platform === 'darwin';
exports.isLinux = process.platform === 'linux';
/**
 * 获取跨平台应用数据目录
 * Windows: %APPDATA%
 * macOS:   ~/Library/Application Support
 * Linux:   $XDG_CONFIG_HOME 或 ~/.config
 */
function getAppDataDir() {
    if (exports.isWindows) {
        const appdata = process.env.APPDATA;
        if (!appdata) {
            throw new Error('APPDATA 环境变量不存在');
        }
        return appdata;
    }
    if (exports.isMac) {
        return path.join(os.homedir(), 'Library', 'Application Support');
    }
    // Linux / other
    return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}
/**
 * 获取 Windsurf Pool 根目录
 */
function getPoolRoot() {
    return path.join(getAppDataDir(), '.windsurf-pool');
}
/**
 * 确保目录存在
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
/**
 * 检测路径是否可写（用 fs.accessSync W_OK 检测）
 * 不存在则返回 true（创建时再判断）
 */
function isWritable(p) {
    try {
        if (!fs.existsSync(p))
            return true;
        fs.accessSync(p, fs.constants.W_OK);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=utils.js.map