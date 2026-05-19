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
exports.getBridgeInfo = getBridgeInfo;
exports.startBridgeServer = startBridgeServer;
exports.stopBridgeServer = stopBridgeServer;
exports.requestSyncLogs = requestSyncLogs;
exports.enqueueCommand = enqueueCommand;
exports.onBridgeResult = onBridgeResult;
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
let server = null;
let port = 0;
let token = '';
const pendingQueue = [];
const resultListeners = [];
function getBridgeInfo() {
    if (!server || !port)
        return null;
    return { port, token };
}
function startBridgeServer() {
    return new Promise((resolve, reject) => {
        if (server && port)
            return resolve({ port, token });
        // 多实例隔离：每次启动都用新 token + OS 分配端口，端口/token 通过 sidebar
        // webview postMessage 广播到同进程的 workbench，不再靠 workbench.html 嵌入。
        token = crypto.randomBytes(16).toString('hex');
        server = http.createServer((req, res) => {
            // CORS：限定为 VS Code 内置 origin（vscode-file:// / vscode-webview://），
            // 避免本机其他网页通过 fetch 探测匹配 token。
            // 注意：fetch 默认带 Origin header；vscode-file:// 标准的 Origin 是 'vscode-file://vscode-app'
            const origin = String(req.headers.origin || '');
            const allowed = origin === '' || /^vscode-(file|webview):\/\//i.test(origin) || origin === 'null';
            if (allowed) {
                res.setHeader('Access-Control-Allow-Origin', origin || '*');
            }
            else {
                // 不放行：返回 403，避免恶意网页拿到响应
                res.writeHead(403);
                res.end('forbidden origin');
                return;
            }
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Bridge-Token');
            res.setHeader('Vary', 'Origin');
            // 24h preflight 缓存，避免每秒 GET /pending 都触发 OPTIONS
            res.setHeader('Access-Control-Max-Age', '86400');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            // Token 校验（除了 /ping 健康检查）
            const url = new URL(req.url || '/', 'http://localhost');
            if (url.pathname !== '/ping') {
                const reqToken = req.headers['x-bridge-token'];
                if (reqToken !== token) {
                    res.writeHead(401);
                    res.end('unauthorized');
                    return;
                }
            }
            if (req.method === 'GET' && url.pathname === '/ping') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, ts: Date.now() }));
                return;
            }
            if (req.method === 'GET' && url.pathname === '/pending') {
                // 一次性取出全部待执行命令并清空（windsurf-better.js 每秒轮询一次）
                const out = pendingQueue.splice(0);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(out));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/result') {
                let body = '';
                req.on('data', c => { body += c; if (body.length > 1024 * 256)
                    req.destroy(); });
                req.on('end', () => {
                    try {
                        const r = JSON.parse(body);
                        for (const fn of resultListeners.slice()) {
                            try {
                                fn(r);
                            }
                            catch (err) {
                                console.warn('[bridge] result listener error:', err);
                            }
                        }
                        res.writeHead(204);
                        res.end();
                    }
                    catch {
                        res.writeHead(400);
                        res.end('bad json');
                    }
                });
                return;
            }
            res.writeHead(404);
            res.end('not found');
        });
        let resolved = false;
        const onListening = () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                port = addr.port;
                resolved = true;
                console.log(`[bridge] listening on 127.0.0.1:${port}`);
                resolve({ port, token });
            }
            else {
                reject(new Error('failed to get server address'));
            }
        };
        server.on('listening', onListening);
        server.on('error', err => {
            if (resolved)
                return;
            console.error('[bridge] server error:', err);
            server = null;
            port = 0;
            reject(err);
        });
        // OS 分配端口；多实例各自独立，端口/token 经 sidebar postMessage 告知 workbench
        server.listen(0, '127.0.0.1');
    });
}
function stopBridgeServer() {
    if (server) {
        try {
            server.close();
        }
        catch { }
        server = null;
        port = 0;
        token = '';
        pendingQueue.length = 0;
        resultListeners.length = 0;
    }
}
/** 发送命令请求同步日志（用于全屏面板打开时拉取主窗口日志） */
function requestSyncLogs() {
    enqueueCommand({ id: Date.now(), action: 'syncLogs', payload: {} });
}
/**
 * 扩展宿主入队一条命令，等待 windsurf-better.js 来 GET /pending 取走
 */
function enqueueCommand(cmd) {
    pendingQueue.push({
        id: cmd.id,
        action: cmd.action,
        payload: cmd.payload || {},
        ts: Date.now(),
    });
    // 防止队列无限增长（如果 windsurf-better.js 没启动）
    while (pendingQueue.length > 100)
        pendingQueue.shift();
}
/**
 * 注册 result 监听器，windsurf-better.js POST /result 时被回调
 * 返回取消订阅函数
 */
function onBridgeResult(fn) {
    resultListeners.push(fn);
    return () => {
        const i = resultListeners.indexOf(fn);
        if (i >= 0)
            resultListeners.splice(i, 1);
    };
}
//# sourceMappingURL=bridgeServer.js.map