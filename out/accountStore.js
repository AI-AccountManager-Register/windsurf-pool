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
exports.watchAccountsFile = watchAccountsFile;
exports.readAccountsSync = readAccountsSync;
exports.readAccounts = readAccounts;
exports.saveAccounts = saveAccounts;
exports.upsertAccount = upsertAccount;
exports.removeAccount = removeAccount;
exports.batchRemove = batchRemove;
exports.updateTag = updateTag;
exports.updateTags = updateTags;
exports.toggleDisabled = toggleDisabled;
exports.batchSetDisabled = batchSetDisabled;
exports.batchUpdateTag = batchUpdateTag;
exports.batchUpdateTags = batchUpdateTags;
exports.getCurrentAccount = getCurrentAccount;
exports.setCurrentAccount = setCurrentAccount;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
const config_1 = require("./config");
const ACCOUNTS_KEY = 'windsurfPool.accounts.v1';
const ACCOUNTS_FILE = 'accounts.json';
function getAccountsFilePath() {
    return path.join((0, utils_1.getPoolRoot)(), ACCOUNTS_FILE);
}
let _accountsCache = null;
let _accountsCacheTs = 0;
function readAccountsFromFile(forceFresh = false) {
    const now = Date.now();
    if (!forceFresh && _accountsCache && now - _accountsCacheTs < config_1.CACHE_TTL.ACCOUNTS) {
        return _accountsCache;
    }
    const p = getAccountsFilePath();
    if (!fs.existsSync(p))
        return [];
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const arr = JSON.parse(raw);
        _accountsCache = Array.isArray(arr) ? arr.filter(isValidAccount).map(normalizeAccountTags) : [];
        _accountsCacheTs = now;
        return _accountsCache;
    }
    catch {
        return [];
    }
}
function invalidateAccountsCache() {
    _accountsCache = null;
}
function saveAccountsToFile(accounts) {
    (0, utils_1.ensureDir)((0, utils_1.getPoolRoot)());
    const p = getAccountsFilePath();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf8');
    fs.renameSync(tmp, p);
    _accountsCache = accounts;
    _accountsCacheTs = Date.now();
}
// ─── 写入队列（串行化 read-modify-write，避免并发丢数据） ────
// 关键设计：前一次失败不应阻塞后续任务（_writeQueue 必须始终 resolve）。
// 调用方的 result/error 通过返回的 Promise 单独透传，不污染队列。
let _writeQueue = Promise.resolve();
function enqueueWrite(task) {
    // 任务在队列就绪后执行（无论前一个成功或失败都执行）
    const ready = _writeQueue.then(() => { }, () => { });
    const next = ready.then(task);
    // 队列只跟踪"已完成"状态，吞掉错误避免阻塞下一个任务
    _writeQueue = next.then(() => { }, () => { });
    return next;
}
// ─── 文件监听（多实例同步）──────────────────────────────
let fileWatcher = null;
const changeListeners = new Set();
function startWatcher() {
    if (fileWatcher)
        return;
    try {
        (0, utils_1.ensureDir)((0, utils_1.getPoolRoot)());
        fileWatcher = fs.watch((0, utils_1.getPoolRoot)(), (_evt, filename) => {
            // Windows 上 rename 事件的 filename 可能为 null，此时也视为变化
            if (!filename || filename === ACCOUNTS_FILE) {
                invalidateAccountsCache();
                for (const fn of changeListeners) {
                    try {
                        fn();
                    }
                    catch { /* ignore */ }
                }
            }
        });
        fileWatcher.on('error', (err) => {
            console.warn('[accountStore] watcher 出错，将重试:', err);
            try {
                fileWatcher?.close();
            }
            catch { /* ignore */ }
            fileWatcher = null;
            // 1 秒后重连
            setTimeout(() => { if (changeListeners.size > 0)
                startWatcher(); }, 1000);
        });
    }
    catch (e) {
        console.warn('[accountStore] watch 失败:', e);
    }
}
function watchAccountsFile(onChange) {
    changeListeners.add(onChange);
    startWatcher();
    return () => {
        changeListeners.delete(onChange);
        if (changeListeners.size === 0 && fileWatcher) {
            try {
                fileWatcher.close();
            }
            catch { /* ignore */ }
            fileWatcher = null;
        }
    };
}
/**
 * 验证账号数据是否有效
 */
function isValidAccount(account) {
    return (typeof account === 'object' &&
        account !== null &&
        typeof account.email === 'string' &&
        typeof account.apiKey === 'string' &&
        typeof account.apiServerUrl === 'string');
}
/**
 * 归一化：将旧 tag 字段迁移到 tags 数组，保持双字段同步
 */
function normalizeAccountTags(a) {
    if (!a.tags && a.tag) {
        a.tags = [a.tag];
    }
    if (a.tags && a.tags.length > 0) {
        a.tag = a.tags[0];
    }
    else if (!a.tag) {
        delete a.tags;
        delete a.tag;
    }
    return a;
}
/**
 * 同步读取账号列表（仅从文件缓存，用于不能 await 的场景）
 */
function readAccountsSync(_context) {
    return readAccountsFromFile();
}
/**
 * 读取账号列表（从共享文件）
 */
