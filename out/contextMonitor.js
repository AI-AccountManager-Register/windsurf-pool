"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContextMonitorSnapshot = getContextMonitorSnapshot;
const cascadeProbe_1 = require("./cascadeProbe");
const MODEL_LIMITS = {
    'gpt-5-4': 400000,
    'gpt-5-5': 400000,
    'gpt-5-2': 400000,
    'gpt-5-1': 400000,
    'claude-sonnet-4-6': 1000000,
    'gemini-3': 1000000,
    'gemini-3-1': 1000000,
    'swe-1-5': 200000,
    'swe-1-6': 200000,
};
function meta(ls) {
    return {
        ideName: 'windsurf',
        ideVersion: ls.ideVersion,
        extensionName: 'windsurf-next',
        extensionVersion: ls.ideVersion,
    };
}
async function selectLiveLs() {
    const instances = (0, cascadeProbe_1.discoverLsInstances)();
    for (const ls of instances) {
        try {
            const r = await (0, cascadeProbe_1.grpcPost)(ls.port, ls.csrf, `${cascadeProbe_1.LS_SERVICE}/GetAllCascadeTrajectories`, { metadata: meta(ls) }, 5000);
            if (!r.grpcStatus || r.grpcStatus === '0')
                return ls;
        }
        catch { }
    }
    return null;
}
function asNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function shortText(v, max = 260) {
    return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function estimateTokens(text) {
    let ascii = 0, nonAscii = 0;
    for (const ch of text || '') {
        if (ch.charCodeAt(0) < 128)
            ascii++;
        else
            nonAscii++;
    }
    return Math.ceil(ascii / 4 + nonAscii / 1.5);
}
function contextLimitFor(model) {
    const lower = (model || '').toLowerCase();
    for (const key of Object.keys(MODEL_LIMITS)) {
        if (lower.includes(key))
            return MODEL_LIMITS[key];
    }
    if (lower.includes('1m') || lower.includes('gemini'))
        return 1000000;
    if (lower.includes('gpt'))
        return 400000;
    return 200000;
}
function processSteps(steps, fallbackModel) {
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let latestUser = '';
    let latestReply = '';
    let model = fallbackModel || '';
    let compressed = false;
    let lastCheckpointInput = -1;
    let deltaTokens = 0;
    for (const step of steps) {
        const type = String(step.type || '');
        const md = step.metadata || {};
        const stepModel = md.generatorModelUid || md.requestedModelUid || md.modelUid;
        if (stepModel)
            model = String(stepModel);
        const inTok = asNumber(md.inputTokens);
        const outTok = asNumber(md.outputTokens);
        const cacheTok = asNumber(md.cacheReadTokens);
        if (inTok > 0)
            inputTokens = inTok;
        if (outTok > 0)
            outputTokens = Math.max(outputTokens, outTok);
        if (cacheTok > 0)
            cachedTokens = Math.max(cachedTokens, cacheTok);
        const checkpointUsage = step.checkpoint?.modelUsage || md.modelUsage;
        if (checkpointUsage) {
            const cpIn = asNumber(checkpointUsage.inputTokens);
            const cpOut = asNumber(checkpointUsage.outputTokens);
            if (lastCheckpointInput > 0 && cpIn > 0 && lastCheckpointInput - cpIn > 5000)
                compressed = true;
            if (cpIn > 0) {
                inputTokens = cpIn;
                lastCheckpointInput = cpIn;
            }
            if (cpOut > 0)
                outputTokens = cpOut;
        }
        if (type.includes('USER_INPUT')) {
            latestUser = shortText(step.userInput?.userResponse || step.userInput?.items?.map((i) => i.text).join(' '), 400);
            deltaTokens += estimateTokens(latestUser);
        }
        if (type.includes('PLANNER_RESPONSE')) {
            const reply = step.plannerResponse?.modifiedResponse || step.plannerResponse?.response || '';
            latestReply = shortText(reply, 700);
            deltaTokens += estimateTokens(reply);
        }
    }
    const totalTokens = Math.max(0, inputTokens + outputTokens + deltaTokens);
    const contextLimit = contextLimitFor(model);
    const contextPercent = contextLimit > 0 ? Math.min(999, Math.round(totalTokens / contextLimit * 1000) / 10) : 0;
    return { inputTokens, outputTokens, cachedTokens, totalTokens, contextLimit, contextPercent, latestUser, latestReply, model, compressed };
}
function workspaceName(summary) {
    const w = summary?.workspaces?.[0]?.workspaceFolderAbsoluteUri || summary?.workspaces?.[0]?.gitRootAbsoluteUri || '';
    return String(w).replace(/^file:\/+\/?/i, '').replace(/\//g, '\\');
}
async function getContextMonitorSnapshot() {
    const ls = await selectLiveLs();
    if (!ls)
        return { ok: false, error: '未找到可用 Windsurf Language Server', updatedAt: Date.now(), sessions: [] };
    try {
        const all = await (0, cascadeProbe_1.grpcPost)(ls.port, ls.csrf, `${cascadeProbe_1.LS_SERVICE}/GetAllCascadeTrajectories`, { metadata: meta(ls) }, 10000);
        if (all.grpcStatus && all.grpcStatus !== '0') {
            return { ok: false, error: `GetAllCascadeTrajectories: ${decodeURIComponent(all.grpcMsg || all.grpcStatus)}`, lsPort: ls.port, updatedAt: Date.now(), sessions: [] };
        }
        const summaries = all.json?.trajectorySummaries || {};
        const entries = Object.entries(summaries)
            .map(([id, s]) => ({ id, s }))
            .sort((a, b) => Date.parse(b.s.lastModifiedTime || b.s.createdTime || 0) - Date.parse(a.s.lastModifiedTime || a.s.createdTime || 0))
            .slice(0, 8);
        const sessions = [];
        for (const entry of entries) {
            let steps = [];
            let error = '';
            try {
                const r = await (0, cascadeProbe_1.grpcPost)(ls.port, ls.csrf, `${cascadeProbe_1.LS_SERVICE}/GetCascadeTrajectorySteps`, {
                    metadata: meta(ls),
                    cascadeId: entry.id,
                    startIndex: 0,
                    endIndex: Math.min(500, Number(entry.s.stepCount || 0) || 500),
                }, 10000);
                if (!r.grpcStatus || r.grpcStatus === '0')
                    steps = r.json?.steps || [];
                else
                    error = decodeURIComponent(r.grpcMsg || r.grpcStatus);
            }
            catch (e) {
                error = e?.message || String(e);
            }
            const usage = processSteps(steps, entry.s.lastGeneratorModelUid || '');
            sessions.push({
                id: entry.id,
                title: entry.s.summary || 'New Cascade',
                status: entry.s.status || '',
                stepCount: Number(entry.s.stepCount || steps.length || 0),
                workspace: workspaceName(entry.s),
                updatedAt: entry.s.lastModifiedTime || entry.s.createdTime || '',
                error,
                ...usage,
            });
        }
        const active = sessions.find(s => /RUNNING/i.test(s.status)) || sessions[0];
        return { ok: true, lsPort: ls.port, updatedAt: Date.now(), active, sessions };
    }
    catch (e) {
        return { ok: false, error: e?.message || String(e), lsPort: ls.port, updatedAt: Date.now(), sessions: [] };
    }
}
//# sourceMappingURL=contextMonitor.js.map