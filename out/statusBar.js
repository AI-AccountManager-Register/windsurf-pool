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
exports.StatusBarManager = void 0;
/**
 * 底部状态栏管理器
 *
 * 双分段设计：
 *   [左]  $(account) [实例] 邮箱前缀 · D78% W45%   → 点击打开侧栏
 *   [右]  $(pulse) 池 23/50 · $(zap) 自动           → 点击弹出 QuickPick 菜单
 *
 * 特性：
 * - 额度低于 minQuota 时背景变黄警示
 * - 冷却期显示倒计时（自动每秒刷新）
 * - 配置项从 enh-settings.json 读取，支持实时开关各显示项
 * - 订阅 AutoSwitcher.onDidUpdate 事件，刷新/切号时自动重绘
 */
const vscode = __importStar(require("vscode"));
const enhSettingsStore_1 = require("./enhSettingsStore");
const instanceManager_1 = require("./instanceManager");
const accountStore_1 = require("./accountStore");
const DEFAULTS = {
    enabled: true,
    position: 'right',
    style: 'labeled',
    showPool: true,
    showAutoSwitch: true,
    showInstance: true,
    showSwitches: true,
};
const VALID_STYLES = ['dot', 'percent', 'compact', 'dual', 'labeled', 'full'];
const VALID_POSITIONS = ['left', 'right'];
const MENU_CMD = 'windsurfPool.statusBarMenu';
const REFRESH_CMD = 'windsurfPool.statusBarRefresh';
class StatusBarManager {
    constructor(ctx, auto, tracker) {
        this._disposables = [];
        this._cooldownTimer = null;
        this._redrawTimer = null;
        /** 当前 StatusBarItem 的 alignment（仅创建时可设置，需要变更时重建） */
        this._currentAlignment = vscode.StatusBarAlignment.Left;
        this._ctx = ctx;
        this._auto = auto;
        this._tracker = tracker || null;
        this._left = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._left.command = 'windsurfPool.openSidebar';
        this._right = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this._right.command = MENU_CMD;
        this._registerCommands();
        // 订阅 AutoSwitcher 更新事件：刷新 / 切号完成时自动重绘
        this._disposables.push(auto.onDidUpdate(() => this.update()));
        // 每 30 秒重绘一次（只读缓存，不调 API），保持 tooltip 时间戳同步
        // 事件驱动已覆盖大多数变化，30s 已足够
        this._redrawTimer = setInterval(() => this.update(), 30000);
    }
    _registerCommands() {
        // QuickPick 菜单
        this._disposables.push(vscode.commands.registerCommand(MENU_CMD, async () => {
            const s = this._auto.settings;
            const cd = Math.ceil(this._auto.cooldownRemainingMs / 1000);
            const autoLabel = s.enabled
                ? (cd > 0 ? `$(clock) 自动切号冷却中（${cd}s）` : '$(zap) 自动切号：开启')
                : '$(circle-slash) 自动切号：关闭';
            const picks = [
                { label: '$(arrow-swap) 手动切换账号', action: 'switch' },
                { label: '$(sync) 刷新所有额度', action: 'refresh' },
                { label: autoLabel, description: '切换自动切号开关', action: 'toggle' },
                { label: '$(preview) 打开号池面板', action: 'open' },
            ];
            const sel = await vscode.window.showQuickPick(picks, { placeHolder: 'Windsurf 号池' });
            if (!sel)
                return;
            switch (sel.action) {
                case 'switch':
                    await vscode.commands.executeCommand('windsurfPool.switchAccount');
                    break;
                case 'refresh':
                    vscode.window.setStatusBarMessage('$(sync~spin) 正在刷新额度...', 2000);
                    await this._auto.refreshAll(true);
                    break;
                case 'toggle':
                    await this._auto.updateSettings({ enabled: !s.enabled });
                    this.update();
                    break;
                case 'open':
                    await vscode.commands.executeCommand('windsurfPool.openSidebar');
                    break;
            }
        }));
        // 外部触发状态栏刷新（设置面板保存后调用）
        this._disposables.push(vscode.commands.registerCommand(REFRESH_CMD, () => this.update()));
    }
    _getConfig() {
        try {
            const enh = (0, enhSettingsStore_1.readEnhSettings)();
            const sb = (enh && enh.statusBar) || {};
            const style = VALID_STYLES.includes(sb.style) ? sb.style : DEFAULTS.style;
            const position = VALID_POSITIONS.includes(sb.position) ? sb.position : DEFAULTS.position;
            return {
                enabled: sb.enabled !== false,
                position,
                style,
                showPool: sb.showPool !== false,
                showAutoSwitch: sb.showAutoSwitch !== false,
                showInstance: sb.showInstance !== false,
                showSwitches: sb.showSwitches !== false,
            };
        }
        catch {
            return { ...DEFAULTS };
        }
    }
    /** 根据 position 配置确保两个 StatusBarItem 的对齐方向正确 */
    _ensureAlignment(position) {
        const target = position === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
        if (target === this._currentAlignment)
            return;
        // 销毁旧的，重建新的
        try {
            this._left.dispose();
        }
        catch { /* ignore */ }
        try {
            this._right.dispose();
        }
        catch { /* ignore */ }
        // 右侧时优先级反转，让"账号+额度"显示在更靠近文件信息的一侧
        if (target === vscode.StatusBarAlignment.Right) {
            this._left = vscode.window.createStatusBarItem(target, 100);
            this._right = vscode.window.createStatusBarItem(target, 99);
        }
        else {
            this._left = vscode.window.createStatusBarItem(target, 100);
            this._right = vscode.window.createStatusBarItem(target, 99);
        }
        this._left.command = 'windsurfPool.openSidebar';
        this._right.command = MENU_CMD;
        this._currentAlignment = target;
    }
    update() {
        const cfg = this._getConfig();
        if (!cfg.enabled) {
            this._left.hide();
            this._right.hide();
            return;
        }
        this._ensureAlignment(cfg.position);
        this._renderLeft(cfg);
        this._renderRight(cfg);
    }
    _renderLeft(cfg) {
        const curEmail = this._ctx.globalState.get('lastEmail') || '';
        const entry = curEmail ? this._auto.getCached(curEmail) : undefined;
        const snap = entry?.snapshot;
        // ── emoji 分级指示（按 min(日剩余, 周剩余)）──
        // 仅靠 emoji 着色，不改文字色/背景色，避免整条变色干扰其他状态栏内容
        // 仅在 < 10% 极低额度时启用红色警示背景，强提醒用户
        let dot = '';
        if (snap) {
            const min = Math.min(snap.dailyRemainingPercent, snap.weeklyRemainingPercent);
            if (min < 10) {
                dot = '🔴';
                this._left.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            }
            else if (min < 30) {
                dot = '🟡';
                this._left.backgroundColor = undefined;
            }
            else if (min < 50) {
                dot = '🔵';
                this._left.backgroundColor = undefined;
            }
            else {
                dot = '🟢';
                this._left.backgroundColor = undefined;
            }
        }
        else {
            this._left.backgroundColor = undefined;
        }
        this._left.color = undefined;
        // ── 实例前缀 ──
        let prefix = '';
        if (cfg.showInstance) {
            try {
                const inst = (0, instanceManager_1.getCurrentInstanceName)();
                if (inst && inst !== 'default')
                    prefix = `[${inst}] `;
            }
            catch { /* ignore */ }
        }
        // ── 渲染主体（按 style 分发）──
        const body = this._renderBodyByStyle(cfg.style, dot, snap, curEmail);
        this._left.text = `$(account) ${prefix}${body}`;
        this._left.tooltip = this._buildLeftTooltip(curEmail, entry);
        this._left.show();
    }
    _renderBodyByStyle(style, dot, snap, curEmail) {
        const short = curEmail ? curEmail.split('@')[0] : '未登录';
        if (!snap)
            return short;
        const d = Math.round(snap.dailyRemainingPercent);
        const w = Math.round(snap.weeklyRemainingPercent);
        const min = Math.min(d, w);
        switch (style) {
            case 'dot':
                // 🟢
                return dot || short;
            case 'percent':
                // 75%
                return `${min}%`;
            case 'compact':
                // 🟢 75%
                return `${dot} ${min}%`.trim();
            case 'dual':
                // 🟢 75% / 87%
                return `${dot} ${d}% / ${w}%`.trim();
            case 'full':
                // sox · 🟢 日剩余75% 周剩余87%
                return `${short} · ${dot} 日剩余${d}% 周剩余${w}%`.trim();
            case 'labeled':
            default:
                // 日剩余 🟡 75% 周剩余 87%（默认）
                return `日剩余 ${dot} ${d}% 周剩余 ${w}%`.trim();
        }
    }
    _buildLeftTooltip(email, entry) {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        if (!email) {
            md.appendMarkdown('**未登录 Windsurf**\n\n点击打开号池面板登录账号');
            return md;
        }
        md.appendMarkdown(`**${email}**\n\n`);
        const snap = entry?.snapshot;
        if (!snap) {
            const err = entry?.error ? `- 错误：${entry.error}\n` : '';
            md.appendMarkdown(`_暂无额度数据_\n\n${err}点击打开号池面板`);
            return md;
        }
        md.appendMarkdown(`- **计划**：${snap.planName}\n`);
        md.appendMarkdown(`- **日剩余**：${Math.round(snap.dailyRemainingPercent)}%\n`);
        md.appendMarkdown(`- **周剩余**：${Math.round(snap.weeklyRemainingPercent)}%\n`);
        if (snap.flexCredits > 0)
            md.appendMarkdown(`- **Flex Credits**：${snap.flexCredits}\n`);
        if (snap.dailyResetAtUnix)
            md.appendMarkdown(`- **日重置**：${formatResetTime(snap.dailyResetAtUnix)}\n`);
        if (snap.weeklyResetAtUnix)
            md.appendMarkdown(`- **周重置**：${formatResetTime(snap.weeklyResetAtUnix)}\n`);
        if (entry?.ts)
            md.appendMarkdown(`- _更新于 ${Math.round((Date.now() - entry.ts) / 1000)}s 前_\n`);
        md.appendMarkdown(`\n点击打开号池面板`);
        return md;
    }
    _renderRight(cfg) {
        const parts = [];
        const curEmail = this._ctx.globalState.get('lastEmail') || '';
        if (cfg.showPool) {
            const { available, total } = this._countPool(curEmail);
            parts.push(`$(pulse) 池 ${available}/${total}`);
        }
        if (cfg.showAutoSwitch) {
            const s = this._auto.settings;
            if (s.enabled) {
                const cdMs = this._auto.cooldownRemainingMs;
                if (cdMs > 0) {
                    parts.push(`$(clock) ${Math.ceil(cdMs / 1000)}s`);
                    this._scheduleCooldownRefresh();
                }
                else {
                    parts.push('$(zap) 自动');
                }
            }
            else {
                parts.push('$(circle-slash) 手动');
            }
        }
        if (cfg.showSwitches) {
            const todaySwitches = this._getTodaySwitches();
            if (todaySwitches >= 0) {
                parts.push(`$(arrow-swap) ${todaySwitches}`);
            }
        }
        if (parts.length === 0) {
            this._right.hide();
            return;
        }
        this._right.text = parts.join(' · ');
        this._right.tooltip = '点击打开操作菜单（切号 / 刷新 / 自动切号开关）';
        this._right.show();
    }
    _countPool(curEmail) {
        const minQ = this._auto.settings.minQuota;
        let available = 0;
        // 以 accounts.json 实际账号为准，而非 UsageTracker 缓存（缓存可能含已删除的旧账号）
        const accounts = (0, accountStore_1.readAccountsSync)(this._ctx);
        const total = accounts.filter(a => !a.disabled).length;
        const cache = this._auto.getAllCached();
        for (const a of accounts) {
            if (a.disabled)
                continue;
            if (a.email === curEmail)
                continue;
            const entry = cache.get(a.email);
            if (!entry)
                continue;
            const s = entry.snapshot;
            if (!s)
                continue;
            if (s.planName && s.planName.toLowerCase().includes('free'))
                continue;
            if (entry.skipUntil && Date.now() < entry.skipUntil)
                continue;
            const min = Math.min(s.dailyRemainingPercent, s.weeklyRemainingPercent);
            if (min > minQ)
                available++;
        }
        return { available, total };
    }
    _getTodaySwitches() {
        try {
            const stats = this._tracker?.getStats?.();
            if (!stats || typeof stats.totalSwitches !== 'number') return -1;
            return stats.totalSwitches;
        } catch { return -1; }
    }
    _scheduleCooldownRefresh() {
        if (this._cooldownTimer)
            return;
        this._cooldownTimer = setTimeout(() => {
            this._cooldownTimer = null;
            this.update();
        }, 1000);
    }
    dispose() {
        this._left.dispose();
        this._right.dispose();
        for (const d of this._disposables) {
            try {
                d.dispose();
            }
            catch { /* ignore */ }
        }
        this._disposables = [];
        if (this._cooldownTimer) {
            clearTimeout(this._cooldownTimer);
            this._cooldownTimer = null;
        }
        if (this._redrawTimer) {
            clearInterval(this._redrawTimer);
            this._redrawTimer = null;
        }
    }
}
exports.StatusBarManager = StatusBarManager;
function formatResetTime(unix) {
    const diffMs = unix * 1000 - Date.now();
    if (diffMs <= 0)
        return '已重置';
    const totalMin = Math.floor(diffMs / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0)
        return `${d}天${h}小时后`;
    if (h > 0)
        return `${h}小时${m}分钟后`;
    return `${m}分钟后`;
}
//# sourceMappingURL=statusBar.js.map