'use strict';
const { maintenanceCheck } = require('./maintenance-check');

function previewWritePolicy(env = process.env) {
    if (env.VERCEL_ENV !== 'preview') return { allowed: true, reason: 'not_preview' };
    const check = maintenanceCheck(env);
    const allowed = env.ITRC_ALLOW_ISOLATED_PREVIEW_WRITES === 'true' && check.previewWritesReadyForReview;
    return { allowed, reason: allowed ? 'isolated_preview_confirmed' : 'preview_is_read_only' };
}

function createPreviewWriteGuard(env = process.env) {
    return (req, res, next) => {
        const path = (req.path || String(req.url || '').split('?')[0]).toLowerCase().replace(/\/+$/, '');
        const writes = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
            path === '/api/ops/jobs/tick' || path === '/api/ops/connections/canva/callback';
        if (writes && !previewWritePolicy(env).allowed) {
            return res.status(503).json({ code: 'PREVIEW_READ_ONLY',
                error: '此預覽環境尚未確認獨立測試資料庫，已停止寫入。請到正式工作台操作；練習請用示範模式。' });
        }
        return next();
    };
}

module.exports = { previewWritePolicy, createPreviewWriteGuard };
