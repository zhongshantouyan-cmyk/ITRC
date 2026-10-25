// Public website content only; ops, RTDB, users and external media need separate backups.
const CONTENT_COLUMNS = Object.freeze({
    sections: ['id', 'key', 'title', 'content', 'updated_at'],
    achievements: ['id', 'semester', 'title', 'category', 'description', 'link', 'order_num', 'created_at'],
    members: ['id', 'name', 'role', 'department', 'year', 'avatar_url', 'order_num', 'archived_at'],
    activities: ['id', 'type', 'semester', 'title', 'date', 'description', 'speaker', 'image_url', 'video_url', 'created_at'],
    experiences: ['id', 'author', 'title', 'content', 'created_at'],
    online_resources: ['id', 'name', 'name_en', 'url', 'description', 'icon', 'color', 'order_num', 'created_at'],
    offline_resources: ['id', 'title', 'title_en', 'author', 'cover_url', 'description', 'order_num', 'created_at'],
});
const CONTENT_TABLES = Object.freeze(Object.keys(CONTENT_COLUMNS));
const SNAPSHOT_SCOPE = Object.freeze({
    name: 'public-website-content', version: 3, tables: CONTENT_TABLES,
    excludes: ['users', 'ops', 'Firebase RTDB', 'uploaded image bytes', 'Google Drive', 'Canva'],
});
const MAX_SNAPSHOTS = 50;
const safeStringify = obj => JSON.stringify(obj, (_key, value) => typeof value === 'bigint' ? Number(value) : value);
const canRestoreSnapshot = actor => !!actor?.superAdmin || ['chair', 'advisor', 'admin'].includes(actor?.role);

async function captureSnapshot(connection) {
    const data = {};
    const results = await connection.batch(Object.entries(CONTENT_COLUMNS)
        .map(([table, columns]) => `SELECT ${columns.join(', ')} FROM ${table} ORDER BY id`));
    CONTENT_TABLES.forEach((table, index) => { data[table] = results[index].rows; });
    return data;
}

async function insertSnapshot(connection, data, description, createdBy, isAuto) {
    const result = await connection.execute({
        sql: 'INSERT INTO content_snapshots (snapshot_data, description, created_by, is_auto) VALUES (?, ?, ?, ?)',
        args: [safeStringify(data), description, createdBy, isAuto ? 1 : 0],
    });
    await connection.execute({
        sql: 'DELETE FROM content_snapshots WHERE id NOT IN (SELECT id FROM content_snapshots ORDER BY id DESC LIMIT ?)',
        args: [MAX_SNAPSHOTS],
    });
    return String(result.lastInsertRowid);
}

async function inWriteTransaction(db, run) {
    const tx = await db.transaction('write');
    try {
        const result = await run(tx);
        await tx.commit();
        return result;
    } catch (error) {
        if (!tx.closed) {
            try { await tx.rollback(); error.rollbackConfirmed = true; }
            catch { error.rollbackConfirmed = false; }
        }
        throw error;
    } finally { tx.close(); }
}

async function createSnapshot(db, description, createdBy = 'system', isAuto = false) {
    return inWriteTransaction(db, async tx => insertSnapshot(tx, await captureSnapshot(tx), description, createdBy, isAuto));
}

function validateSnapshot(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('快照格式不正確。');
    const tables = Object.keys(data);
    if (!tables.length) throw new Error('快照沒有可還原的內容。');
    for (const table of tables) {
        if (!CONTENT_TABLES.includes(table)) throw new Error(`快照包含不支援的資料表：${table}`);
        if (!Array.isArray(data[table])) throw new Error(`快照的 ${table} 不是資料列陣列。`);
        for (const row of data[table]) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`快照的 ${table} 資料列不正確。`);
            const columns = Object.keys(row);
            if (!columns.length || columns.some(column => !CONTENT_COLUMNS[table].includes(column))) {
                throw new Error(`快照的 ${table} 包含未允許的欄位。`);
            }
            if (Object.values(row).some(value => value !== null && !['string', 'number', 'bigint'].includes(typeof value))) {
                throw new Error(`快照的 ${table} 包含不支援的欄位值。`);
            }
        }
    }
    return tables;
}

async function restoreSnapshot(db, id, createdBy = 'admin') {
    return inWriteTransaction(db, async tx => {
        const result = await tx.execute({ sql: 'SELECT snapshot_data FROM content_snapshots WHERE id = ?', args: [id] });
        if (!result.rows.length) { const error = new Error('找不到此快照'); error.status = 404; throw error; }
        const data = JSON.parse(result.rows[0].snapshot_data);
        const restoredTables = validateSnapshot(data);
        // Older snapshots predate departures. Restoring copy must not silently
        // make currently archived people visible again.
        if (data.members) {
            const current = await tx.execute('SELECT id, archived_at FROM members');
            const archived = new Map(current.rows.map(row => [String(row.id), row.archived_at]));
            for (const row of data.members) {
                if (!Object.hasOwn(row, 'archived_at')) row.archived_at = archived.get(String(row.id)) || null;
            }
        }
        // Backup and restoration share a transaction, so failed INSERTs cannot leave partial deletes.
        const beforeSnapshotId = await insertSnapshot(tx, await captureSnapshot(tx), `還原前自動備份 (還原至快照 #${id})`, createdBy, true);
        const statements = [];
        for (const table of restoredTables) {
            statements.push(`DELETE FROM ${table}`);
            for (const row of data[table]) {
                const columns = Object.keys(row);
                statements.push({
                    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
                    args: columns.map(column => row[column]),
                });
            }
        }
        await tx.batch(statements);
        return { beforeSnapshotId, restoredTables, preservedTables: CONTENT_TABLES.filter(table => !restoredTables.includes(table)) };
    });
}

module.exports = { CONTENT_COLUMNS, CONTENT_TABLES, SNAPSHOT_SCOPE, safeStringify,
    captureSnapshot, createSnapshot, restoreSnapshot, validateSnapshot, canRestoreSnapshot };
