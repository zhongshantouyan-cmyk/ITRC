'use strict';

const { createHash } = require('node:crypto');
const { mkdir, writeFile, chmod, unlink, rmdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createClient } = require('@libsql/client');

// This is a versioned data export, not a dump of arbitrary database tables or SQL.
const TABLE_COLUMNS = Object.freeze({
    users: ['id', 'username', 'password_hash', 'role', 'created_at'],
    sections: ['id', 'key', 'title', 'content', 'updated_at'],
    achievements: ['id', 'semester', 'title', 'category', 'description', 'link', 'order_num', 'created_at'],
    members: ['id', 'name', 'role', 'department', 'year', 'avatar_url', 'order_num', 'archived_at'],
    activities: ['id', 'type', 'semester', 'title', 'date', 'description', 'speaker', 'image_url', 'video_url', 'created_at'],
    experiences: ['id', 'author', 'title', 'content', 'created_at'],
    online_resources: ['id', 'name', 'name_en', 'url', 'description', 'icon', 'color', 'order_num', 'created_at'],
    offline_resources: ['id', 'title', 'title_en', 'author', 'cover_url', 'description', 'order_num', 'created_at'],
    content_snapshots: ['id', 'snapshot_data', 'description', 'created_by', 'is_auto', 'created_at'],
    ops_records: ['kind', 'id', 'version', 'data'],
    ops_audit: ['id', 'created_at', 'data'],
    ops_idempotency: ['actor_email', 'key', 'fingerprint', 'response', 'created_at'],
    ops_credentials: ['provider', 'sealed', 'status', 'owner', 'lease_until', 'updated_at'],
    ops_connection_audit: ['id', 'action', 'actor_email', 'created_at'],
});
const SQL_TABLES = Object.freeze(Object.keys(TABLE_COLUMNS));
const AUTO_TABLES = new Set(SQL_TABLES.filter(name => !name.startsWith('ops_')));
const PRIMARY_KEYS = Object.freeze(Object.fromEntries(SQL_TABLES.map(name => [name,
    name === 'ops_records' ? ['kind', 'id'] : name === 'ops_idempotency' ? ['actor_email', 'key']
        : name === 'ops_credentials' ? ['provider'] : ['id']])));
const RTDB_PATHS = Object.freeze(['roles', 'roles_archive', 'boards/itrc', 'finance/ledger',
    'finance/reimbursements', 'sponsors/records', 'sponsors/pipeline', 'sponsors/cands',
    'activities/state', 'certs/positions', 'certs/template']);
const EXCLUDES = Object.freeze(['environment secrets and encryption keys', 'Firebase Authentication credentials',
    'ops_oauth_states', 'ops_connection_intent', 'Google Drive file bytes', 'Canva design bytes',
    'Cloudinary image bytes', 'Firebase security rules and deployment settings']);
const FORMAT = 'itrc-system-data-backup';
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const canExportSystemBackup = actor => !!actor?.superAdmin || actor?.role === 'advisor';
const fail = message => { throw new Error(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownKeys = (value, expected) => isObject(value) && Object.keys(value).length === expected.length &&
    Object.keys(value).every(key => expected.includes(key));
const identifier = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
const quote = value => { if (!identifier(value)) fail('Unsafe schema identifier.'); return `"${value}"`; };

function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function encodeCell(value) {
    if (value === null || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        return { type: 'blob', value: bytes.toString('base64') };
    }
    fail('Unsupported database value; backup was not completed.');
}

function decodeCell(value) {
    if (value === null || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    if (ownKeys(value, ['type', 'value']) && typeof value.value === 'string') {
        if (value.type === 'integer' && /^-?(?:0|[1-9]\d*)$/.test(value.value) && value.value.length <= 21) {
            const integer = BigInt(value.value);
            if (integer >= -(2n ** 63n) && integer < 2n ** 63n) return integer;
        }
        if (value.type === 'blob' && Buffer.from(value.value, 'base64').toString('base64') === value.value) return Buffer.from(value.value, 'base64');
    }
    fail('Invalid database cell.');
}

function validateJson(value, depth = 0, budget = { nodes: 0 }) {
    if (++budget.nodes > 1_000_000 || depth > 64) fail('Backup data is too deeply nested or too large.');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object') fail('Invalid JSON value.');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Invalid JSON object.');
    for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Unsafe JSON key.');
        validateJson(item, depth + 1, budget);
    }
}

function safeDefault(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 1024 || value.includes('\0')) fail('Invalid default value.');
    if (/^(?:NULL|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i.test(value) ||
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
        /^'(?:[^']|'')*'$/.test(value)) return value;
    fail('Executable SQL is not accepted in backup metadata.');
}

