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
exports.ElevationError = void 0;
exports.beginElevatedBatch = beginElevatedBatch;
exports.flushElevatedBatch = flushElevatedBatch;
exports.cancelElevatedBatch = cancelElevatedBatch;
exports.writeFileWithElevation = writeFileWithElevation;
exports.copyFileWithElevation = copyFileWithElevation;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
let _batch = null;
// ────── 自定义错误 ──────
class ElevationError extends Error {
    constructor(message, userDenied) {
        super(message);
        this.name = 'ElevationError';
        this.userDenied = userDenied;
    }
}
exports.ElevationError = ElevationError;
// ────── 工具函数 ──────
function isEPERM(err) {
    return err instanceof Error && 'code' in err && err.code === 'EPERM';
}
function esc(s) { return s.replace(/'/g, "''"); }
/**
 * 检测目标目录是否需要提权写入（结果缓存于进程生命周期）
 */
const _elevationCache = new Map();
function needsElevation(targetPath) {
    const dir = path.dirname(targetPath);
    if (_elevationCache.has(dir))
        return _elevationCache.get(dir);
    try {
        fs.accessSync(dir, fs.constants.W_OK);
        _elevationCache.set(dir, false);
        return false;
    }
    catch {
        _elevationCache.set(dir, true);
        return true;
    }
}
/** 判断 execSync 错误是否为 UAC 拒绝 */
function isUacDenied(err) {
    const msg = String(err).toLowerCase();
    return msg.includes('canceled') || msg.includes('cancelled')
        || msg.includes('denied') || msg.includes('1223');
}
/**
 * 执行提权 PowerShell 脚本（Windows 专用）
 * 将脚本内容写入临时 .ps1 文件，通过 Start-Process -Verb RunAs 触发 UAC。
 * 脚本末尾写入哨兵文件，执行后校验以检测静默失败。
 */
function runElevatedScript(scriptContent) {
    const ts = Date.now();
    const scriptPath = path.join(os.tmpdir(), `wp-elevate-${ts}.ps1`);
    const sentinelPath = path.join(os.tmpdir(), `wp-sentinel-${ts}`);
    // 哨兵：脚本成功执行完毕后写入标记文件
    const fullScript = scriptContent + `\n'ok' | Out-File -LiteralPath '${esc(sentinelPath)}' -Encoding utf8`;
    fs.writeFileSync(scriptPath, fullScript, 'utf8');
    try {
        const escaped = scriptPath.replace(/'/g, "''");
        (0, child_process_1.execSync)(`powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escaped}')"`, { windowsHide: true, timeout: 120000 });
        // 校验哨兵文件
        if (!fs.existsSync(sentinelPath)) {
            throw new ElevationError('Windsurf 安装目录写入失败：提权脚本未正常完成，请尝试以管理员身份运行 Windsurf。', false);
        }
    }
    catch (err) {
        if (err instanceof ElevationError)
            throw err;
        if (isUacDenied(err)) {
            throw new ElevationError('Windsurf 安装在受保护目录（如 Program Files），需要管理员权限。请在弹出的权限对话框中点击「是」，或以管理员身份运行 Windsurf。', true);
        }
        throw new ElevationError(`提权执行失败: ${err instanceof Error ? err.message : String(err)}`, false);
    }
    finally {
        try {
            fs.unlinkSync(scriptPath);
        }
        catch { /* ignore */ }
        try {
            fs.unlinkSync(sentinelPath);
        }
        catch { /* ignore */ }
    }
}
// ────── 批量执行引擎 ──────
/**
 * 执行一组操作：先尝试普通 fs，遇 EPERM 时全部走提权（单次 UAC）
 */
function executeOps(ops) {
    if (ops.length === 0)
        return;
    // 快速判断：目标目录是否可写
    const elevated = process.platform === 'win32' && ops.some(op => needsElevation(op.dest));
    if (!elevated) {
        // 普通模式：逐个执行
        for (const op of ops) {
            if (op.type === 'write') {
                fs.writeFileSync(op.dest, op.content, op.encoding);
            }
            else {
                fs.copyFileSync(op.src, op.dest);
            }
        }
        return;
    }
    // 提权模式：写临时文件 + 构建单个 PS1 脚本
    const tmpFiles = [];
    const lines = [];
    for (const op of ops) {
        if (op.type === 'write') {
            const tmp = path.join(os.tmpdir(), `wp-${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(op.dest)}`);
            fs.writeFileSync(tmp, op.content, op.encoding);
            tmpFiles.push(tmp);
            lines.push(`Copy-Item -LiteralPath '${esc(tmp)}' -Destination '${esc(op.dest)}' -Force`);
        }
        else {
            lines.push(`Copy-Item -LiteralPath '${esc(op.src)}' -Destination '${esc(op.dest)}' -Force`);
        }
    }
    try {
        runElevatedScript(lines.join('\n'));
    }
    finally {
        for (const f of tmpFiles) {
            try {
                fs.unlinkSync(f);
            }
            catch { /* ignore */ }
        }
    }
}
// ────── 公开 API: 批量模式 ──────
/**
 * 开始收集文件操作（调用后 writeFileWithElevation/copyFileWithElevation 只入队不执行）
 */
function beginElevatedBatch() {
    _batch = [];
}
/**
 * 执行所有已收集的操作（需要提权时仅弹一次 UAC）
 * 如果队列为空则无操作
 */
function flushElevatedBatch() {
    if (!_batch || _batch.length === 0) {
        _batch = null;
        return;
    }
    const ops = _batch;
    _batch = null;
    executeOps(ops);
}
/**
 * 取消批量模式，丢弃所有已收集的操作
 */
function cancelElevatedBatch() {
    _batch = null;
}
// ────── 公开 API: 单次操作（批量模式下自动入队） ──────
/**
 * 写入文件，EPERM 时自动提权（Windows UAC）
 * 批量模式下仅入队，flush 时统一执行
 */
function writeFileWithElevation(filePath, content, encoding = 'utf8') {
    if (_batch !== null) {
        _batch.push({ type: 'write', dest: filePath, content, encoding });
        return;
    }
    executeOps([{ type: 'write', dest: filePath, content, encoding }]);
}
/**
 * 复制文件，EPERM 时自动提权（Windows UAC）
 * 批量模式下仅入队，flush 时统一执行
 */
function copyFileWithElevation(src, dest) {
    if (_batch !== null) {
        _batch.push({ type: 'copy', src, dest });
        return;
    }
    executeOps([{ type: 'copy', src, dest }]);
}
//# sourceMappingURL=elevatedFs.js.map