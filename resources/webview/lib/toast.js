/**
 * 统一 toast 组件
 *
 * 使用方法：
 *   wsToast.success('已切换至 xxx');
 *   wsToast.error('切换失败');
 *   wsToast.info('已复制 token');
 *   wsToast.warn('额度紧张');
 *
 * 在 main.js 中通过 <script src="lib/toast.js"></script> 引入。
 * 暴露到全局 `wsToast`，避免与既有 `toast` 冲突。
 */
(function () {
    if (window.wsToast) return; // 防重复注入
    const STACK_ID = 'ws-toast-stack';
    function ensureStack() {
        let el = document.getElementById(STACK_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = STACK_ID;
            el.style.cssText = [
                'position:fixed',
                'right:14px',
                'bottom:14px',
                'z-index:99999',
                'display:flex',
                'flex-direction:column',
                'gap:8px',
                'pointer-events:none',
            ].join(';');
            document.body.appendChild(el);
        }
        return el;
    }
    function colorOf(kind) {
        switch (kind) {
            case 'success': return { bg: 'rgba(16,185,129,0.96)', fg: '#fff' };
            case 'error':   return { bg: 'rgba(239,68,68,0.96)',  fg: '#fff' };
            case 'warn':    return { bg: 'rgba(245,158,11,0.96)', fg: '#1a1a1a' };
            default:        return { bg: 'rgba(59,130,246,0.96)', fg: '#fff' };
        }
    }
    function show(kind, msg, opts) {
        opts = opts || {};
        const stack = ensureStack();
        const item = document.createElement('div');
        const c = colorOf(kind);
        item.style.cssText = [
            'pointer-events:auto',
            'min-width:200px',
            'max-width:380px',
            'padding:8px 12px',
            'border-radius:6px',
            'font-size:12px',
            'line-height:1.4',
            'color:' + c.fg,
            'background:' + c.bg,
            'box-shadow:0 6px 16px rgba(0,0,0,0.28)',
            'opacity:0',
            'transform:translateY(6px)',
            'transition:opacity .15s ease,transform .15s ease',
        ].join(';');
        item.textContent = String(msg ?? '');
        stack.appendChild(item);
        // animate in
        requestAnimationFrame(() => {
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        });
        const duration = Math.max(1200, opts.duration ?? (kind === 'error' ? 4000 : 2200));
        const close = () => {
            item.style.opacity = '0';
            item.style.transform = 'translateY(6px)';
            setTimeout(() => { try { item.remove(); } catch {} }, 200);
        };
        item.addEventListener('click', close);
        setTimeout(close, duration);
        return close;
    }
    window.wsToast = {
        success: (m, o) => show('success', m, o),
        error:   (m, o) => show('error',   m, o),
        warn:    (m, o) => show('warn',    m, o),
        info:    (m, o) => show('info',    m, o),
    };
})();