function validateTable(table) {
    if (!ownKeys(table, ['name', 'columns', 'uniqueKeys', 'rows', 'rowCount', 'sha256']) || !SQL_TABLES.includes(table.name)) fail('Unknown backup table.');
    const expected = TABLE_COLUMNS[table.name];
    if (!Array.isArray(table.columns) || table.columns.length !== expected.length) fail('Unexpected table columns.');
    const names = table.columns.map(column => column.name);
    if (new Set(names).size !== names.length || expected.some(name => !names.includes(name))) fail('Unexpected table columns.');
    for (const column of table.columns) {
        if (!ownKeys(column, ['name', 'type', 'notNull', 'defaultValue', 'primaryKey']) || !identifier(column.name) ||
            !['', 'INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC', 'DATETIME'].includes(column.type) ||
            typeof column.notNull !== 'boolean' || !Number.isInteger(column.primaryKey) || column.primaryKey < 0 || column.primaryKey > expected.length) fail('Invalid column metadata.');
        safeDefault(column.defaultValue);
    }
    const primary = table.columns.filter(column => column.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey);
    if (canonical(primary.map(column => column.name)) !== canonical(PRIMARY_KEYS[table.name]) ||
        primary.some((column, index) => column.primaryKey !== index + 1)) fail('Invalid primary key metadata.');
    if (AUTO_TABLES.has(table.name) && primary[0].type !== 'INTEGER') fail('Invalid auto-increment key.');
    if (!Array.isArray(table.uniqueKeys) || table.uniqueKeys.length > 16) fail('Invalid unique keys.');
    const keySignatures = new Set();
    for (const key of table.uniqueKeys) {
        if (!Array.isArray(key) || !key.length || new Set(key).size !== key.length || key.some(column => !expected.includes(column))) fail('Invalid unique key columns.');
        if (keySignatures.has(canonical(key))) fail('Duplicate unique keys.');
        keySignatures.add(canonical(key));
    }
    if (!Array.isArray(table.rows) || table.rowCount !== table.rows.length || table.rows.length > 500_000) fail('Invalid row count.');
    for (const row of table.rows) {
        if (!Array.isArray(row) || row.length !== names.length) fail('Invalid row shape.');
        row.forEach(decodeCell);
    }
    if (table.sha256 !== digest(table.rows)) fail('Table data checksum mismatch.');
}

async function captureTable(tx, name) {
    const meta = await tx.execute(`PRAGMA table_info(${quote(name)})`);
    if (!meta.rows.length) fail(`Required table is missing: ${name}.`);
    const columns = meta.rows.map(column => ({ name: String(column.name), type: String(column.type || '').toUpperCase(),
        notNull: Number(column.notnull) === 1, defaultValue: column.dflt_value === null ? null : String(column.dflt_value), primaryKey: Number(column.pk) }));
    const uniqueKeys = [];
    const indexes = await tx.execute(`PRAGMA index_list(${quote(name)})`);
    for (const index of indexes.rows) {
        if (!Number(index.unique) || index.origin === 'pk') continue;
        if (Number(index.partial)) fail('Partial unique indexes require a newer backup format.');
        const info = await tx.execute(`PRAGMA index_xinfo(${quote(String(index.name))})`);
        const keys = info.rows.filter(column => Number(column.key) === 1);
        if (!keys.length || keys.some(column => Number(column.cid) < 0 || column.coll !== 'BINARY')) fail('Expression or non-binary indexes require a newer backup format.');
        uniqueKeys.push(keys.sort((a, b) => Number(a.seqno) - Number(b.seqno)).map(column => String(column.name)));
    }
    uniqueKeys.sort((a, b) => canonical(a).localeCompare(canonical(b)));
    // Verify the complete schema before selecting any row values. Unexpected
    // future columns need a reviewed format update, not an accidental export.
    validateTable({ name, columns, uniqueKeys, rows: [], rowCount: 0, sha256: digest([]) });
    const primary = [...columns].filter(column => column.primaryKey).sort((a, b) => a.primaryKey - b.primaryKey);
    const records = await tx.execute(`SELECT ${columns.map(column => quote(column.name)).join(',')} FROM ${quote(name)} ORDER BY ${primary.map(column => quote(column.name)).join(',')}`);
    const rows = records.rows.map(row => columns.map(column => encodeCell(row[column.name])));
    const table = { name, columns, uniqueKeys, rows, rowCount: rows.length, sha256: digest(rows) };
    validateTable(table);
    return table;
}

