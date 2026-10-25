const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { createSnapshot, restoreSnapshot, SNAPSHOT_SCOPE, canRestoreSnapshot } = require('../content-snapshots');
const router = express.Router();

// Mounted before content routes: authenticate and finish the pre-change backup first.
function autoSnapshotMiddleware(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    return authMiddleware(req, res, async () => {
        try {
            await createSnapshot(db, `自動備份 (${req.method} ${req.baseUrl + req.path})`,
                req.user?.email || req.user?.username || 'admin', true);
            return next();
        } catch (error) {
            console.error('Auto-snapshot failed:', error);
            return res.status(503).json({ error: '修改前備份未完成，內容尚未變更。請稍後重試。' });
        }
    });
}

router.get('/', authMiddleware, async (_req, res) => {
    try {
        const result = await db.execute('SELECT id, description, created_by, is_auto, created_at FROM content_snapshots ORDER BY id DESC');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute({ sql: 'SELECT * FROM content_snapshots WHERE id = ?', args: [req.params.id] });
        if (!result.rows.length) return res.status(404).json({ error: '找不到此快照' });
        const snapshot = result.rows[0];
        res.json({ ...snapshot, snapshot_data: JSON.parse(snapshot.snapshot_data), scope: SNAPSHOT_SCOPE });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/', authMiddleware, async (req, res) => {
    try {
        const id = await createSnapshot(db, req.body.description || '手動備份', req.user?.email || req.user?.username || 'admin');
        res.status(201).json({ id, message: '官網內容快照建立成功', scope: SNAPSHOT_SCOPE });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/restore', authMiddleware, async (req, res) => {
    if (!canRestoreSnapshot(req.user)) return res.status(403).json({ error: '只有社長、副社長或顧問可還原官網內容。' });
    try {
        const result = await restoreSnapshot(db, req.params.id, req.user?.email || req.user?.username || 'admin');
        res.json({ message: `已還原 ${result.restoredTables.length} 類官網內容。${result.preservedTables.length ? '舊快照未包含的資料維持原樣。' : ''}`,
            ...result, scope: SNAPSHOT_SCOPE });
    } catch (error) {
        console.error('Restore error:', error);
        const prefix = error.rollbackConfirmed ? '還原未完成，原有內容已保留：'
            : '還原結果尚待確認，請先重新讀取內容與版本紀錄：';
        res.status(error.status || 500).json({ error: prefix + error.message });
    }
});

module.exports = router;
module.exports.autoSnapshotMiddleware = autoSnapshotMiddleware;
