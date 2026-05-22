const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// Get all resources
router.get('/', async (req, res) => {
    try {
        const online = await db.execute('SELECT * FROM online_resources ORDER BY order_num ASC, id DESC');
        const offline = await db.execute('SELECT * FROM offline_resources ORDER BY order_num ASC, id DESC');
        
        res.json({
            online: online.rows,
            offline: offline.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ONLINE RESOURCES endpoints
router.post('/online', authMiddleware, async (req, res) => {
    const { name, name_en, url, description, icon, color, order_num } = req.body;
    try {
        const result = await db.execute({
            sql: 'INSERT INTO online_resources (name, name_en, url, description, icon, color, order_num) VALUES (?, ?, ?, ?, ?, ?, ?)',
            args: [name, name_en || '', url, description || '', icon || '', color || '#1565c0', order_num || 0]
        });
        res.json({ id: result.lastInsertRowid });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add online resource' });
    }
});

router.put('/online/:id', authMiddleware, async (req, res) => {
    const { name, name_en, url, description, icon, color, order_num } = req.body;
    try {
        await db.execute({
            sql: 'UPDATE online_resources SET name=?, name_en=?, url=?, description=?, icon=?, color=?, order_num=? WHERE id=?',
            args: [name, name_en || '', url, description || '', icon || '', color || '#1565c0', order_num || 0, req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update online resource' });
    }
});

router.delete('/online/:id', authMiddleware, async (req, res) => {
    try {
        await db.execute({
            sql: 'DELETE FROM online_resources WHERE id=?',
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete online resource' });
    }
});

// OFFLINE RESOURCES endpoints
router.post('/offline', authMiddleware, async (req, res) => {
    const { title, title_en, author, cover_url, description, order_num } = req.body;
    try {
        const result = await db.execute({
            sql: 'INSERT INTO offline_resources (title, title_en, author, cover_url, description, order_num) VALUES (?, ?, ?, ?, ?, ?)',
            args: [title, title_en || '', author || '', cover_url || '', description || '', order_num || 0]
        });
        res.json({ id: result.lastInsertRowid });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add offline resource' });
    }
});

router.put('/offline/:id', authMiddleware, async (req, res) => {
    const { title, title_en, author, cover_url, description, order_num } = req.body;
    try {
        await db.execute({
            sql: 'UPDATE offline_resources SET title=?, title_en=?, author=?, cover_url=?, description=?, order_num=? WHERE id=?',
            args: [title, title_en || '', author || '', cover_url || '', description || '', order_num || 0, req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update offline resource' });
    }
});

router.delete('/offline/:id', authMiddleware, async (req, res) => {
    try {
        await db.execute({
            sql: 'DELETE FROM offline_resources WHERE id=?',
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete offline resource' });
    }
});

module.exports = router;