async function createSystemBackup({ db, readRTDB, ready, now = () => new Date().toISOString() }) {
    if (!db || typeof readRTDB !== 'function') fail('Database and Firebase access are both required.');
    await db.ready;
    await ready;
    const captureStartedAt = now();
    const tx = await db.transaction('read');
    let database;
    try {
        const tables = [];
        for (const name of SQL_TABLES) tables.push(await captureTable(tx, name));
        const sequences = (await tx.execute({ sql: `SELECT name, seq FROM sqlite_sequence WHERE name IN (${[...AUTO_TABLES].map(() => '?').join(',')}) ORDER BY name`, args: [...AUTO_TABLES] })).rows
            .map(row => ({ name: String(row.name), seq: encodeCell(row.seq) }));
        database = { tables, sequences };
        await tx.commit();
    } catch (error) {
        if (!tx.closed) await tx.rollback();
        throw error;
    } finally { tx.close(); }
    const outcomes = await Promise.allSettled(RTDB_PATHS.map(async location => {
        let timer;
        let value;
        try {
            value = await Promise.race([Promise.resolve().then(() => readRTDB(location)), new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Firebase backup read timed out.')), 15_000);
                timer.unref?.();
            })]);
        } finally { clearTimeout(timer); }
        if (value === undefined) fail('Firebase did not return a verifiable snapshot.');
        validateJson(value);
        if (location === 'roles' && (!isObject(value) && !Array.isArray(value))) fail('The expected role source is missing.');
        return { path: location, exists: value !== null, value, sha256: digest(value) };
    }));
    if (outcomes.some(outcome => outcome.status !== 'fulfilled')) fail('One or more Firebase paths could not be backed up; no complete backup was produced.');
    const bundle = { format: FORMAT, version: 1, captureStartedAt, createdAt: now(),
        scope: { sqlTables: SQL_TABLES, rtdbPaths: RTDB_PATHS, excludes: EXCLUDES,
            consistency: 'SQL transaction snapshot; Firebase paths captured individually, not an atomic cross-service snapshot.' },
        database, firebase: { paths: outcomes.map(outcome => outcome.value) } };
    const result = { ...bundle, checksum: { algorithm: 'sha256', value: digest(bundle) } };
    validateSystemBackup(result);
    return result;
}

