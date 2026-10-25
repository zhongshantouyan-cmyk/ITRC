'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createClient } = require('@libsql/client');
const { createSystemBackup, validateSystemBackup, restoreBackupToDirectory, canExportSystemBackup,
    SQL_TABLES, RTDB_PATHS, digest } = require('./system-backup');
const { createSystemBackupRouter } = require('./routes/system-backup');

async function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'itrc-system-backup-test-'));
    const db = createClient({ url: `file:${join(directory, 'source.sqlite')}` });
    t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
    // Build the real application's schema, never import its production database.
    for (const file of ['db.js', 'ops/store.js', 'ops-connection.js']) {
        const source = readFileSync(join(__dirname, file), 'utf8');
        const match = /db\.executeMultiple\(`([\s\S]*?)`\)/.exec(source);
        assert.ok(match, `Schema fixture exists for ${file}`);
        await db.executeMultiple(match[1]);
    }
    await db.execute("INSERT INTO users(username,password_hash) VALUES('fictional-owner','fictional-password-hash')");
    await db.execute("INSERT INTO sections(key,title,content) VALUES('course_info','Fictional course','{}')");
    await db.execute("INSERT INTO members(name,role,archived_at) VALUES('Fictional former member','行銷','2026-10-26T00:00:00Z')");
    await db.execute("INSERT INTO activities(type,semester,title,date) VALUES('plan','115-1','Fictional test class','2026-11-11')");
    await db.execute({ sql: 'INSERT INTO ops_records VALUES(?,?,?,?)', args: ['tasks', 'task-test', 3, JSON.stringify({ id: 'task-test', status: 'review', resultUrl: 'https://example.invalid/result' })] });
    await db.execute("INSERT INTO ops_credentials VALUES('canva','fictional-sealed-value','active','fictional-lease',42,'2026-10-26T00:00:00Z')");
    await db.execute("INSERT INTO ops_oauth_states VALUES('discard-me','fictional@example.invalid','one-use-secret',42)");
    await db.execute("INSERT INTO ops_connection_intent VALUES('canva','discard-me')");
    await db.execute("UPDATE sqlite_sequence SET seq=99 WHERE name='members'");
    const data = Object.fromEntries(RTDB_PATHS.map(location => [location, null]));
    data.roles = { fictional: { name: 'Fictional', email: 'fictional@example.invalid', role: 'advisor' } };
    data['boards/itrc'] = { tasks: [{ id: 'fictional-task', done: false }] };
    data['finance/ledger'] = { fictional: { income: 0, expense: 20, description: 'Fictional expense' } };
    data['finance/reimbursements'] = { fictional: { amount: 20, status: 'submitted' } };
    const readRTDB = async location => structuredClone(data[location]);
    return { db, directory, data, readRTDB };
}

function resign(bundle) {
    const { checksum: _old, ...unsigned } = bundle;
    bundle.checksum = { algorithm: 'sha256', value: digest(unsigned) };
    return bundle;
}

test('full fixed-scope bundle restores fictional CMS, workflow and RTDB without reactivating tokens', async t => {
    const { db, directory, data, readRTDB } = await fixture(t);
    const bundle = await createSystemBackup({ db, readRTDB });
    assert.equal(validateSystemBackup(bundle).tables, SQL_TABLES.length);
    assert.equal(bundle.firebase.paths.length, RTDB_PATHS.length);
    assert.equal(JSON.stringify(bundle).includes('one-use-secret'), false);
    assert.equal(JSON.stringify(bundle.database).includes('ops_oauth_states'), false);
    assert.equal(bundle.database.tables.find(table => table.name === 'members').rows[0].at(-1), '2026-10-26T00:00:00Z');
    const restored = await restoreBackupToDirectory(bundle, join(directory, 'restored'));
    assert.equal(restored.remoteWrites, false);
    assert.equal(restored.sqlDataVerifiedBeforeCredentialPause, true);
    assert.equal(restored.credentialRowsPaused, 1);
    const local = createClient({ url: `file:${join(restored.directory, 'itrc.sqlite')}` });
    t.after(() => local.close());
    assert.equal((await local.execute('SELECT title FROM sections')).rows[0].title, 'Fictional course');
    assert.equal((await local.execute('SELECT version FROM ops_records')).rows[0].version, 3);
    const credentials = (await local.execute('SELECT * FROM ops_credentials')).rows[0];
    assert.equal(credentials.sealed, 'fictional-sealed-value');
    assert.equal(credentials.status, 'needs_reconnect');
    assert.equal(credentials.owner, null);
    assert.equal((await local.execute('SELECT COUNT(*) AS n FROM ops_oauth_states')).rows[0].n, 0);
    assert.equal((await local.execute('SELECT COUNT(*) AS n FROM ops_connection_intent')).rows[0].n, 0);
    assert.equal((await local.execute("SELECT seq FROM sqlite_sequence WHERE name='members'")).rows[0].seq, 99);
    await assert.rejects(local.execute("INSERT INTO users(username,password_hash) VALUES('fictional-owner','another')"), /UNIQUE/);
    await assert.rejects(local.execute("INSERT INTO sections(key,title,content) VALUES('new',NULL,'x')"), /NOT NULL/);
    await assert.rejects(local.execute("INSERT INTO activities(type,semester,title) VALUES('unsupported','115-1','x')"), /CHECK/);
    const tree = JSON.parse(await fs.readFile(join(restored.directory, 'firebase-rtdb.json'), 'utf8'));
    assert.deepEqual(tree.finance.ledger, data['finance/ledger']);
    assert.deepEqual(tree.boards.itrc, data['boards/itrc']);
    assert.deepEqual(tree.roles, data.roles);
    const mode = (await fs.stat(join(restored.directory, 'firebase-rtdb.json'))).mode & 0o777;
    assert.equal(mode, 0o600);
});

