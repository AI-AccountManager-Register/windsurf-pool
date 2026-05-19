"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageTracker = void 0;
const STORAGE_KEY = 'usageTracker.stats';
const HISTORY_KEY = 'usageTracker.quotaHistory';
const DIAGNOSTIC_KEY = 'usageTracker.diagnosticHistory';
const MAX_HISTORY = 500;
const MAX_DIAGNOSTIC_HISTORY = 1000;
class UsageTracker {
    constructor(ctx) {
        this._dirty = false;
        this._saveTimer = null;
        this._quotaHistory = [];
        this._lastQuotaMap = new Map();
        this._historyDirty = false;
        this._historySaveTimer = null;
        this._historyListeners = new Set();
        this._diagnosticHistory = [];
        this._diagnosticDirty = false;
        this._diagnosticSaveTimer = null;
        // 记录正在进行的最后一次 flush，dispose 可能被调多次（subscriptions + deactivate），
        // 保留 promise 让所有调用方都能等到真正落盘完成
        this._disposePromise = null;
        this._ctx = ctx;
        this._stats = this._load();
        this._maybeResetDaily();
        this._quotaHistory = this._ctx.globalState.get(HISTORY_KEY, []);
        this._diagnosticHistory = this._ctx.globalState.get(DIAGNOSTIC_KEY, []);
        // 初始化 _lastQuotaMap（从历史末尾恢复每个账号的最后已知配额）
        for (let i = this._quotaHistory.length - 1; i >= 0; i--) {
            const e = this._quotaHistory[i];
            if (!this._lastQuotaMap.has(e.email)) {
                this._lastQuotaMap.set(e.email, { daily: e.daily, weekly: e.weekly });
            }
        }
    }
    set onHistoryUpdate(cb) {
        // 兼容旧 API：侧栏用 setter
        if (this._legacyHistoryCb)
            this._historyListeners.delete(this._legacyHistoryCb);
        this._legacyHistoryCb = cb;
        if (cb)
            this._historyListeners.add(cb);
    }
    addHistoryListener(cb) {
        this._historyListeners.add(cb);
        return { dispose: () => { this._historyListeners.delete(cb); } };
    }
    _load() {
        const saved = this._ctx.globalState.get(STORAGE_KEY);
        if (saved && saved.lastResetDate)
            return saved;
        return this._empty();
    }
    _empty() {
        return {
            totalSwitches: 0,
            totalPoolSignals: 0,
            totalRefreshes: 0,
            sessionStartTs: Date.now(),
            lastResetDate: todayStr(),
            accounts: {},
        };
    }
    _debounceSave() {
        this._dirty = true;
        if (this._saveTimer)
            return;
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            if (this._dirty) {
                this._dirty = false;
                this._ctx.globalState.update(STORAGE_KEY, this._stats);
            }
        }, 2000);
    }
    _maybeResetDaily() {
        const today = todayStr();
        if (this._stats.lastResetDate !== today) {
            // 保留 sessionStartTs，重置计数
            this._stats.totalSwitches = 0;
            this._stats.totalPoolSignals = 0;
            this._stats.totalRefreshes = 0;
            this._stats.accounts = {};
            this._stats.lastResetDate = today;
            // 同步清空快照映射，避免跨日 dDelta 基于昨天数据计算出错误的"重置"标记
            this._lastQuotaMap.clear();
            this._debounceSave();
        }
    }
    // ── 记录事件 ──
    recordSwitch(email) {
        this._maybeResetDaily();
        this._stats.totalSwitches++;
        this._ensureAccount(email).switchToCount++;
        this._debounceSave();
    }
    recordPoolSignal() {
        this._maybeResetDaily();
        this._stats.totalPoolSignals++;
        this._debounceSave();
    }
    recordRefresh() {
        this._maybeResetDaily();
        this._stats.totalRefreshes++;
        this._debounceSave();
    }
    recordUsage(email, dailyRemaining, weeklyRemaining, dailyResetAt, weeklyResetAt) {
        this._maybeResetDaily();
        const acct = this._ensureAccount(email);
        acct.dailyUsedPct = Math.max(0, 100 - dailyRemaining);
        acct.weeklyUsedPct = Math.max(0, 100 - weeklyRemaining);
        acct.lastCheckTs = Date.now();
        // 配额变动历史：仅在数值变化时记录（避免轮询产生大量重复条目）
        const daily = Math.round(dailyRemaining);
        const weekly = Math.round(weeklyRemaining);
        const last = this._lastQuotaMap.get(email);
        if (!last || last.daily !== daily || last.weekly !== weekly) {
            const dDelta = last ? daily - last.daily : 0;
            const wDelta = last ? weekly - last.weekly : 0;
            const resetAt = Math.min(dailyResetAt || Infinity, weeklyResetAt || Infinity);
            this._quotaHistory.push({
                ts: Date.now(),
                email,
                daily,
                weekly,
                dDelta,
                wDelta,
                resetAt: resetAt === Infinity ? 0 : resetAt,
            });
            if (this._quotaHistory.length > MAX_HISTORY) {
                this._quotaHistory.splice(0, this._quotaHistory.length - MAX_HISTORY);
            }
            this._lastQuotaMap.set(email, { daily, weekly });
            this._debounceHistorySave();
            for (const cb of this._historyListeners) {
                try {
                    cb();
                }
                catch { }
            }
        }
        this._debounceSave();
    }
    // ── 读取 ──
    getStats() {
        this._maybeResetDaily();
        return JSON.parse(JSON.stringify(this._stats));
    }
    /** 获取适合推送到 webview 的摘要 */
    getSummary() {
        this._maybeResetDaily();
        const s = this._stats;
        let totalDailyUsed = 0;
        let totalWeeklyUsed = 0;
        let accountCount = 0;
        for (const acct of Object.values(s.accounts)) {
            if (acct.lastCheckTs > 0) {
                totalDailyUsed += acct.dailyUsedPct;
                totalWeeklyUsed += acct.weeklyUsedPct;
                accountCount++;
            }
        }
        return {
            totalSwitches: s.totalSwitches,
            totalPoolSignals: s.totalPoolSignals,
            totalRefreshes: s.totalRefreshes,
            avgDailyUsedPct: accountCount > 0 ? Math.round(totalDailyUsed / accountCount) : 0,
            avgWeeklyUsedPct: accountCount > 0 ? Math.round(totalWeeklyUsed / accountCount) : 0,
            totalDailyUsed: Math.round(totalDailyUsed),
            totalWeeklyUsed: Math.round(totalWeeklyUsed),
            accountCount,
            sessionStartTs: s.sessionStartTs,
            date: s.lastResetDate,
            perAccount: s.accounts,
        };
    }
    // ── 配额历史 ──
    getQuotaHistory(email, limit = 100) {
        let result = this._quotaHistory;
        if (email) {
            result = result.filter(e => e.email === email);
        }
        return result.slice(-limit);
    }
    /** 清除配额历史（不传 email 则清除全部） */
    clearQuotaHistory(email) {
        if (email) {
            this._quotaHistory = this._quotaHistory.filter(e => e.email !== email);
            this._lastQuotaMap.delete(email);
        }
        else {
            this._quotaHistory = [];
            this._lastQuotaMap.clear();
        }
        this._ctx.globalState.update(HISTORY_KEY, this._quotaHistory);
        for (const cb of this._historyListeners) {
            try {
                cb();
            }
            catch { }
        }
    }
    /** 获取历史中涉及的所有账号（去重） */
    getHistoryEmails() {
        const set = new Set();
        for (const e of this._quotaHistory)
            set.add(e.email);
        return Array.from(set);
    }
    // ── 账号诊断历史 ──
    recordDiagnostic(event) {
        if (!event.email)
            return;
        this._diagnosticHistory.push({
            ts: event.ts || Date.now(),
            email: event.email,
            source: event.source,
            level: event.level,
            reason: event.reason || '无详情',
            model: event.model,
            status: event.status,
        });
        if (this._diagnosticHistory.length > MAX_DIAGNOSTIC_HISTORY) {
            this._diagnosticHistory.splice(0, this._diagnosticHistory.length - MAX_DIAGNOSTIC_HISTORY);
        }
        this._debounceDiagnosticSave();
        for (const cb of this._historyListeners) {
            try {
                cb();
            }
            catch { }
        }
    }
    getDiagnosticHistory(email, limit = 300) {
        let result = this._diagnosticHistory;
        if (email) {
            result = result.filter(e => e.email === email);
        }
        return result.slice(-limit);
    }
    getLatestDiagnosticsByAccount() {
        const latest = {};
        for (const e of this._diagnosticHistory) {
            const bucket = latest[e.email] || (latest[e.email] = {});
            if (e.source === 'health')
                bucket.health = e;
            if (e.source === 'switch')
                bucket.switch = e;
        }
        return latest;
    }
    _debounceDiagnosticSave() {
        this._diagnosticDirty = true;
        if (this._diagnosticSaveTimer)
            return;
        this._diagnosticSaveTimer = setTimeout(() => {
            this._diagnosticSaveTimer = null;
            if (this._diagnosticDirty) {
                this._diagnosticDirty = false;
                this._ctx.globalState.update(DIAGNOSTIC_KEY, this._diagnosticHistory);
            }
        }, 3000);
    }
    _debounceHistorySave() {
        this._historyDirty = true;
        if (this._historySaveTimer)
            return;
        this._historySaveTimer = setTimeout(() => {
            this._historySaveTimer = null;
            if (this._historyDirty) {
                this._historyDirty = false;
                this._ctx.globalState.update(HISTORY_KEY, this._quotaHistory);
            }
        }, 3000);
    }
    // ── 内部 ──
    _ensureAccount(email) {
        if (!this._stats.accounts[email]) {
            this._stats.accounts[email] = {
                switchToCount: 0,
                dailyUsedPct: 0,
                weeklyUsedPct: 0,
                lastCheckTs: 0,
            };
        }
        return this._stats.accounts[email];
    }
    dispose() {
        if (this._disposePromise)
            return this._disposePromise;
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (this._historySaveTimer) {
            clearTimeout(this._historySaveTimer);
            this._historySaveTimer = null;
        }
        if (this._diagnosticSaveTimer) {
            clearTimeout(this._diagnosticSaveTimer);
            this._diagnosticSaveTimer = null;
        }
        const tasks = [];
        if (this._dirty) {
            this._dirty = false;
            tasks.push(this._ctx.globalState.update(STORAGE_KEY, this._stats));
        }
        if (this._historyDirty) {
            this._historyDirty = false;
            tasks.push(this._ctx.globalState.update(HISTORY_KEY, this._quotaHistory));
        }
        if (this._diagnosticDirty) {
            this._diagnosticDirty = false;
            tasks.push(this._ctx.globalState.update(DIAGNOSTIC_KEY, this._diagnosticHistory));
        }
        if (tasks.length === 0) {
            this._disposePromise = Promise.resolve();
        }
        else {
            this._disposePromise = Promise.all(tasks)
                .then(() => undefined)
                .catch(err => { console.warn('[usageTracker] dispose flush error:', err); });
        }
        return this._disposePromise;
    }
}
exports.UsageTracker = UsageTracker;
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
//# sourceMappingURL=usageTracker.js.map