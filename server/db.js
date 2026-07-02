const { createClient } = require('@libsql/client');
require('dotenv').config({ path: '../.env' }); // Load from root dir

// 優先使用環境變數中的連線資訊，如果沒有則使用本地端 SQLite (fallback for local development if not provided)
// 防呆：正式環境（Vercel 會設 NODE_ENV=production）一定要有 Turso 連線；否則會 fallback 去開本地 SQLite 檔，
// 但 serverless 檔案系統唯讀，會讓所有 DB API 靜默 500。寧可在啟動時大聲崩。本地開發（非 production）仍沿用檔案 fallback。
const TURSO_URL = process.env.TURSO_DATABASE_URL;
if (!TURSO_URL && process.env.NODE_ENV === 'production') {
  throw new Error('[FATAL] TURSO_DATABASE_URL is required in production. The local file fallback cannot work on a read-only serverless filesystem — set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN).');
}
const db = createClient({
  url: TURSO_URL || 'file:./itrc.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  try {
    // Create tables
    await db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        role text DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key text UNIQUE NOT NULL,
        title text NOT NULL,
        content text NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        semester text NOT NULL,
        title text NOT NULL,
        category text,
        description text,
        link text,
        order_num INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name text NOT NULL,
        role text,
        department text,
        year text,
        avatar_url text,
        order_num INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type text NOT NULL CHECK(type IN ('record', 'plan')),
        semester text NOT NULL DEFAULT '114-1',
        title text NOT NULL,
        date text,
        description text,
        speaker text,
        image_url text,
        video_url text,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS experiences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author text NOT NULL,
        title text NOT NULL,
        content text NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS content_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_data TEXT NOT NULL,
        description TEXT,
        created_by TEXT DEFAULT 'system',
        is_auto INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS online_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name text NOT NULL,
        name_en text,
        url text NOT NULL,
        description text,
        icon text,
        color text,
        order_num INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS offline_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title text NOT NULL,
        title_en text,
        author text,
        cover_url text,
        description text,
        order_num INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: add speaker column if missing (for existing local DBs)
    try {
      await db.execute('ALTER TABLE activities ADD COLUMN speaker text');
    } catch (e) {
      // Column already exists or other error, ignore
    }

    // Migration: add semester column if missing
    try {
      await db.execute("ALTER TABLE activities ADD COLUMN semester text NOT NULL DEFAULT '114-1'");
    } catch (e) {
      // Column already exists or other error, ignore
    }

    // Migration: add video_url column if missing
    try {
      await db.execute('ALTER TABLE activities ADD COLUMN video_url text');
    } catch (e) {
      // Column already exists or other error, ignore
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// Start initialization immediately
initDB();

module.exports = db;
