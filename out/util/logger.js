"use strict";
/**
 * 统一日志工具
 *
 * 设计：
 *  - 默认写入 OutputChannel（与 logPanelProvider 共享或独立 channel）
 *  - 同时镜像到 console，方便开发期 F1→Toggle Developer Tools 查看
 *  - 提供分级 API：debug/info/warn/error
 *  - 调用方式：const L = require('./util/logger').get('autoSwitcher'); L.error('xxx', err);
 *
 * 之所以把 logger 独立，是为了清理项目内大量 `catch {}` 黑洞——
 * 让所有静默吞错改写成 `catch (e) { L.warn('xxx', e); }`，可在统计面板里集中排查。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = get;
exports.setOutputChannel = setOutputChannel;
exports.flush = flush;

const LEVELS = ['debug', 'info', 'warn', 'error'];

let _channel = null;        // 共享 OutputChannel（在 extension.activate 时设置）
let _buffer = [];           // _channel 未就绪前的缓存
const _scopeCache = new Map();

function setOutputChannel(channel) {
    _channel = channel;
    if (channel && _buffer.length) {
        for (const line of _buffer) {
            try { channel.appendLine(line); } catch { /* ignore */ }
        }
        _buffer = [];
    }
}

function formatLine(scope, level, args) {
    const ts = new Date().toISOString().slice(11, 23);
    const parts = [`[${ts}] [${level.toUpperCase()}]`, scope ? `[${scope}]` : ''];
    for (const a of args) {
        if (a instanceof Error) {
            parts.push(a.stack || (a.name + ': ' + a.message));
        } else if (typeof a === 'object' && a) {
            try { parts.push(JSON.stringify(a)); }
            catch { parts.push(String(a)); }
        } else {
            parts.push(String(a));
        }
    }
    return parts.filter(Boolean).join(' ');
}

function write(scope, level, args) {
    const line = formatLine(scope, level, args);
    if (_channel) {
        try { _channel.appendLine(line); } catch { /* ignore */ }
    } else {
        // 缓存最多 200 行，避免长时间不 attach OutputChannel 时膨胀
        if (_buffer.length < 200) _buffer.push(line);
    }
    // 同步 mirror 到 console，便于开发模式
    const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    try { console[fn]('[windsurf-pool]', line); } catch { /* ignore */ }
}

function get(scope) {
    const cached = _scopeCache.get(scope || '');
    if (cached) return cached;
    const api = {};
    for (const lvl of LEVELS) {
        api[lvl] = (...args) => write(scope || '', lvl, args);
    }
    /** 包装一个 try/catch 黑洞：fn 抛错时按 level 记录，不阻断流程 */
    api.swallow = (label, fn, level = 'warn') => {
        try {
            const r = fn();
            if (r && typeof r.catch === 'function') {
                return r.catch((e) => write(scope || '', level, [label, e]));
            }
            return r;
        } catch (e) {
            write(scope || '', level, [label, e]);
            return undefined;
        }
    };
    _scopeCache.set(scope || '', api);
    return api;
}

function flush() {
    if (!_channel) return;
    try { _channel.show?.(true); } catch { /* ignore */ }
}
//# sourceMappingURL=logger.js.map
