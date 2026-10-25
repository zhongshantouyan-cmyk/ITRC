const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { PUBLIC_MEMBER_COLUMNS } = require('../public-content');
const memberColumns = PUBLIC_MEMBER_COLUMNS.join(', ');

const router = express.Router();

// GET /api/members
router.get('/', async (req, res) => {
    try {
        const result = await db.execute(`SELECT ${memberColumns} FROM members ORDER BY order_num ASC, id ASC`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/members (admin)
router.post('/', authMiddleware, async (req, res) => {
    const { name, role, department, year, avatar_url, order_num } = req.body;
    try {
        const result = await db.execute({
            sql: 'INSERT INTO members (name, role, department, year, avatar_url, order_num) VALUES (?, ?, ?, ?, ?, ?)',
            args: [name, role || null, department || null, year || null, avatar_url || null, order_num || 0]
        });
        const memberResult = await db.execute({
            sql: `SELECT ${memberColumns} FROM members WHERE id = ?`,
            args: [result.lastInsertRowid.toString()]
        });
        res.status(201).json(memberResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/members/:id (admin)
router.put('/:id', authMiddleware, async (req, res) => {
    const { name, role, department, year, avatar_url, order_num } = req.body;
    try {
        await db.execute({
            sql: 'UPDATE members SET name=COALESCE(?,name), role=COALESCE(?,role), department=COALESCE(?,department), year=COALESCE(?,year), avatar_url=COALESCE(?,avatar_url), order_num=COALESCE(?,order_num) WHERE id=?',
            args: [name ?? null, role ?? null, department ?? null, year ?? null, avatar_url ?? null, order_num ?? null, req.params.id]
        });
        const memberResult = await db.execute({
            sql: `SELECT ${memberColumns} FROM members WHERE id = ?`,
            args: [req.params.id]
        });
        if (memberResult.rows.length === 0) return res.status(404).json({ error: '找不到此成員' });
        res.json(memberResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/members/:id (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'DELETE FROM members WHERE id = ?',
            args: [req.params.id]
        });
        if (result.rowsAffected === 0) return res.status(404).json({ error: '找不到此成員' });
        res.json({ message: '已刪除' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
