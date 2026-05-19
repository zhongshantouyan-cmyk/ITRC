const { createClient } = require('@libsql/client');
require('dotenv').config({ path: '../.env' }); // Load from root dir

// 優先使用環境變數中的連線資訊，如果沒有則使用本地端 SQLite (fallback for local development if not provided)
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./itrc.db',
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
        title text NOT NULL,
        date text,
        description text,
        speaker text,
        image_url text,
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
    `);

    // Migration: add speaker column if missing (for existing local DBs)
    try {
      await db.execute('ALTER TABLE activities ADD COLUMN speaker text');
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
