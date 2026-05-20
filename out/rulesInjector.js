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
exports.hasBubbleRules = hasBubbleRules;
exports.injectBubbleRules = injectBubbleRules;
exports.removeBubbleRules = removeBubbleRules;
exports.hasScriptDisciplineRules = hasScriptDisciplineRules;
exports.injectScriptDisciplineRules = injectScriptDisciplineRules;
exports.removeScriptDisciplineRules = removeScriptDisciplineRules;
exports.ensureAllEnhancementRules = ensureAllEnhancementRules;
exports.removeAllEnhancementRules = removeAllEnhancementRules;
exports.ensureBubbleRules = ensureBubbleRules;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const RULE_META = {
    bubble: {
        start: '<!-- ws-better-rules-start -->',
        end: '<!-- ws-better-rules-end -->',
        filename: 'bubble-rules.md',
        label: '智能建议规则',
    },
    scriptDiscipline: {
        start: '<!-- ws-better-script-discipline-start -->',
        end: '<!-- ws-better-script-discipline-end -->',
        filename: 'script-discipline-rules.md',
        label: '脚本纪律规则',
    },
};
/**
 * 获取 .windsurfrules 文件路径（全局）
 */
function getGlobalRulesPath() {
    return path.join(os.homedir(), '.windsurfrules');
}
function getRuleContent(kind) {
    const ext = vscode.extensions.getExtension('local.windsurf-pool');
    if (!ext)
        return null;
    const rulesPath = path.join(ext.extensionPath, 'resources', RULE_META[kind].filename);
    if (!fs.existsSync(rulesPath))
        return null;
    return fs.readFileSync(rulesPath, 'utf8');
}
/**
 * 通用：检查指定规则是否已注入
 * 只检查自有 marker，避免误判用户手动添加的示例
 */
function hasRules(kind) {
    const rulesPath = getGlobalRulesPath();
    if (!fs.existsSync(rulesPath))
        return false;
    const content = fs.readFileSync(rulesPath, 'utf8');
    return content.includes(RULE_META[kind].start);
}
/**
 * 通用：注入指定规则到全局 .windsurfrules
 * 已存在同 marker 时执行"更新"语义（先剥离旧块再追加新块）
 */
function injectRules(kind) {
    try {
        const rulesContent = getRuleContent(kind);
        if (!rulesContent) {
            return { injected: false, error: `未找到规则模板文件 (${RULE_META[kind].filename})` };
        }
        const meta = RULE_META[kind];
        const rulesPath = getGlobalRulesPath();
        let existing = '';
        if (fs.existsSync(rulesPath)) {
            existing = fs.readFileSync(rulesPath, 'utf8');
            // 已存在 marker → 先删除旧版本再重新注入（实现"更新"语义）
            if (existing.includes(meta.start)) {
                const startIdx = existing.indexOf(meta.start);
                const endIdx = existing.indexOf(meta.end);
                if (endIdx >= 0) {
                    const before = existing.substring(0, startIdx);
                    const after = existing.substring(endIdx + meta.end.length);
                    existing = before.trimEnd() + after.trimStart();
                }
            }
        }
        // 组装内容
        const block = `\n\n${meta.start}\n${rulesContent}\n${meta.end}\n`;
        const newContent = existing.trimEnd() + block;
        fs.writeFileSync(rulesPath, newContent, 'utf8');
        return { injected: true };
    }
    catch (err) {
        return { injected: false, error: String(err) };
    }
}
/**
 * 通用：移除指定规则
 */
function removeRules(kind) {
    const rulesPath = getGlobalRulesPath();
    if (!fs.existsSync(rulesPath))
        return false;
    const meta = RULE_META[kind];
    let content = fs.readFileSync(rulesPath, 'utf8');
    if (!content.includes(meta.start))
        return false;
    const startIdx = content.indexOf(meta.start);
    const endIdx = content.indexOf(meta.end);
    if (endIdx < 0)
        return false;
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx + meta.end.length);
    content = (before.trimEnd() + '\n' + after.trimStart()).trim();
    if (content) {
        fs.writeFileSync(rulesPath, content + '\n', 'utf8');
    }
    else {
        // 文件为空则删除
        fs.unlinkSync(rulesPath);
    }
    return true;
}
// ========== 气泡规则（保留原 API 以兼容现有调用方） ==========
function hasBubbleRules() {
    return hasRules('bubble');
}
function injectBubbleRules() {
    return injectRules('bubble');
}
function removeBubbleRules() {
    return removeRules('bubble');
}
// ========== 脚本纪律规则 ==========
function hasScriptDisciplineRules() {
    return hasRules('scriptDiscipline');
}
function injectScriptDisciplineRules() {
    return injectRules('scriptDiscipline');
}
function removeScriptDisciplineRules() {
    return removeRules('scriptDiscipline');
}
// ========== 聚合操作 ==========
/**
 * 启用增强时：确保所有增强相关规则都已注入（缺什么补什么）
 */
function ensureAllEnhancementRules() {
    const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get('enabled', false);
    if (!enabled)
        return;
    if (!hasBubbleRules()) {
        const r = injectBubbleRules();
        if (r.injected)
            console.log('[windsurf-pool] 智能建议规则已自动注入到 ~/.windsurfrules');
    }
    if (!hasScriptDisciplineRules()) {
        const r = injectScriptDisciplineRules();
        if (r.injected)
            console.log('[windsurf-pool] 脚本纪律规则已自动注入到 ~/.windsurfrules');
    }
}
/**
 * 关闭增强时：移除所有增强相关规则
 */
function removeAllEnhancementRules() {
    try {
        removeBubbleRules();
    }
    catch { }
    try {
        removeScriptDisciplineRules();
    }
    catch { }
}
/**
 * @deprecated 请使用 ensureAllEnhancementRules()；此别名保留仅为兼容旧调用方
 */
function ensureBubbleRules() {
    ensureAllEnhancementRules();
}
//# sourceMappingURL=rulesInjector.js.map