/**
 * 轻量 HTML 模板辅助
 *
 * 用法：
 *   const fragment = wsHtml`<div class="x">${user.name}</div>`;
 *   container.innerHTML = fragment;
 *
 * 自动 escape 字符串/数字/布尔；数组会被 join('')；
 * 对受信任原样片段使用 wsRaw(str)：wsHtml`${wsRaw(prebuilt)}`。
 */
(function () {
    if (window.wsHtml) return;
    const RAW = Symbol('raw');
    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function serialize(v) {
        if (v == null || v === false) return '';
        if (v === true) return '';
        if (typeof v === 'number') return String(v);
        if (Array.isArray(v)) return v.map(serialize).join('');
        if (typeof v === 'object' && v[RAW] !== undefined) return String(v[RAW]);
        return esc(v);
    }
    function wsHtml(strings, ...values) {
        let out = '';
        for (let i = 0; i < strings.length; i++) {
            out += strings[i];
            if (i < values.length) out += serialize(values[i]);
        }
        return out;
    }
    function wsRaw(str) { return { [RAW]: String(str ?? '') }; }
    window.wsHtml = wsHtml;
    window.wsRaw = wsRaw;
})();
