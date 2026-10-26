const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { PUBLIC_MEMBER_COLUMNS } = require('../public-content');
const memberColumns = PUBLIC_MEMBER_COLUMNS.join(', ');
const { listMembers, setMemberArchived, canManageRoster } = require('../member-directory');

const router = express.Router();

// GET /api/members
router.get('/all', authMiddleware, async (req, res) => {
    if (!canManageRoster(req.user)) return res.status(403).json({ error: '只有名單管理者可檢視已卸任資料。' });
    try { res.set('Cache-Control', 'no-store').json(await listMembers(db, { includeArchived: true })); }
    catch { res.status(500).json({ error: '無法讀取幹部名單。' }); }
});

router.get('/', async (req, res) => {
    try {
        res.json(await listMembers(db));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/members (admin)
router.post('/', authMiddleware, async (req, res) => {
    if (!canManageRoster(req.user)) return res.status(403).json({ error: '只有名單管理者可修改幹部名單。' });
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
    if (!canManageRoster(req.user)) return res.status(403).json({ error: '只有名單管理者可修改幹部名單。' });
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

// A departure is reversible. Never erase the historical person row.
router.delete('/:id', authMiddleware, async (req, res) => {
    if (!canManageRoster(req.user)) return res.status(403).json({ error: '只有名單管理者可移出現任幹部。' });
    try {
        res.json(await setMemberArchived(db, req.params.id, true));
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

router.post('/:id/restore', authMiddleware, async (req, res) => {
    if (!canManageRoster(req.user)) return res.status(403).json({ error: '只有名單管理者可恢復公開幹部。' });
    try { res.json(await setMemberArchived(db, req.params.id, false)); }
    catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
