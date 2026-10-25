const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { publicSection, validateSectionContent } = require('../public-content');

const router = express.Router();

// GET /api/sections — get all sections
router.get('/', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM sections ORDER BY id');
        res.json(result.rows.map(publicSection));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sections/:key — get one section by key
router.get('/:key', async (req, res) => {
    try {
        const result = await db.execute({
            sql: 'SELECT * FROM sections WHERE key = ?',
            args: [req.params.key]
        });
        const section = result.rows[0];
        if (!section) return res.status(404).json({ error: '找不到此區塊' });
        res.json(publicSection(section));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/sections/:key — update section (admin)
router.put('/:key', authMiddleware, async (req, res) => {
    const { title } = req.body;
    let content = req.body.content;
    if (content != null) {
        try { content = validateSectionContent(req.params.key, content); }
        catch (error) { return res.status(400).json({ error: error.message }); }
    }
    try {
        const existingResult = await db.execute({
            sql: 'SELECT * FROM sections WHERE key = ?',
            args: [req.params.key]
        });

        if (existingResult.rows.length === 0) {
            // Create new section
            await db.execute({
                sql: 'INSERT INTO sections (key, title, content) VALUES (?, ?, ?)',
                args: [req.params.key, title || '', content || '']
            });
        } else {
            await db.execute({
                sql: 'UPDATE sections SET title = COALESCE(?, title), content = COALESCE(?, content), updated_at = CURRENT_TIMESTAMP WHERE key = ?',
                args: [title ?? null, content ?? null, req.params.key]
            });
        }

        const sectionResult = await db.execute({
            sql: 'SELECT * FROM sections WHERE key = ?',
            args: [req.params.key]
        });
        res.json(publicSection(sectionResult.rows[0]));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
