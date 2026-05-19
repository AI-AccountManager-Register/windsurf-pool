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
exports.repairDuplicateAcpAgents = repairDuplicateAcpAgents;
exports.scheduleAcpAgentRepair = scheduleAcpAgentRepair;
exports.reloadWindsurfAcpConnections = reloadWindsurfAcpConnections;
exports.scheduleAcpConnectionRecovery = scheduleAcpConnectionRecovery;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
let _repairTimer;
let _reloadTimer;
/** 异步执行原生 Shell 命令（不触发安全软件拦截） */
function runCmd(cmd, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(cmd, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            if (err)
                reject(new Error(err.message));
            else
                resolve(stdout.trim());
        });
    });
}
/** PowerShell 仅作 fallback（wmic 不可用时） */
function runPowerShell(script) {
    const wrappedScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
${script}
`;
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrappedScript], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err)
                reject(new Error(stderr?.trim() || err.message));
            else
                resolve(stdout.trim());
        });
    });
}
/**
 * 修复 Windsurf 本体 ACP agent 重载后重复残留的问题。
 * 只清理重复的 `devin.exe acp --agent-type summarizer` 旧进程，不碰会话记录/.pb/state DB。
 */
async function repairDuplicateAcpAgents(reason = 'manual') {
    if (process.platform !== 'win32')
        return 0;
    let processes = [];
    // 1. 优先用 wmic（原生命令，不触发安全软件拦截）
    try {
        const stdout = await runCmd('wmic process where "name=\'devin.exe\'" get ProcessId,CommandLine,CreationDate /FORMAT:LIST');
        if (stdout) {
            const blocks = stdout.split(/\r?\n\r?\n/).filter(b => b.trim());
            for (const block of blocks) {
                const pidMatch = block.match(/ProcessId=(\d+)/);
                const cmdMatch = block.match(/CommandLine=(.*)/);
                const dateMatch = block.match(/CreationDate=([\d.+\-]+)/);
                if (!pidMatch || !cmdMatch)
                    continue;
                if (!/acp\s+--agent-type\s+summarizer/i.test(cmdMatch[1]))
                    continue;
                const pid = parseInt(pidMatch[1], 10);
                if (!Number.isFinite(pid))
                    continue;
                processes.push({ ProcessId: pid, CreationDate: dateMatch ? dateMatch[1] : '0' });
            }
        }
    }
    catch {
        // wmic 失败，回退 PowerShell
        try {
            const psQuery = `
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -ieq 'devin.exe' -and $_.CommandLine -match 'acp\\s+--agent-type\\s+summarizer' } |
  ForEach-Object {
    [PSCustomObject]@{ ProcessId = [int]$_.ProcessId; CreationDate = $_.CreationDate.ToString('yyyyMMddHHmmss') }
  } | ConvertTo-Json -Compress
`;
            const psOut = await runPowerShell(psQuery);
            if (psOut) {
                const parsed = JSON.parse(psOut);
                const list = Array.isArray(parsed) ? parsed : [parsed];
                for (const p of list) {
                    const pid = Number(p.ProcessId);
                    if (!Number.isFinite(pid))
                        continue;
                    processes.push({ ProcessId: pid, CreationDate: String(p.CreationDate || '0') });
                }
            }
        }
        catch (err) {
            console.warn(`[acpRecovery] query failed (${reason}):`, err);
            return 0;
        }
    }
    if (processes.length <= 1)
        return 0;
    // 按创建时间排序，保留最新的
    processes.sort((a, b) => a.CreationDate.localeCompare(b.CreationDate));
    const keep = processes[processes.length - 1];
    const stale = processes.slice(0, -1).map(p => p.ProcessId).filter(pid => pid !== keep.ProcessId);
    if (stale.length === 0)
        return 0;
    // 使用 taskkill 终止旧进程（原生命令，不需要 PowerShell）
    for (const pid of stale) {
        try {
            await runCmd(`taskkill /PID ${pid} /F`, 5000);
        }
        catch { /* ignore */ }
    }
    console.log(`[acpRecovery] cleaned stale ACP agents (${reason}); kept=${keep.ProcessId}; killed=${stale.join(',')}`);
    return stale.length;
}
function scheduleAcpAgentRepair(reason, delayMs = 3500) {
    if (process.platform !== 'win32')
        return;
    if (_repairTimer)
        clearTimeout(_repairTimer);
    _repairTimer = setTimeout(() => {
        _repairTimer = undefined;
        repairDuplicateAcpAgents(reason).catch(err => {
            console.warn(`[acpRecovery] scheduled repair failed (${reason}):`, err);
        });
    }, delayMs);
}
/**
 * 修复 Cascade 输入回弹：测活/切号后 Windsurf 的 ACP 连接偶尔会停在半失效状态。
 * 这里调用 Windsurf 官方命令重建 ACP connections，不删除会话历史。
 */
async function reloadWindsurfAcpConnections(reason = 'manual') {
    try {
        const commands = await vscode.commands.getCommands(true);
        if (!commands.includes('windsurf.reloadAcpConnections')) {
            console.warn(`[acpRecovery] reload ACP command is not registered yet (${reason})`);
            return false;
        }
        await vscode.commands.executeCommand('windsurf.reloadAcpConnections');
        console.log(`[acpRecovery] reloaded ACP connections (${reason})`);
        return true;
    }
    catch (err) {
        console.warn(`[acpRecovery] reload ACP connections failed (${reason}):`, err);
        return false;
    }
}
function scheduleAcpConnectionRecovery(reason, delayMs = 1500, attempts = 6) {
    if (_reloadTimer)
        clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(async () => {
        _reloadTimer = undefined;
        const ok = await reloadWindsurfAcpConnections(reason);
        if (ok) {
            scheduleAcpAgentRepair(`${reason}:post-reload-cleanup`, 10000);
            return;
        }
        if (attempts > 1) {
            scheduleAcpConnectionRecovery(`${reason}:retry`, 2500, attempts - 1);
        }
    }, delayMs);
}
//# sourceMappingURL=acpRecovery.js.map