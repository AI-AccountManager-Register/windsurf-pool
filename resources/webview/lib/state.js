/**
 * Webview 状态持久化辅助
 *
 * 用 vscode.getState/setState 但做 debounce 合并写：
 *   wsState.set('_pageSize', 20);    // 单字段
 *   wsState.update({ a:1, b:2 });   // 多字段
 *   const v = wsState.get('_pageSize', 20); // 默认值
 *   wsState.flush();                  // 立即落盘
 *
 * 需要先在 main.js 调用：wsState.bind(vscode)
 */
(function () {
    if (window.wsState) return;
    let _vscode = null;
    let _cache = null;
    let _timer = null;
    function ensureCache() {
        if (_cache) return _cache;
        try { _cache = (_vscode && _vscode.getState()) || {}; }
        catch { _cache = {}; }
        return _cache;
    }
    function schedule() {
        if (!_vscode) return;
        if (_timer) return;
        _timer = setTimeout(() => {
            _timer = null;
            try { _vscode.setState({ ...(_cache || {}) }); } catch {}
        }, 250);
    }
    window.wsState = {
        bind(vscode) { _vscode = vscode; ensureCache(); },
        get(key, def) {
            const c = ensureCache();
            return Object.prototype.hasOwnProperty.call(c, key) ? c[key] : def;
        },
        set(key, value) {
            const c = ensureCache();
            if (c[key] === value) return;
            c[key] = value;
            schedule();
        },
        update(patch) {
            const c = ensureCache();
            let changed = false;
            for (const k of Object.keys(patch)) {
                if (c[k] !== patch[k]) { c[k] = patch[k]; changed = true; }
            }
            if (changed) schedule();
        },
        flush() {
            if (_timer) { clearTimeout(_timer); _timer = null; }
            if (_vscode) { try { _vscode.setState({ ...(_cache || {}) }); } catch {} }
        },
        raw() { return ensureCache(); },
    };
})();