function validateSystemBackup(bundle) {
    validateJson(bundle);
    if (Buffer.byteLength(JSON.stringify(bundle)) > MAX_BACKUP_BYTES) fail('Backup exceeds the supported size.');
    if (!ownKeys(bundle, ['format', 'version', 'captureStartedAt', 'createdAt', 'scope', 'database', 'firebase', 'checksum']) ||
        bundle.format !== FORMAT || bundle.version !== 1 || !Number.isFinite(Date.parse(bundle.createdAt)) || !Number.isFinite(Date.parse(bundle.captureStartedAt))) fail('Unsupported backup format.');
    if (!ownKeys(bundle.scope, ['sqlTables', 'rtdbPaths', 'excludes', 'consistency']) ||
        canonical(bundle.scope.sqlTables) !== canonical(SQL_TABLES) || canonical(bundle.scope.rtdbPaths) !== canonical(RTDB_PATHS) ||
        canonical(bundle.scope.excludes) !== canonical(EXCLUDES)) fail('Backup scope does not match this restore version.');
    if (!ownKeys(bundle.checksum, ['algorithm', 'value']) || bundle.checksum.algorithm !== 'sha256') fail('Invalid checksum metadata.');
    const { checksum, ...unsigned } = bundle;
    if (checksum.value !== digest(unsigned)) fail('Backup checksum mismatch.');
    if (!ownKeys(bundle.database, ['tables', 'sequences']) || !Array.isArray(bundle.database.tables) ||
        canonical(bundle.database.tables.map(table => table.name)) !== canonical(SQL_TABLES)) fail('Incomplete SQL scope.');
    bundle.database.tables.forEach(validateTable);
    if (!Array.isArray(bundle.database.sequences) || bundle.database.sequences.length > AUTO_TABLES.size) fail('Invalid sequence metadata.');
    const seenSequences = new Set();
    for (const sequence of bundle.database.sequences) {
        if (!ownKeys(sequence, ['name', 'seq']) || !AUTO_TABLES.has(sequence.name) || seenSequences.has(sequence.name)) fail('Invalid sequence metadata.');
        const value = decodeCell(sequence.seq);
        if (!['number', 'bigint'].includes(typeof value) || value < 0 || (typeof value === 'number' && !Number.isSafeInteger(value))) fail('Invalid sequence value.');
        seenSequences.add(sequence.name);
    }
    if (!ownKeys(bundle.firebase, ['paths']) || !Array.isArray(bundle.firebase.paths) ||
        canonical(bundle.firebase.paths.map(entry => entry.path)) !== canonical(RTDB_PATHS)) fail('Incomplete Firebase scope.');
    for (const entry of bundle.firebase.paths) {
        if (!ownKeys(entry, ['path', 'exists', 'value', 'sha256']) || entry.exists !== (entry.value !== null) || entry.sha256 !== digest(entry.value)) fail('Firebase checksum mismatch.');
        if (entry.path === 'roles' && (!isObject(entry.value) && !Array.isArray(entry.value))) fail('The expected role source is missing.');
    }
    return { tables: SQL_TABLES.length, rows: bundle.database.tables.reduce((n, table) => n + table.rowCount, 0),
        firebasePaths: RTDB_PATHS.length, checksum: checksum.value };
}

function createTableStatement(table) {
    const auto = AUTO_TABLES.has(table.name);
    const definitions = table.columns.map(column => `${quote(column.name)} ${column.type}${auto && column.name === 'id' ? ' PRIMARY KEY AUTOINCREMENT' : ''}${column.notNull ? ' NOT NULL' : ''}${column.defaultValue === null ? '' : ` DEFAULT ${safeDefault(column.defaultValue)}`}`);
    if (!auto) definitions.push(`PRIMARY KEY (${PRIMARY_KEYS[table.name].map(quote).join(',')})`);
    if (table.name === 'activities') definitions.push("CHECK (\"type\" IN ('record','plan'))");
    table.uniqueKeys.forEach(key => definitions.push(`UNIQUE (${key.map(quote).join(',')})`));
    return `CREATE TABLE ${quote(table.name)} (${definitions.join(',')})`;
}

function firebaseTree(entries) {
    const tree = Object.create(null);
    for (const entry of entries) {
        if (!entry.exists) continue;
        const segments = entry.path.split('/');
        let parent = tree;
        for (const segment of segments.slice(0, -1)) parent = parent[segment] ||= Object.create(null);
        parent[segments.at(-1)] = entry.value;
    }
    return tree;
}

