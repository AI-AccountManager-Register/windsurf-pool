/**
 * 共用类型定义（占位骨架，后续 TS 重构时按需扩展）
 *
 * 注意：本文件不会被运行时直接引用——它只服务 TypeScript 编译器，
 * 让未来从 out/*.js 迁移到 src/*.ts 时能拿到一致的接口契约。
 */

export interface Account {
    email: string;
    password?: string;
    token?: string;
    name?: string;
    tag?: string;
    tags?: string[];
    disabled?: boolean;
    created_at?: number;
    favorite?: boolean;
}

export interface UsageSnapshot {
    planName: string;
    planStart?: string;
    planEnd?: string;
    dailyUsedPercent: number;
    dailyRemainingPercent: number;
    weeklyUsedPercent: number;
    weeklyRemainingPercent: number;
    overageBalanceMicros?: number;
    flexCredits?: number;
    dailyResetAtUnix?: number;
    weeklyResetAtUnix?: number;
    fetchedAt: number;
}

export interface UsageCacheEntry {
    snapshot?: UsageSnapshot;
    error?: string;
    ts: number;
    skipUntil?: number;
}

export interface HealthCheckEntry {
    ok: boolean;
    reason?: string;
    status?: number;
    ts: number;
    testing?: boolean;
    stale?: boolean;
}

export interface SwitchResult {
    success: boolean;
    email: string;
    reason?: string;
    error?: string;
    durationMs?: number;
}

export interface PerAccountStats {
    switchToCount: number;
    dailyUsedPct: number;
    weeklyUsedPct: number;
    lastCheckTs: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    swallow<T>(label: string, fn: () => T, level?: LogLevel): T | undefined;
}
