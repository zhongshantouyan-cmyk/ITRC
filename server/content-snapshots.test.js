const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');
const { CONTENT_COLUMNS, createSnapshot, restoreSnapshot, canRestoreSnapshot } = require('./content-snapshots');

test('bulk restore requires an administrative role', () => {
    for (const role of ['officer', 'treasurer', '', undefined]) assert.equal(canRestoreSnapshot({ role }), false);
    for (const role of ['chair', 'advisor', 'admin']) assert.equal(canRestoreSnapshot({ role }), true);
});

async function fixture(t) {
    const dir = mkdtempSync(join(tmpdir(), 'itrc-cms-backup-test-'));
    const db = createClient({ url: `file:${join(dir, 'test.db')}` });
    t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
    for (const [table, columns] of Object.entries(CONTENT_COLUMNS)) {
        await db.execute(`CREATE TABLE ${table} (${columns.map(column => column === 'id' ? 'id INTEGER PRIMARY KEY' : `${column} TEXT`).join(', ')})`);
    }
    await db.execute('CREATE TABLE content_snapshots (id INTEGER PRIMARY KEY, snapshot_data TEXT, description TEXT, created_by TEXT, is_auto INTEGER, created_at TEXT)');
    await db.execute('CREATE TABLE ops_private (id INTEGER PRIMARY KEY, secret TEXT)');
    await db.execute("INSERT INTO ops_private VALUES (1, 'fictional-private-value')");
    await db.execute("INSERT INTO sections (id, key, title, content) VALUES (1, 'home', 'Before', 'old')");
    await db.execute("INSERT INTO online_resources (id, name, url) VALUES (1, 'Resource', 'https://example.invalid')");
    return db;
}

test('CMS snapshot includes resource tables without including ops or future private member fields', async t => {
    const db = await fixture(t);
    await db.execute('ALTER TABLE members ADD COLUMN email TEXT');
    await db.execute("INSERT INTO members (id, name, email) VALUES (1, 'Fictional', 'private@example.invalid')");
    const id = await createSnapshot(db, 'test');
    const data = JSON.parse((await db.execute({ sql: 'SELECT snapshot_data FROM content_snapshots WHERE id = ?', args: [id] })).rows[0].snapshot_data);
    assert.equal(data.online_resources[0].name, 'Resource');
    assert.equal(data.members[0].email, undefined);
    assert.equal(data.ops_private, undefined);
});

test('restore is atomic when a later INSERT fails, including rollback of pre-restore snapshot', async t => {
    const db = await fixture(t);
    const broken = { sections: [{ id: 2, key: 'changed', title: 'Changed', content: 'new' }],
        achievements: [{ id: 1, title: 'one' }, { id: 1, title: 'duplicate' }] };
    await db.execute({ sql: 'INSERT INTO content_snapshots (id, snapshot_data) VALUES (1, ?)', args: [JSON.stringify(broken)] });
    await assert.rejects(restoreSnapshot(db, 1));
    assert.equal((await db.execute('SELECT title FROM sections')).rows[0].title, 'Before');
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM content_snapshots')).rows[0].n, 1);
    assert.equal((await db.execute('SELECT secret FROM ops_private')).rows[0].secret, 'fictional-private-value');
});

test('old snapshot restores only included tables and preserves resources', async t => {
    const db = await fixture(t);
    await db.execute({ sql: 'INSERT INTO content_snapshots (id, snapshot_data) VALUES (1, ?)',
        args: [JSON.stringify({ sections: [{ id: 3, key: 'home', title: 'Restored', content: 'new' }] })] });
    const result = await restoreSnapshot(db, 1);
    assert.deepEqual(result.restoredTables, ['sections']);
    assert.ok(result.preservedTables.includes('online_resources'));
    assert.equal((await db.execute('SELECT name FROM online_resources')).rows[0].name, 'Resource');
    assert.equal((await db.execute('SELECT title FROM sections')).rows[0].title, 'Restored');
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM content_snapshots')).rows[0].n, 2);
});

test('restore rejects unknown tables and column names before any deletion', async t => {
    const db = await fixture(t);
    for (const data of [{ users: [] }, { sections: [{ 'id) VALUES (1); --': 1 }] }]) {
        await db.execute({ sql: 'INSERT OR REPLACE INTO content_snapshots (id, snapshot_data) VALUES (1, ?)', args: [JSON.stringify(data)] });
        await assert.rejects(restoreSnapshot(db, 1), /未允許|不支援/);
        assert.equal((await db.execute('SELECT title FROM sections')).rows[0].title, 'Before');
    }
});


test('restoring a legacy snapshot does not reactivate a currently archived officer', async t => {
    const db = await fixture(t);
    await db.execute("INSERT INTO members (id, name, archived_at) VALUES (7, 'Fictional retired', '2026-10-26')");
    await db.execute({ sql:'INSERT INTO content_snapshots (id,snapshot_data) VALUES (10,?)',
        args:[JSON.stringify({members:[{id:7,name:'Fictional old name'}]})] });
    await restoreSnapshot(db, 10);
    assert.equal((await db.execute('SELECT archived_at FROM members WHERE id=7')).rows[0].archived_at, '2026-10-26');
});
