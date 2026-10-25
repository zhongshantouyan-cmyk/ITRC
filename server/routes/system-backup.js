'use strict';
const express = require('express');
const { gzipSync } = require('node:zlib');
const { createSystemBackup, canExportSystemBackup } = require('../system-backup');

function createSystemBackupRouter({ db, readRTDB, authMiddleware, ready }) {
    if (typeof authMiddleware !== 'function') throw new TypeError('Authenticated backup access is required.');
    const router = express.Router();
    router.use((_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('CDN-Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        next();
    });
    router.get('/export', authMiddleware, async (req, res) => {
        if (!canExportSystemBackup(req.user)) return res.status(403).json({ error: '只有顧問或社團系統保管帳號可匯出系統資料備份。' });
        try {
            const bundle = await createSystemBackup({ db, readRTDB, ready });
            const date = bundle.createdAt.slice(0, 10).replaceAll('-', '');
            const json = JSON.stringify(bundle);
            // Native browser downloads support content encoding; compress large
            // snapshot history without changing the downloaded JSON format.
            const acceptsGzip = /(?:^|,)\s*gzip(?:\s*;|\s*,|\s*$)/i.test(req.headers?.['accept-encoding'] || '');
            const payload = acceptsGzip ? gzipSync(json) : Buffer.from(json);
            if (payload.length > 4 * 1024 * 1024) {
                return res.status(503).json({ error: '備份超過單次網頁下載大小，未輸出不完整資料；請由資訊保管人使用受控離線匯出。' });
            }
            res.set('Content-Disposition', `attachment; filename="ITRC-system-data-backup-${date}.json"`);
            if (acceptsGzip) res.set('Content-Encoding', 'gzip');
            return res.type('application/json').send(payload);
        } catch {
            return res.status(503).json({ error: '系統資料備份未完整完成，未產出備份檔。請確認資料庫及 Firebase 連線後重試。' });
        }
    });
    return router;
}

module.exports = { createSystemBackupRouter };