async function readAccounts(context) {
    // 优先从共享文件读取
    const fileAccounts = readAccountsFromFile();
    if (fileAccounts.length > 0)
        return fileAccounts;
    // 回退：从 secrets 读取（首次迁移）
    const raw = await context.secrets.get(ACCOUNTS_KEY);
    if (!raw)
        return [];
    try {
        const arr = JSON.parse(raw);
        const accounts = Array.isArray(arr) ? arr.filter(isValidAccount) : [];
        // 迁移到共享文件
        if (accounts.length > 0) {
            saveAccountsToFile(accounts);
        }
        return accounts;
    }
    catch {
        return [];
    }
}
/**
 * 保存账号列表（到共享文件）
 */
async function saveAccounts(context, accounts) {
    saveAccountsToFile(accounts);
    // 同时备份到 secrets（兼容旧版本）
    await context.secrets.store(ACCOUNTS_KEY, JSON.stringify(accounts));
}
/**
 * 新增或更新账号
 */
async function upsertAccount(context, account) {
    return enqueueWrite(async () => {
        invalidateAccountsCache(); // 强制重读，避免用过期缓存
        const accounts = await readAccounts(context);
        const idx = accounts.findIndex(a => a.email === account.email);
        if (idx >= 0) {
            accounts[idx] = account;
        }
        else {
            accounts.push(account);
        }
        await saveAccounts(context, accounts);
    });
}
/**
 * 删除账号
 */
async function removeAccount(context, email) {
    return enqueueWrite(async () => {
        invalidateAccountsCache();
        const accounts = await readAccounts(context);
        const filtered = accounts.filter(a => a.email !== email);
        if (filtered.length === accounts.length)
            return false;
        await saveAccounts(context, filtered);
        return true;
    });
}
/**
 * 批量删除账号
 */
async function batchRemove(context, emails) {
    return enqueueWrite(async () => {
        invalidateAccountsCache();
        const accounts = await readAccounts(context);
        const emailSet = new Set(emails);
        const filtered = accounts.filter(a => !emailSet.has(a.email));
        const removed = accounts.length - filtered.length;
        if (removed > 0) {
            await saveAccounts(context, filtered);
        }
        return removed;
    });
}
/**
 * 更新账号标签（单标签，向后兼容）
 */
async function updateTag(context, email, tag) {
    const tags = tag ? [tag] : [];
    return updateTags(context, email, tags);
}
/**
 * 更新账号标签（多标签）
 */
async function updateTags(context, email, tags) {
    return enqueueWrite(async () => {
        invalidateAccountsCache();
        const accounts = await readAccounts(context);
        const acct = accounts.find(a => a.email === email);
        if (acct) {
            acct.tags = tags.length > 0 ? tags : undefined;
            acct.tag = tags[0] || undefined;
            await saveAccounts(context, accounts);
        }
    });
}
/**
 * 切换账号启用/禁用状态
 */
async function toggleDisabled(context, email) {
    return enqueueWrite(async () => {
        invalidateAccountsCache();
        const accounts = await readAccounts(context);
        const acct = accounts.find(a => a.email === email);
        if (acct) {
            acct.disabled = !acct.disabled;
            if (!acct.disabled)
                delete acct.disabled;
            await saveAccounts(context, accounts);
        }
    });
}
/**
 * 批量设置启用/禁用
 */
async function batchSetDisabled(context, emails, disabled) {
    return enqueueWrite(async () => {
        invalidateAccountsCache();
        const accounts = await readAccounts(context);
        let count = 0;
        const emailSet = new Set(emails);
        for (const acct of accounts) {
            if (emailSet.has(acct.email)) {
                if (disabled) {
                    acct.disabled = true;
                }
                else {
                    delete acct.disabled;
                }
                count++;
            }
        }
        if (count > 0)
            await saveAccounts(context, accounts);
        return count;
    });
}
/**
 * 批量更新标签（单标签，向后兼容）
 */
async function batchUpdateTag(context, emails, tag) {
    const tags = tag ? [tag] : [];
    return batchUpdateTags(context, emails, tags);
}
/**
 * 批量更新标签（多标签）
 */
async function batchUpdateTags(context, emails, tags) {
    return enqueueWrite(async () => {
        invalidateAccountsCache();
        const accounts = await readAccounts(context);
        let count = 0;
        const emailSet = new Set(emails);
        for (const acct of accounts) {
            if (emailSet.has(acct.email)) {
                acct.tags = tags.length > 0 ? tags : undefined;
                acct.tag = tags[0] || undefined;
                count++;
            }
        }
        if (count > 0)
            await saveAccounts(context, accounts);
        return count;
    });
}
/**
 * 获取当前活跃账号
 */
async function getCurrentAccount(context) {
    const lastEmail = context.globalState.get('lastEmail');
    if (!lastEmail)
        return null;
    const accounts = await readAccounts(context);
    return accounts.find(a => a.email === lastEmail) || null;
}
/**
 * 设置当前活跃账号
 */
async function setCurrentAccount(context, email) {
    await context.globalState.update('lastEmail', email);
}
//# sourceMappingURL=accountStore.js.map