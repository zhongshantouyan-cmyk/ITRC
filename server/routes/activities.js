const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/activities?type=record|plan&semester=114-1
router.get('/', async (req, res) => {
    const { type, semester } = req.query;
    try {
        let sql = 'SELECT * FROM activities';
        const conditions = [];
        const args = [];

        if (type) {
            conditions.push('type = ?');
            args.push(type);
        }
        if (semester) {
            conditions.push('semester = ?');
            args.push(semester);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY date ASC, created_at DESC';

        const result = await db.execute({ sql, args });
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/activities/semesters - get available semesters
router.get('/semesters', async (req, res) => {
    const { type } = req.query;
    try {
        let sql = 'SELECT DISTINCT semester FROM activities';
        const args = [];
        if (type) {
            sql += ' WHERE type = ?';
            args.push(type);
        }
        sql += ' ORDER BY semester DESC';
        const result = await db.execute({ sql, args });
        res.json(result.rows.map(r => r.semester));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/activities (admin)
router.post('/', authMiddleware, async (req, res) => {
    const { type, semester, title, date, description, speaker, image_url, video_url } = req.body;
    if (!type || !['record', 'plan'].includes(type)) {
        return res.status(400).json({ error: 'type 必須為 record 或 plan' });
    }
    try {
        const result = await db.execute({
            sql: 'INSERT INTO activities (type, semester, title, date, description, speaker, image_url, video_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            args: [type, semester || '114-1', title, date || null, description || null, speaker || null, image_url || null, video_url || null]
        });
        const activityResult = await db.execute({
            sql: 'SELECT * FROM activities WHERE id = ?',
            args: [result.lastInsertRowid.toString()]
        });
        res.status(201).json(activityResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/activities/:id (admin)
router.put('/:id', authMiddleware, async (req, res) => {
    const { type, semester, title, date, description, speaker, image_url, video_url } = req.body;
    try {
        await db.execute({
            sql: 'UPDATE activities SET type=COALESCE(?,type), semester=COALESCE(?,semester), title=COALESCE(?,title), date=COALESCE(?,date), description=COALESCE(?,description), speaker=COALESCE(?,speaker), image_url=COALESCE(?,image_url), video_url=COALESCE(?,video_url) WHERE id=?',
            args: [type ?? null, semester ?? null, title ?? null, date ?? null, description ?? null, speaker ?? null, image_url ?? null, video_url ?? null, req.params.id]
        });
        const activityResult = await db.execute({
            sql: 'SELECT * FROM activities WHERE id = ?',
            args: [req.params.id]
        });
        if (activityResult.rows.length === 0) return res.status(404).json({ error: '找不到此活動' });
        res.json(activityResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/activities/:id (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'DELETE FROM activities WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rowsAffected === 0) return res.status(404).json({ error: '找不到此活動' });
        res.json({ message: '已刪除' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
