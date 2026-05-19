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
exports.initDiskCache = initDiskCache;
exports.loadAll = loadAll;
exports.readEntry = readEntry;
exports.writeEntry = writeEntry;
exports.pickNewer = pickNewer;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const FILE_NAME = 'usage-cache.json';
const FILE_VERSION = 1;
let _ctx = null;
let _path = null;
let _writeQueue = Promise.resolve();
function initDiskCache(ctx) {
    _ctx = ctx;
    _path = null; // reset，下次 lazy 解析
}
function resolvePath() {
    if (_path)
        return _path;
    if (!_ctx)
        return null;
    try {
        const dir = _ctx.globalStorageUri.fsPath;
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        _path = path.join(dir, FILE_NAME);
        return _path;
    }
    catch (err) {
        console.warn('[usageDiskCache] resolve path failed:', err);
        return null;
    }
}
function readShape() {
    const p = resolvePath();
    const empty = { v: FILE_VERSION, entries: {} };
    if (!p || !fs.existsSync(p))
        return empty;
    try {
        const txt = fs.readFileSync(p, 'utf8');
        const obj = JSON.parse(txt);
        if (obj?.v !== FILE_VERSION || !obj.entries)
            return empty;
        return obj;
    }
    catch (err) {
        console.warn('[usageDiskCache] read failed:', err);
        return empty;
    }
}
/**
 * 启动时一次性加载所有缓存，回填到内存
 */
function loadAll() {
    const result = new Map();
    const obj = readShape();
    for (const [email, entry] of Object.entries(obj.entries)) {
        if (entry && typeof entry.ts === 'number') {
            result.set(email, entry);
        }
    }
    return result;
}
/**
 * 读取单条记录（用于运行时检查其他窗口是否刚刷过）
 */
function readEntry(email) {
    const obj = readShape();
    return obj.entries[email] || null;
}
/**
 * 队列化写入单条记录（atomic：tmp + rename）
 * 多窗口并发安全：每次写入前重新读盘合并，避免互相覆盖。
 *
 * 跨进程注意：本进程内 _writeQueue 串行化避免本进程内竞争；
 * 跨进程（多扩展宿主）依靠 doWrite 内部"先读后写 + atomic rename"做 best-effort 合并，
 * 极少数情况下后写入会覆盖前者最新 ts，但下次刷新会自愈。
 *
 * @returns Promise 在该次写入完成（或失败被 catch 后）resolve，让调用方可选择 await
 */
function writeEntry(email, entry) {
    const task = _writeQueue.then(() => doWrite(email, entry)).catch(err => {
        console.warn('[usageDiskCache] write queue error:', err);
    });
    _writeQueue = task;
    return task;
}
async function doWrite(email, entry) {
    const p = resolvePath();
    if (!p)
        return;
    try {
        const obj = readShape();
        obj.entries[email] = entry;
        const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
        try {
            fs.renameSync(tmp, p);
        }
        catch (renameErr) {
            // Windows 下偶发 EPERM/EBUSY，回退到直接写
            try {
                fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
            }
            catch { }
            try {
                fs.unlinkSync(tmp);
            }
            catch { }
            throw renameErr;
        }
    }
    catch (err) {
        console.warn('[usageDiskCache] doWrite failed:', err);
    }
}
/**
 * 比较两个缓存条目，返回更新的那个（ts 更大）
 */
function pickNewer(a, b) {
    if (!a)
        return b || undefined;
    if (!b)
        return a;
    return b.ts > a.ts ? b : a;
}
//# sourceMappingURL=usageDiskCache.js.map