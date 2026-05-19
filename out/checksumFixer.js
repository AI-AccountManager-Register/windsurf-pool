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
exports.fixChecksums = fixChecksums;
exports.restoreProductJson = restoreProductJson;
exports.getChecksumStatus = getChecksumStatus;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const elevatedFs_1 = require("./elevatedFs");
const PRODUCT_JSON = 'product.json';
const BACKUP_SUFFIX = '.origin';
/**
 * 计算单个文件的 base64 SHA256 哈希（去尾部 = 填充）
 */
function computeChecksum(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const buf = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
    }
    catch {
        return null;
    }
}
function getProductJsonPath() {
    return path.join(vscode.env.appRoot, PRODUCT_JSON);
}
/**
 * 重算并修复 product.json 中的所有 checksums
 * @param dryRun 仅检测，不写入
 */
function fixChecksums(dryRun = false) {
    const result = { fixed: 0, total: 0, unchanged: 0, missing: [] };
    try {
        const productPath = getProductJsonPath();
        if (!fs.existsSync(productPath)) {
            result.error = 'product.json 不存在';
            return result;
        }
        const original = fs.readFileSync(productPath, 'utf8');
        let product;
        try {
            product = JSON.parse(original);
        }
        catch (e) {
            result.error = 'product.json 解析失败：' + (e instanceof Error ? e.message : String(e));
            return result;
        }
        const checksums = product.checksums;
        if (!checksums || typeof checksums !== 'object') {
            result.error = 'product.json 无 checksums 字段';
            return result;
        }
        // 用字符串替换保留原文件格式（Tab 缩进等），不重新 JSON.stringify
        let content = original;
        for (const [relPath, oldHash] of Object.entries(checksums)) {
            result.total++;
            const fullPath = path.join(vscode.env.appRoot, 'out', relPath);
            const newHash = computeChecksum(fullPath);
            if (!newHash) {
                result.missing.push(relPath);
                continue;
            }
            if (newHash === oldHash) {
                result.unchanged++;
                continue;
            }
            // 用 split/join 方式做精确替换，避免正则特殊字符问题
            const before = content;
            content = content.split(`"${oldHash}"`).join(`"${newHash}"`);
            if (content !== before) {
                result.fixed++;
            }
        }
        if (result.fixed > 0 && !dryRun) {
            // 备份原始（仅首次）
            const backupPath = productPath + BACKUP_SUFFIX;
            if (!fs.existsSync(backupPath)) {
                (0, elevatedFs_1.copyFileWithElevation)(productPath, backupPath);
            }
            (0, elevatedFs_1.writeFileWithElevation)(productPath, content, 'utf8');
        }
        return result;
    }
    catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
        return result;
    }
}
/**
 * 恢复 product.json 到首次修改前的备份
 */
function restoreProductJson() {
    try {
        const productPath = getProductJsonPath();
        const backupPath = productPath + BACKUP_SUFFIX;
        if (!fs.existsSync(backupPath))
            return false;
        (0, elevatedFs_1.copyFileWithElevation)(backupPath, productPath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 检测当前 product.json 是否需要修复（不写入）
 */
function getChecksumStatus() {
    const r = fixChecksums(true);
    return { needsFix: r.fixed, total: r.total, missing: r.missing.length };
}
//# sourceMappingURL=checksumFixer.js.map