const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Tables to include in snapshots (all content tables, NOT users)
const CONTENT_TABLES = ['sections', 'achievements', 'members', 'activities', 'experiences'];
const MAX_SNAPSHOTS = 50; // Keep at most 50 snapshots

// BigInt-safe JSON serializer (Turso returns integer columns as BigInt)
function safeStringify(obj) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? Number(value) : value
    );
}

// ==================== Helper: Capture current state ====================
async function captureSnapshot() {
    const data = {};
    for (const table of CONTENT_TABLES) {
        const result = await db.execute(`SELECT * FROM ${table}`);
        data[table] = result.rows;
    }
    return data;
}

// ==================== Helper: Create a snapshot ====================
async function createSnapshot(description, createdBy = 'system', isAuto = false) {
    const data = await captureSnapshot();
    const result = await db.execute({
        sql: 'INSERT INTO content_snapshots (snapshot_data, description, created_by, is_auto) VALUES (?, ?, ?, ?)',
        args: [safeStringify(data), description, createdBy, isAuto ? 1 : 0]
    });

    // Auto-cleanup: keep only the latest MAX_SNAPSHOTS
    await db.execute({
        sql: `DELETE FROM content_snapshots WHERE id NOT IN (
            SELECT id FROM content_snapshots ORDER BY created_at DESC LIMIT ?
        )`,
        args: [MAX_SNAPSHOTS]
    });

    return result.lastInsertRowid;
}

// ==================== Auto-Snapshot Middleware ====================
// Attaches to POST/PUT/DELETE on content routes to auto-backup before changes
let lastAutoSnapshotTime = 0;
const AUTO_SNAPSHOT_COOLDOWN = 2 * 60 * 1000; // 2 minutes cooldown

function autoSnapshotMiddleware(req, res, next) {
    // Only trigger on write operations
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
        return next();
    }

    const now = Date.now();
    if (now - lastAutoSnapshotTime < AUTO_SNAPSHOT_COOLDOWN) {
        // Skip if a snapshot was recently taken
        return next();
    }

    lastAutoSnapshotTime = now;

    // Create snapshot in background (don't block the request)
    const username = req.user?.username || 'system';
    const routePath = req.baseUrl + req.path;
    createSnapshot(
        `自動備份 (${req.method} ${routePath})`,
        username,
        true
    ).catch(err => console.error('Auto-snapshot failed:', err));

    next();
}

// ==================== Routes ====================

// GET /api/snapshots - List all snapshots (without the heavy data blob)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute(
            'SELECT id, description, created_by, is_auto, created_at FROM content_snapshots ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/snapshots/:id - Get a single snapshot with full data (for preview)
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'SELECT * FROM content_snapshots WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rows.length === 0) return res.status(404).json({ error: '找不到此快照' });

        const snapshot = result.rows[0];
        snapshot.snapshot_data = JSON.parse(snapshot.snapshot_data);
        res.json(snapshot);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/snapshots - Create a manual snapshot
router.post('/', authMiddleware, async (req, res) => {
    const { description } = req.body;
    try {
        const id = await createSnapshot(
            description || '手動備份',
            req.user?.username || 'admin',
            false
        );
        res.status(201).json({ id, message: '快照建立成功' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/snapshots/:id/restore - Restore from a snapshot
router.post('/:id/restore', authMiddleware, async (req, res) => {
    try {
        // 1. Fetch the target snapshot
        const result = await db.execute({
            sql: 'SELECT * FROM content_snapshots WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rows.length === 0) return res.status(404).json({ error: '找不到此快照' });

        const snapshotData = JSON.parse(result.rows[0].snapshot_data);

        // 2. Create a "before restore" backup first
        await createSnapshot(
            `還原前自動備份 (還原至快照 #${req.params.id})`,
            req.user?.username || 'admin',
            true
        );

        // 3. Restore each table
        for (const table of CONTENT_TABLES) {
            const rows = snapshotData[table];
            if (!rows) continue;

            // Clear current data
            await db.execute(`DELETE FROM ${table}`);

            // Re-insert all rows from snapshot
            for (const row of rows) {
                const columns = Object.keys(row);
                const placeholders = columns.map(() => '?').join(', ');
                const values = columns.map(col => row[col]);

                await db.execute({
                    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
                    args: values
                });
            }
        }

        res.json({ message: '還原成功！所有內容已恢復至所選版本。' });
    } catch (err) {
        console.error('Restore error:', err);
        res.status(500).json({ error: '還原失敗: ' + err.message });
    }
});

module.exports = router;
module.exports.autoSnapshotMiddleware = autoSnapshotMiddleware;