test('backup rejects missing SQL scope, absent Firebase adapter and any failed Firebase path', async t => {
    const { db, readRTDB } = await fixture(t);
    await assert.rejects(createSystemBackup({ db }), /both required/);
    await assert.rejects(createSystemBackup({ db, readRTDB: async location => {
        if (location === 'finance/ledger') throw new Error('private failure details must not escape the HTTP route');
        return readRTDB(location);
    } }), /no complete backup/);
    await assert.rejects(createSystemBackup({ db, readRTDB: async () => null }), /no complete backup/);
    await db.execute('DROP TABLE ops_audit');
    await assert.rejects(createSystemBackup({ db, readRTDB }), /Required table is missing/);
});

test('tampering with SQL or Firebase data fails checksums', async t => {
    const { db, readRTDB } = await fixture(t);
    const original = await createSystemBackup({ db, readRTDB });
    const sql = structuredClone(original);
    sql.database.tables.find(table => table.name === 'sections').rows[0][2] = 'Changed';
    assert.throws(() => validateSystemBackup(sql), /checksum mismatch/);
    const firebase = structuredClone(original);
    firebase.firebase.paths.find(entry => entry.path === 'finance/ledger').value.fictional.expense = 999;
    assert.throws(() => validateSystemBackup(firebase), /checksum mismatch/);
    const internallyAltered = resign(sql);
    assert.throws(() => validateSystemBackup(internallyAltered), /Table data checksum/);
});

test('even a recomputed checksum cannot turn schema metadata into executable SQL', async t => {
    const { db, readRTDB } = await fixture(t);
    const original = await createSystemBackup({ db, readRTDB });
    for (const mutate of [
        bundle => { bundle.database.tables[0].name = 'users; ATTACH DATABASE'; },
        bundle => { bundle.database.tables[0].columns[0].type = 'INTEGER); ATTACH DATABASE'; },
        bundle => { bundle.database.tables[0].columns[1].name = 'username"; DELETE'; },
        bundle => { bundle.database.tables[0].columns[1].defaultValue = '(SELECT load_extension(1))'; },
        bundle => { bundle.database.tables[0].uniqueKeys = [['username); DROP TABLE users']]; },
        bundle => { bundle.database.tables[0].sql = 'DROP TABLE users'; },
    ]) {
        const changed = structuredClone(original);
        mutate(changed);
        resign(changed);
        assert.throws(() => validateSystemBackup(changed));
    }
});

test('isolated restoration refuses a remote URL, existing directory, file or symlink', async t => {
    const { db, readRTDB, directory } = await fixture(t);
    const bundle = await createSystemBackup({ db, readRTDB });
    await assert.rejects(restoreBackupToDirectory(bundle, 'libsql://production.example.invalid'), /absolute local directory/);
    await assert.rejects(restoreBackupToDirectory(bundle, directory), /EEXIST/);
    const existing = join(directory, 'keep.txt');
    await fs.writeFile(existing, 'keep');
    await assert.rejects(restoreBackupToDirectory(bundle, existing), /EEXIST/);
    assert.equal(await fs.readFile(existing, 'utf8'), 'keep');
    const link = join(directory, 'link');
    await fs.symlink(directory, link);
    await assert.rejects(restoreBackupToDirectory(bundle, link), /EEXIST/);
    assert.equal(existsSync(join(directory, 'source.sqlite')), true);
});

test('backup route rejects non-custodians and never returns partial results or private errors', async t => {
    const { db, readRTDB } = await fixture(t);
    for (const role of ['chair', 'treasurer', 'officer', 'admin', '']) assert.equal(canExportSystemBackup({ role }), false);
    assert.equal(canExportSystemBackup({ role: 'advisor' }), true);
    assert.equal(canExportSystemBackup({ superAdmin: true }), true);
    const router = createSystemBackupRouter({ db, readRTDB: async () => { throw new Error('private-token-value'); }, authMiddleware: (_req, _res, next) => next() });
    const handler = router.stack.find(layer => layer.route?.path === '/export').route.stack.at(-1).handle;
    const response = () => ({ statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
    const denied = response();
    await handler({ user: { role: 'officer' } }, denied);
    assert.equal(denied.statusCode, 403);
    const failed = response();
    await handler({ user: { role: 'advisor' } }, failed);
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(Object.keys(failed.body), ['error']);
    assert.equal(JSON.stringify(failed.body).includes('private-token-value'), false);
    assert.equal(failed.headers['Content-Disposition'], undefined);
});

test('browser export returns one verified JSON attachment, with transparent gzip encoding', async t => {
    const { gunzipSync } = require('node:zlib');
    const { db, readRTDB } = await fixture(t);
    const router = createSystemBackupRouter({ db, readRTDB, authMiddleware: (_req, _res, next) => next() });
    const handler = router.stack.find(layer => layer.route?.path === '/export').route.stack.at(-1).handle;
    const res = { headers: {}, set(name, value) { this.headers[name] = value; return this; },
        type(value) { this.contentType = value; return this; }, send(value) { this.body = value; return this; } };
    await handler({ user: { role: 'advisor' }, headers: { 'accept-encoding': 'gzip, deflate, br' } }, res);
    assert.equal(res.headers['Content-Encoding'], 'gzip');
    assert.match(res.headers['Content-Disposition'], /^attachment; filename="ITRC-system-data-backup-\d{8}\.json"$/);
    const restored = JSON.parse(gunzipSync(res.body));
    assert.equal(validateSystemBackup(restored).tables, SQL_TABLES.length);
});