async function restoreBackupToDirectory(bundle, destination) {
    const summary = validateSystemBackup(bundle);
    if (typeof destination !== 'string' || !path.isAbsolute(destination) || destination.includes('\0') || /^\w+:/.test(destination)) fail('Restore destination must be a new absolute local directory.');
    const directory = path.resolve(destination);
    if (directory === path.parse(directory).root) fail('Cannot restore to the filesystem root.');
    await mkdir(directory, { mode: 0o700 }); // Atomic refusal for existing directories, files and symlinks.
    const databasePath = path.join(directory, 'itrc.sqlite');
    let db;
    let success = false;
    try {
        db = createClient({ url: pathToFileURL(databasePath).href, intMode: 'bigint' });
        const tx = await db.transaction('write');
        try {
            for (const table of bundle.database.tables) {
                await tx.execute(createTableStatement(table));
                const sql = `INSERT INTO ${quote(table.name)} (${table.columns.map(column => quote(column.name)).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`;
                for (const row of table.rows) await tx.execute({ sql, args: row.map(decodeCell) });
            }
            for (const sequence of bundle.database.sequences) {
                await tx.execute({ sql: 'DELETE FROM sqlite_sequence WHERE name=?', args: [sequence.name] });
                await tx.execute({ sql: 'INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)', args: [sequence.name, decodeCell(sequence.seq)] });
            }
            await tx.commit();
        } catch (error) {
            if (!tx.closed) await tx.rollback();
            throw error;
        } finally { tx.close(); }
        // Use the original representation for safe integer cells when the source
        // exported numbers. Large integer tags remain lossless.
        for (const table of bundle.database.tables) {
            const rows = (await db.execute(`SELECT ${table.columns.map(column => quote(column.name)).join(',')} FROM ${quote(table.name)} ORDER BY ${PRIMARY_KEYS[table.name].map(quote).join(',')}`)).rows;
            const encoded = rows.map((row, i) => table.columns.map((column, j) => {
                const value = row[column.name];
                return typeof value === 'bigint' && typeof table.rows[i]?.[j] === 'number' ? Number(value) : encodeCell(value);
            }));
            if (digest(encoded) !== table.sha256) fail(`Restored data did not match: ${table.name}.`);
        }
        for (const sequence of bundle.database.sequences) {
            const actual = (await db.execute({ sql: 'SELECT seq FROM sqlite_sequence WHERE name=?', args: [sequence.name] })).rows[0]?.seq;
            if (BigInt(actual ?? -1) !== BigInt(decodeCell(sequence.seq))) fail('Restored auto-increment sequence did not match.');
        }
        // No one-use OAuth callback can be replayed, and restored external tokens
        // cannot silently resume when this inspection copy is later opened.
        await db.executeMultiple('CREATE TABLE ops_oauth_states (state_hash TEXT PRIMARY KEY, actor_email TEXT NOT NULL, sealed TEXT NOT NULL, expires_at INTEGER NOT NULL); CREATE TABLE ops_connection_intent (provider TEXT PRIMARY KEY, state_hash TEXT NOT NULL); CREATE INDEX ops_audit_created ON ops_audit(created_at DESC);');
        const paused = await db.execute("UPDATE ops_credentials SET status='needs_reconnect', owner=NULL, lease_until=NULL");
        db.close(); db = undefined;
        await chmod(databasePath, 0o600);
        const tree = firebaseTree(bundle.firebase.paths);
        const firebasePath = path.join(directory, 'firebase-rtdb.json');
        await writeFile(firebasePath, JSON.stringify(tree, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        const manifest = { ...summary, restoredAt: new Date().toISOString(), sourceCreatedAt: bundle.createdAt,
            isolated: true, remoteWrites: false, sqlDataVerifiedBeforeCredentialPause: true,
            credentialRowsPaused: Number(paused.rowsAffected), oauthStateRestored: false,
            firebaseSha256: digest(tree), excludes: EXCLUDES };
        await writeFile(path.join(directory, 'restore-verification.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        success = true;
        return { ...manifest, directory };
    } finally {
        db?.close();
        if (!success) {
            for (const filename of ['itrc.sqlite', 'itrc.sqlite-wal', 'itrc.sqlite-shm', 'itrc.sqlite-journal', 'firebase-rtdb.json', 'restore-verification.json']) {
                await unlink(path.join(directory, filename)).catch(() => {});
            }
            await rmdir(directory).catch(() => {});
        }
    }
}

module.exports = { SQL_TABLES, TABLE_COLUMNS, RTDB_PATHS, EXCLUDES, MAX_BACKUP_BYTES,
    createSystemBackup, validateSystemBackup, restoreBackupToDirectory, canExportSystemBackup,
    digest, encodeCell, decodeCell };
