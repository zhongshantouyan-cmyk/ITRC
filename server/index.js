const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialize database (creates tables)
require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
const { autoSnapshotMiddleware } = require('./routes/snapshots');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/snapshots', require('./routes/snapshots'));

// Content routes — attach auto-snapshot middleware for write operations
app.use('/api/sections', autoSnapshotMiddleware, require('./routes/sections'));
app.use('/api/achievements', autoSnapshotMiddleware, require('./routes/achievements'));
app.use('/api/members', autoSnapshotMiddleware, require('./routes/members'));
app.use('/api/activities', autoSnapshotMiddleware, require('./routes/activities'));
app.use('/api/experiences', autoSnapshotMiddleware, require('./routes/experiences'));
app.use('/api/search', require('./routes/search'));

// Upload route (Cloudinary)
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Use memory storage so files aren't saved to disk (Render free tier has ephemeral FS)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('只能上傳圖片檔案'), false);
        }
    }
});

const { authMiddleware } = require('./middleware/auth');

app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '未選擇檔案' });

    try {
        // Upload buffer to Cloudinary
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: 'itrc',
                    resource_type: 'image',
                    transformation: [
                        { quality: 'auto', fetch_format: 'auto' }
                    ]
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(req.file.buffer);
        });

        res.json({
            url: result.secure_url,
            public_id: result.public_id,
            width: result.width,
            height: result.height,
        });
    } catch (err) {
        console.error('Cloudinary upload error:', err);
        res.status(500).json({ error: '圖片上傳失敗: ' + err.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`ITRC Server running on http://localhost:${PORT}`);
});
