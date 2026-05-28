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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const sidebarProvider_1 = require("./sidebarProvider");
const sessionInjector_1 = require("./sessionInjector");
const accountStore = __importStar(require("./accountStore"));
const instanceManager_1 = require("./instanceManager");
const autoSwitcher_1 = require("./autoSwitcher");
const usageDiskCache_1 = require("./usageDiskCache");
const statusBar_1 = require("./statusBar");
const updater_1 = require("./updater");
const enhancementInjector_1 = require("./enhancementInjector");
const enhSettingsStore_1 = require("./enhSettingsStore");
const rulesInjector_1 = require("./rulesInjector");
const checksumFixer_1 = require("./checksumFixer");
const bridgeServer_1 = require("./bridgeServer");
const accountLock_1 = require("./accountLock");
const utils_1 = require("./utils");
const elevatedFs_1 = require("./elevatedFs");
const usageTracker_1 = require("./usageTracker");
const logger = require("./util/logger");
const logPanelProvider_1 = require("./logPanelProvider");
const healthCheckPanel_1 = require("./healthCheckPanel");
const cascadeProbe_1 = require("./cascadeProbe");
const soundPlayer_1 = require("./soundPlayer");
const acpRecovery_1 = require("./acpRecovery");
let sidebarProvider;
let autoSwitcher;
let statusBar;
let usageTracker;
function activate(context) {
    // 统一日志通道（其他模块用 logger.get('xxx') 即可写入）
    const logChannel = vscode.window.createOutputChannel('Windsurf 号池 · 日志');
    context.subscriptions.push(logChannel);
    logger.setOutputChannel(logChannel);
    logger.get('boot').info('extension activated, version=' + (context.extension?.packageJSON?.version || '?'));
    (0, cascadeProbe_1.setExtensionPath)(context.extensionPath);
    (0, acpRecovery_1.scheduleAcpAgentRepair)('extension-activate', 10000);
    (0, acpRecovery_1.scheduleAcpConnectionRecovery)('extension-activate', 12000);
    // v6.0.3 一次性迁移：将所有实例统一改为智能选号（旧策略余额追踪不准）
    try {
        (0, instanceManager_1.migrateAllInstancesToAuto)();
    }
    catch (e) {
        console.warn('[migrate] 失败:', e);
    }
    // 多实例：检测绑定标记并自动切号（后台异步，不阻塞启动）
    // 注意：不能 await — autoSwitchByBindMark 内部的 injectSession 在 silent 模式下
    // 会等待 PATCHED_CMD 最多 30s，会阻塞所有命令注册和 UI 显示。
    // AutoSwitcher._switching 互斥能避免与定时器切号冲突。
    autoSwitchByBindMark(context);
    // 批量模式：将启动阶段所有安装目录写操作合并，需要提权时仅弹一次 UAC
    (0, elevatedFs_1.beginElevatedBatch)();
    // 预热声音播放器（Windows 上预启动 PowerShell 进程，首次播放零延迟）
    (0, soundPlayer_1.warmupSoundPlayer)();
    // 静默应用汉化（不影响扩展启动）
    (0, sessionInjector_1.applyI18nOnly)();
    // 初始化跨窗口共享的额度文件缓存（必须在 AutoSwitcher 创建前）
    (0, usageDiskCache_1.initDiskCache)(context);
    // 用量统计追踪器（必须在 AutoSwitcher 和 SidebarProvider 之前创建）
    usageTracker = new usageTracker_1.UsageTracker(context);
    context.subscriptions.push(usageTracker);
    // 创建后端自动切号引擎
    autoSwitcher = new autoSwitcher_1.AutoSwitcher(context, usageTracker);
    context.subscriptions.push(autoSwitcher);
    autoSwitcher.start();
    // 底部状态栏（独立于侧栏面板，启动即显示）
    statusBar = new statusBar_1.StatusBarManager(context, autoSwitcher, usageTracker);
    context.subscriptions.push(statusBar);
    statusBar.update();
    // 跨窗口账号锁：初始化并锁定当前账号
    (0, accountLock_1.initAccountLock)((0, instanceManager_1.getCurrentInstanceId)(), (0, instanceManager_1.getCurrentInstanceName)());
    const curEmail = context.globalState.get('lastEmail');
    if (curEmail)
        (0, accountLock_1.acquireLock)(curEmail);
    (0, accountLock_1.startHeartbeat)();
    // 自动检查更新（延迟 30 秒）
    (0, updater_1.autoCheckOnStartup)();
    // macOS/Linux: 检测安装目录是否可写，不可写则提示一次
    checkInstallPermission(context);
    // 首次安装欢迎引导（仅展示一次）
    maybeShowWelcome(context).catch((e) => logger.get('welcome').warn('show failed', e));
    // 创建侧栏提供器
    sidebarProvider = new sidebarProvider_1.SidebarProvider(context.extensionUri, context, autoSwitcher, usageTracker);
    // 侧栏手动切号成功后立即更新状态栏
    sidebarProvider.onManualSwitch = () => statusBar?.update();
    // 注册到 subscriptions，让 VSCode 在卸载时自动调用 dispose 清理 OutputChannel 和监听器
    context.subscriptions.push(sidebarProvider);
    // 注册侧栏视图
    const sidebarView = vscode.window.registerWebviewViewProvider('windsurfPool.sidebar', sidebarProvider);
    context.subscriptions.push(sidebarView);
    // 注册命令
    const openSidebarCmd = vscode.commands.registerCommand('windsurfPool.openSidebar', () => {
        vscode.commands.executeCommand('workbench.view.extension.windsurfPool');
    });
    context.subscriptions.push(openSidebarCmd);
    const applyPatchCmd = vscode.commands.registerCommand('windsurfPool.applyPatch', async () => {
        await (0, sessionInjector_1.applyPatch)(context);
    });
    context.subscriptions.push(applyPatchCmd);
    const showLogCmd = vscode.commands.registerCommand('windsurfPool.showLog', () => {
        sidebarProvider.showLog();
    });
    context.subscriptions.push(showLogCmd);
    const openLogFileCmd = vscode.commands.registerCommand('windsurfPool.openLogFile', () => {
        sidebarProvider.openLogFile();
    });
    context.subscriptions.push(openLogFileCmd);
    const openLogPanelCmd = vscode.commands.registerCommand('windsurfPool.openLogPanel', (tab) => {
        // 确保 bridge info 已广播，否则 syncLogs 命令无法送达 windsurf-better.js
        try {
            sidebarProvider?.refreshBridgeInfo?.();
        }
        catch { }
        (0, logPanelProvider_1.openLogPanel)(context, usageTracker, context.extensionUri, tab, autoSwitcher);
    });
    context.subscriptions.push(openLogPanelCmd);
    const openHealthCheckCmd = vscode.commands.registerCommand('windsurfPool.openHealthCheck', () => {
        (0, healthCheckPanel_1.openHealthCheckPanel)(context, context.extensionUri, usageTracker);
    });
    context.subscriptions.push(openHealthCheckCmd);
    const recoverCascadeInputCmd = vscode.commands.registerCommand('windsurfPool.recoverCascadeInput', async () => {
        const ok = await (0, acpRecovery_1.reloadWindsurfAcpConnections)('manual-command');
        if (ok) {
            vscode.window.showInformationMessage('已刷新 Cascade 连接');
        }
        else {
            vscode.window.showWarningMessage('刷新 Cascade 连接失败，请查看 Windsurf 日志');
        }
    });
    context.subscriptions.push(recoverCascadeInputCmd);
    const refreshSidebarCmd = vscode.commands.registerCommand('windsurfPool.refreshSidebar', () => {
        sidebarProvider.refresh();
    });
    context.subscriptions.push(refreshSidebarCmd);
    const addAccountCmd = vscode.commands.registerCommand('windsurfPool.addAccount', () => {
        vscode.commands.executeCommand('workbench.view.extension.windsurfPool');
    });
    context.subscriptions.push(addAccountCmd);
    const switchAccountCmd = vscode.commands.registerCommand('windsurfPool.switchAccount', async () => {
        const accounts = await accountStore.readAccounts(context);
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('暂无账号，请先登录');
            return;
        }
        const items = accounts.map((a) => ({
            label: a.email,
            description: a.name || a.email.split('@')[0]
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要切换的账号'
        });
        if (selected) {
            const email = selected.label;
            const account = accounts.find((a) => a.email === email);
            if (account) {
                console.log(`[switch][trigger] 手动切号(命令面板 switchAccount): → ${email}`);
                const { injectSession } = await Promise.resolve().then(() => __importStar(require('./sessionInjector')));
                const success = await injectSession(context, account);
                if (success) {
                    await accountStore.setCurrentAccount(context, email);
                    vscode.window.showInformationMessage('已切换至 ' + email);
                    sidebarProvider.refresh();
                    statusBar?.update();
                }
                else {
                    const failure = (0, sessionInjector_1.getLastInjectFailure)(email);
                    vscode.window.showErrorMessage('切换失败：' + (failure?.reason || '未知原因'));
                }
            }
        }
    });
    context.subscriptions.push(switchAccountCmd);
    const switchNextCmd = vscode.commands.registerCommand('windsurfPool.switchNextAccount', async () => {
        const accounts = await accountStore.readAccounts(context);
        if (accounts.length < 2) {
            vscode.window.showInformationMessage('账号数量不足，无法切换');
            return;
        }
        const currentEmail = context.globalState.get('lastEmail');
        const currentIndex = accounts.findIndex((a) => a.email === currentEmail);
        const nextIndex = (currentIndex + 1) % accounts.length;
        const nextAccount = accounts[nextIndex];
        // 切换到下一个账号
        console.log(`[switch][trigger] 手动切号(命令面板 switchNext): ${currentEmail} → ${nextAccount.email}`);
        const { injectSession } = await Promise.resolve().then(() => __importStar(require('./sessionInjector')));
        const success = await injectSession(context, nextAccount);
        if (success) {
            await accountStore.setCurrentAccount(context, nextAccount.email);
            vscode.window.showInformationMessage('已切换至 ' + nextAccount.email);
            sidebarProvider.refresh();
            statusBar?.update();
        }
        else {
            const failure = (0, sessionInjector_1.getLastInjectFailure)(nextAccount.email);
            vscode.window.showErrorMessage('切换失败：' + (failure?.reason || '未知原因'));
        }
    });
    context.subscriptions.push(switchNextCmd);
    // ── 快速切换面板（QuickPick 富信息）──
    const quickSwitchCmd = vscode.commands.registerCommand('windsurfPool.quickSwitch', async () => {
        const accounts = await accountStore.readAccounts(context);
        const enabled = accounts.filter((a) => !a.disabled);
        if (enabled.length === 0) {
            vscode.window.showInformationMessage('暂无可用账号，请先添加');
            return;
        }
        const curEmail = context.globalState.get('lastEmail') || '';
        const cache = autoSwitcher.getAllCached?.() || new Map();
        const stats = usageTracker?.getStats?.();
        const planRank = (n) => {
            const x = (n || '').toLowerCase();
            if (x.includes('enterprise')) return 0;
            if (x.includes('team')) return 1;
            if (x.includes('pro')) return 2;
            if (x.includes('trial')) return 3;
            if (x.includes('free')) return 4;
            return 5;
        };
        const items = enabled.map((a) => {
            const entry = cache.get?.(a.email);
            const snap = entry?.snapshot;
            const tags = Array.isArray(a.tags) ? a.tags : (a.tag ? [a.tag] : []);
            const pct = snap ? Math.min(snap.dailyRemainingPercent, snap.weeklyRemainingPercent) : -1;
            const today = stats?.accounts?.[a.email]?.switchToCount || 0;
            const planTxt = snap?.planName || '未加载';
            const tagTxt = tags.length ? ` · ${tags.join(',')}` : '';
            const detail = snap
                ? `日剩 ${Math.round(snap.dailyRemainingPercent)}% · 周剩 ${Math.round(snap.weeklyRemainingPercent)}% · 今日切 ${today} 次`
                : `_未加载额度_ · 今日切 ${today} 次`;
            const cur = a.email === curEmail ? '$(check) ' : '';
            return {
                label: `${cur}${a.email}`,
                description: `${planTxt}${tagTxt}`,
                detail,
                _email: a.email,
                _pct: pct,
                _planRank: planRank(planTxt),
                _current: a.email === curEmail,
            };
        });
        items.sort((x, y) => {
            if (x._current !== y._current) return x._current ? -1 : 1;
            if (x._planRank !== y._planRank) return x._planRank - y._planRank;
            return (y._pct || -1) - (x._pct || -1);
        });
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: '输入邮箱/标签/计划进行筛选，回车切换',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked || picked._current) return;
        const account = enabled.find((a) => a.email === picked._email);
        if (!account) return;
        const { injectSession } = await Promise.resolve().then(() => __importStar(require('./sessionInjector')));
        const success = await injectSession(context, account);
        if (success) {
            await accountStore.setCurrentAccount(context, account.email);
            vscode.window.showInformationMessage('已切换至 ' + account.email);
            sidebarProvider?.refresh?.();
            statusBar?.update?.();
        } else {
            const failure = (0, sessionInjector_1.getLastInjectFailure)(account.email);
            vscode.window.showErrorMessage('切换失败：' + (failure?.reason || '未知原因'));
        }
    });
    context.subscriptions.push(quickSwitchCmd);
    const removeAccountCmd = vscode.commands.registerCommand('windsurfPool.removeAccount', async () => {
        const accounts = await accountStore.readAccounts(context);
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('暂无账号');
            return;
        }
        const items = accounts.map((a) => ({
            label: a.email,
            description: '删除'
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要删除的账号'
        });
        if (selected) {
            const confirmed = await vscode.window.showWarningMessage(`确定删除账号 ${selected.label}?`, '删除', '取消');
            if (confirmed === '删除') {
                const deleted = await accountStore.removeAccount(context, selected.label);
                if (deleted) {
                    vscode.window.showInformationMessage('已删除账号');
                    sidebarProvider.refresh();
                }
            }
        }
    });
    context.subscriptions.push(removeAccountCmd);
    const showStatusCmd = vscode.commands.registerCommand('windsurfPool.showStatus', async () => {
        const accounts = await accountStore.readAccounts(context);
        const currentEmail = context.globalState.get('lastEmail');
        if (accounts.length === 0) {
            vscode.window.showInformationMessage('暂无账号');
            return;
        }
        const statusText = accounts
            .map((a) => `${a.email}${a.email === currentEmail ? ' [当前]' : ''}`)
            .join('\n');
        vscode.window.showInformationMessage(`账号列表 (${accounts.length}个):\n${statusText}`);
    });
    context.subscriptions.push(showStatusCmd);
    const checkUpdatesCmd = vscode.commands.registerCommand('windsurfPool.checkForUpdates', async () => {
        await (0, updater_1.checkForUpdates)(false);
    });
    context.subscriptions.push(checkUpdatesCmd);
    // [Bridge] 启动跨 origin 桥（HTTP localhost）—— 仅当增强已启用时才启动
    // 多实例隔离：每个扩展宿主进程起独立 bridge，端口/token 由 sidebar webview iframe
    // 通过 window.top.postMessage 告知同进程 workbench renderer，天然按进程隔离。
    const _enhEnabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get('enabled', false);
    if (_enhEnabled) {
        // 多实例隔离：每个扩展宿主起自己的 bridge（OS 分配端口 + 随机 token）。
        // 端口/token 不再写入 enh-settings.json，改由 sidebar webview 的 HTML 内联
        // 后通过 window.top.postMessage 告知同进程的 workbench renderer。
        (0, bridgeServer_1.startBridgeServer)().then(info => {
            console.log(`[windsurf-pool] bridge ready at 127.0.0.1:${info.port}`);
            try {
                sidebarProvider?.refreshBridgeInfo?.();
            }
            catch { }
        }).catch(err => {
            console.warn('[windsurf-pool] bridge server failed to start:', err);
        });
    }
    // [v7.8.9 升级重置] 每次版本升级都强制将 continueMode 重置为 'simple'
    // 必须在 ensureEnhancement() 之前执行，确保注入到 workbench.html 的设置已是重置后状态
    try {
        const currentVersion = context.extension?.packageJSON?.version || '0.0.0';
        const m = (0, enhSettingsStore_1.resetContinueModeOnUpgrade)(currentVersion);
        if (m.changed) {
            console.log(`[windsurf-pool] reset continueMode on upgrade ${m.lastVersion ?? '(none)'} → ${currentVersion}: ${m.from} → simple`);
        }
        else if (m.lastVersion !== currentVersion) {
            console.log(`[windsurf-pool] continueMode reset skipped (current=${m.from}) on upgrade ${m.lastVersion ?? '(none)'} → ${currentVersion}`);
        }
    }
    catch (err) {
        console.warn('[windsurf-pool] resetContinueModeOnUpgrade failed:', err);
    }
    // [Windsurf 增强] 自动注入 DOM 增强脚本到 workbench.html
    try {
        const result = (0, enhancementInjector_1.ensureEnhancement)();
        if (result.needRestart) {
            vscode.window.showInformationMessage('Windsurf 增强已更新，重启后生效。', '立即重启').then(action => {
                if (action === '立即重启') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    }
    catch (err) {
        console.error('[windsurf-pool] Enhancement injection failed:', err);
    }
    // 提交所有启动阶段的文件写操作（无需提权时零开销；需要时仅一次 UAC）
    try {
        (0, elevatedFs_1.flushElevatedBatch)();
    }
    catch (err) {
        (0, elevatedFs_1.cancelElevatedBatch)();
        if (err instanceof elevatedFs_1.ElevationError) {
            const actions = err.userDenied
                ? ['重试（需点击"是"）', '以管理员身份运行']
                : ['以管理员身份运行'];
            vscode.window.showErrorMessage(err.message, ...actions).then(action => {
                if (action === '重试（需点击"是"）') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
                else if (action === '以管理员身份运行') {
                    vscode.env.clipboard.writeText('Start-Process windsurf -Verb RunAs');
                    vscode.window.showInformationMessage('PowerShell 命令已复制到剪贴板，请在终端中粘贴运行。');
                }
            });
        }
        else {
            console.error('[windsurf-pool] Elevated batch flush failed:', err);
        }
    }
    // 统一在 flushElevatedBatch 之后执行 checksum 修复：
    // 必须在 flush 之后，因为 flush 才真正把新 workbench.html 写入磁盘，
    // 此时 computeChecksum 读到的才是最新文件内容
    try {
        autoFixChecksums();
    }
    catch (err) {
        console.error('[windsurf-pool] Checksum fix failed:', err);
    }
    // [Windsurf 增强] 恢复原始 workbench.html 命令（一并恢复 product.json）
    const restoreCmd = vscode.commands.registerCommand('windsurfPool.restoreWorkbench', async () => {
        const restored = (0, enhancementInjector_1.restoreWorkbench)();
        const productRestored = (0, checksumFixer_1.restoreProductJson)();
        // 同步关闭开关，避免下次 activate 又自动注入；并清理增强相关规则（气泡+脚本纪律）
        await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', false, vscode.ConfigurationTarget.Global);
        (0, rulesInjector_1.removeAllEnhancementRules)();
        // 通知 webview 刷新状态
        try {
            sidebarProvider?.refreshEnhancementStatus?.();
        }
        catch { }
        if (restored || productRestored) {
            const parts = [];
            if (restored)
                parts.push('workbench.html');
            if (productRestored)
                parts.push('product.json');
            const action = await vscode.window.showInformationMessage(`已恢复原始 ${parts.join(' + ')}，重启后生效。`, '立即重启');
            if (action === '立即重启') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
        else {
            vscode.window.showWarningMessage('未找到备份文件；已关闭增强开关并清理规则。');
        }
    });
    context.subscriptions.push(restoreCmd);
    // [Checksum 修复] 手动重算 product.json 校验值命令
    const fixChecksumsCmd = vscode.commands.registerCommand('windsurfPool.fixChecksums', async () => {
        // 单次调用即可完成检测+修复（fixed=0 时不写文件，相当于 dryRun）
        const result = (0, checksumFixer_1.fixChecksums)(false);
        if (result.error) {
            vscode.window.showErrorMessage('修复失败：' + result.error);
            return;
        }
        if (result.total === 0) {
            vscode.window.showWarningMessage('未找到 product.json 或 checksums 字段');
            return;
        }
        const missingNote = result.missing.length > 0
            ? `（⚠️ ${result.missing.length} 个文件未找到，已跳过）`
            : '';
        if (result.missing.length > 0) {
            console.warn('[windsurf-pool] checksum missing files:', result.missing);
        }
        if (result.fixed === 0) {
            vscode.window.showInformationMessage(`product.json 校验值已是最新（${result.unchanged}/${result.total} 项匹配）${missingNote}`);
            return;
        }
        const action = await vscode.window.showInformationMessage(`已修复 ${result.fixed}/${result.total} 项校验值，重启后"已损坏"提示将不再出现。${missingNote}`, '立即重启');
        if (action === '立即重启') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    });
    context.subscriptions.push(fixChecksumsCmd);
    // [Windsurf 增强] 自动注入回复建议提示规则
    try {
        (0, rulesInjector_1.ensureBubbleRules)();
    }
    catch (err) {
        console.error('[windsurf-pool] Bubble rules injection failed:', err);
    }
    // [Windsurf 增强] 手动注入/移除回复建议规则命令
    const injectRulesCmd = vscode.commands.registerCommand('windsurfPool.injectBubbleRules', () => {
        const result = (0, rulesInjector_1.injectBubbleRules)();
        try {
            sidebarProvider?.refreshEnhancementStatus?.();
        }
        catch { }
        if (result.injected) {
            vscode.window.showInformationMessage('智能建议规则已注入到 ~/.windsurfrules');
        }
        else {
            vscode.window.showInformationMessage(result.error || '规则已存在，无需重复注入');
        }
    });
    context.subscriptions.push(injectRulesCmd);
    const removeRulesCmd = vscode.commands.registerCommand('windsurfPool.removeBubbleRules', () => {
        const removed = (0, rulesInjector_1.removeBubbleRules)();
        try {
            sidebarProvider?.refreshEnhancementStatus?.();
        }
        catch { }
        if (removed) {
            vscode.window.showInformationMessage('已从 ~/.windsurfrules 移除智能建议规则');
        }
        else {
            vscode.window.showInformationMessage('未找到已注入的规则');
        }
    });
    context.subscriptions.push(removeRulesCmd);
    // [Windsurf 增强] 手动注入/移除脚本纪律规则命令
    const injectScriptCmd = vscode.commands.registerCommand('windsurfPool.injectScriptDisciplineRules', () => {
        const result = (0, rulesInjector_1.injectScriptDisciplineRules)();
        try {
            sidebarProvider?.refreshEnhancementStatus?.();
        }
        catch { }
        if (result.injected) {
            vscode.window.showInformationMessage('脚本纪律规则已注入到 ~/.windsurfrules');
        }
        else {
            vscode.window.showInformationMessage(result.error || '规则已存在，无需重复注入');
        }
    });
    context.subscriptions.push(injectScriptCmd);
    const removeScriptCmd = vscode.commands.registerCommand('windsurfPool.removeScriptDisciplineRules', () => {
        const removed = (0, rulesInjector_1.removeScriptDisciplineRules)();
        try {
            sidebarProvider?.refreshEnhancementStatus?.();
        }
        catch { }
        if (removed) {
            vscode.window.showInformationMessage('已从 ~/.windsurfrules 移除脚本纪律规则');
        }
        else {
            vscode.window.showInformationMessage('未找到已注入的脚本纪律规则');
        }
    });
    context.subscriptions.push(removeScriptCmd);
    // [Windsurf 增强] 重新注入命令
    const reinjectCmd = vscode.commands.registerCommand('windsurfPool.reinjectEnhancement', async () => {
        // 增强开关被用户关闭时，ensureEnhancement 会直接 return 且无 error，友好提示而非报"未知错误"
        const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get('enabled', false);
        if (!enabled) {
            const action = await vscode.window.showWarningMessage('Windsurf 增强已关闭，无法注入。是否立即启用？', '立即启用', '取消');
            if (action === '立即启用') {
                await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', true, vscode.ConfigurationTarget.Global);
            }
            else {
                return;
            }
        }
        try {
            const result = (0, enhancementInjector_1.ensureEnhancement)();
            try {
                sidebarProvider?.refreshEnhancementStatus?.();
            }
            catch { }
            if (result.injected && result.needRestart) {
                vscode.window.showInformationMessage('增强脚本已注入，重启后生效。', '立即重启').then(action => {
                    if (action === '立即重启') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                });
            }
            else if (result.injected) {
                vscode.window.showInformationMessage('增强脚本已是最新版本。');
            }
            else {
                vscode.window.showWarningMessage('注入失败：' + (result.error || '未知错误'));
            }
        }
        catch (err) {
            vscode.window.showErrorMessage('注入异常：' + String(err));
        }
    });
    context.subscriptions.push(reinjectCmd);
}
/**
 * 多实例启动时自动切号：如果当前 user-data-dir 存在 .windsurf-pool-bind 标记，自动注入对应账号
 */
async function autoSwitchByBindMark(context) {
    try {
        const currentDir = (0, instanceManager_1.getCurrentUserDataDir)();
        const bindEmail = (0, instanceManager_1.readBindMark)(currentDir);
        // bind mark 优先；'__auto__' 表示自动模式，回退 lastEmail（重启后恢复号池 session）
        const targetEmail = (bindEmail && bindEmail !== '__auto__')
            ? bindEmail
            : (context.globalState.get('lastEmail') || '');
        console.log(`[autoSwitch][trigger] autoSwitchByBindMark: currentDir=${currentDir}, bindEmail=${bindEmail || 'none'}, targetEmail=${targetEmail || 'none'}`);
        if (!targetEmail) {
            return;
        }
        // 轮询等待账号存储就绪（最多 5 秒）
        const maxRetries = 10;
        const retryInterval = 500;
        let account = null;
        for (let i = 0; i < maxRetries; i++) {
            const accounts = await accountStore.readAccounts(context);
            account = accounts.find(a => a.email === targetEmail);
            if (account)
                break;
            await new Promise(r => setTimeout(r, retryInterval));
        }
        if (!account) {
            console.log(`[autoSwitch][trigger] autoSwitchByBindMark: 未找到账号 ${targetEmail}，跳过`);
            return;
        }
        console.log(`[autoSwitch][trigger] autoSwitchByBindMark: 执行切号 → ${targetEmail}`);
        const { injectSession } = await Promise.resolve().then(() => __importStar(require('./sessionInjector')));
        const success = await injectSession(context, account, { silent: true, auto: true });
        if (success) {
            console.log(`[autoSwitch][trigger] autoSwitchByBindMark: 切号成功 → ${targetEmail}`);
            await accountStore.setCurrentAccount(context, targetEmail);
        }
        else {
            console.warn(`[autoSwitch][trigger] autoSwitchByBindMark: 切号失败 → ${targetEmail}`);
        }
    }
    catch (err) {
        console.error(`[autoSwitch][trigger] autoSwitchByBindMark 异常:`, err);
    }
}
/**
 * 检测 Windsurf 安装目录是否可写（macOS/Linux 系统级安装常见问题）
 * 不可写时弹一次提示，记住用户选择
 */
function checkInstallPermission(context) {
    // Windows: 提权已由 elevatedFs 自动处理（UAC 弹窗），无需手动提示
    if (utils_1.isWindows)
        return;
    // 已提示过则跳过
    const DISMISS_KEY = 'windsurfPool.permissionWarningDismissed';
    if (context.globalState.get(DISMISS_KEY))
        return;
    const appRoot = vscode.env.appRoot;
    // 关键文件：会话补丁需要写 extension.js，增强需要写 workbench.html
    const targets = [
        path.join(appRoot, 'extensions', 'windsurf', 'dist', 'extension.js'),
        path.join(appRoot, 'extensions', 'windsurf', 'out', 'extension.js'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'product.json'),
    ];
    // 任意一个存在且不可写即触发提示
    const blocked = targets.find(p => fs.existsSync(p) && !(0, utils_1.isWritable)(p));
    if (!blocked)
        return;
    // 推断安装根目录（用于生成 chmod 命令）
    const installDir = utils_1.isMac
        ? appRoot.replace(/\/Contents\/Resources\/app$/, '') // .app bundle
        : appRoot.replace(/\/resources\/app$/, ''); // Linux 安装目录
    const chmodCmd = `sudo chmod -R a+w "${installDir}"`;
    vscode.window.showWarningMessage(`检测到 Windsurf 安装目录无写权限，无法应用切号补丁和增强注入。\n请在终端执行：\n${chmodCmd}\n执行后重启 Windsurf 即可。`, '复制命令', '已了解，不再提示').then(action => {
        if (action === '复制命令') {
            vscode.env.clipboard.writeText(chmodCmd);
            vscode.window.showInformationMessage('命令已复制到剪贴板');
        }
        else if (action === '已了解，不再提示') {
            context.globalState.update(DISMISS_KEY, true);
        }
    });
}
/**
 * 自动修复 product.json 中的 checksums（按配置开关控制，静默执行）
 * 在补丁/增强应用后或启动时调用，从根本消除"installation appears corrupt"提示
 */
function autoFixChecksums() {
    const enabled = vscode.workspace
        .getConfiguration('windsurfPool.enhancement')
        .get('fixChecksums', true);
    if (!enabled)
        return;
    try {
        const r = (0, checksumFixer_1.fixChecksums)(false);
        if (r.error) {
            console.warn('[windsurf-pool] checksum fix:', r.error);
        }
        else if (r.fixed > 0) {
            console.log(`[windsurf-pool] product.json checksums 已修复 ${r.fixed}/${r.total} 项`);
        }
    }
    catch (err) {
        console.warn('[windsurf-pool] checksum fix exception:', err);
    }
}
/**
 * 首次安装欢迎引导：仅出现一次，引导启用增强 / 添加账号 / 打开侧栏
 */
async function maybeShowWelcome(context) {
    const KEY = 'windsurfPool.welcomeShown.v1';
    if (context.globalState.get(KEY)) return;
    // 延迟 1.5s 让侧栏/状态栏先渲染，避免一打开就盖住主界面
    await new Promise((r) => setTimeout(r, 1500));
    const sel = await vscode.window.showInformationMessage(
        '👋 欢迎使用 Windsurf 号池管理！\n建议先完成 3 步：① 启用增强（汉化+无感切号）  ② 添加账号  ③ 设置自动切号',
        { modal: false },
        '启用增强',
        '添加账号',
        '打开侧栏',
        '不再提示',
    );
    try {
        if (sel === '启用增强') {
            await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', true, vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('windsurfPool.reinjectEnhancement');
            vscode.window.showInformationMessage('增强已启用，下次重启 Windsurf 后生效');
        } else if (sel === '添加账号') {
            await vscode.commands.executeCommand('windsurfPool.addAccount');
        } else if (sel === '打开侧栏') {
            await vscode.commands.executeCommand('windsurfPool.openSidebar');
        }
    } catch (e) {
        logger.get('welcome').warn('action failed', e);
    } finally {
        if (sel) context.globalState.update(KEY, true);
    }
}

async function deactivate() {
    try {
        (0, accountLock_1.stopHeartbeat)();
    }
    catch { }
    try {
        (0, accountLock_1.releaseLock)();
    }
    catch { }
    try {
        (0, bridgeServer_1.stopBridgeServer)();
    }
    catch { }
    try {
        const { shutdownSoundPlayer } = require('./soundPlayer');
        shutdownSoundPlayer();
    }
    catch { }
    // 显式等待 usageTracker 写盘完成（VS Code 不会等 context.subscriptions 的 dispose Promise，
    // 必须在 deactivate 里 await，VS Code 才会等扩展卸载完成）
    try {
        await usageTracker?.dispose();
    }
    catch { }
}
//# sourceMappingURL=extension.js.map