const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');
const { listMembers, setMemberArchived, canManageRoster } = require('./member-directory');

test('retired members leave the public list while preserving their id and recoverable history', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'itrc-member-test-'));
    const db = createClient({ url: `file:${join(dir, 'test.db')}` });
    t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
    await db.execute('CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT, role TEXT, department TEXT, year TEXT, avatar_url TEXT, order_num INTEGER, archived_at TEXT, email TEXT)');
    await db.execute("INSERT INTO members VALUES(7,'Fictional','行銷',NULL,NULL,NULL,0,NULL,'private@example.invalid')");
    await setMemberArchived(db, 7, true, () => '2026-10-26T00:00:00Z');
    assert.equal((await listMembers(db)).length, 0);
    const archived = await listMembers(db, { includeArchived: true });
    assert.equal(archived[0].id, 7);
    assert.equal(archived[0].archived_at, '2026-10-26T00:00:00Z');
    assert.equal(archived[0].email, undefined);
    await setMemberArchived(db, 7, false);
    assert.equal((await listMembers(db))[0].id, 7);
    await assert.rejects(setMemberArchived(db, '7 OR 1=1', true));
});

test('only existing roster managers can archive or restore public officers', () => {
    for (const role of ['officer', 'treasurer', '', undefined]) assert.equal(canManageRoster({ role }), false);
    for (const role of ['advisor', 'chair', 'admin']) assert.equal(canManageRoster({ role }), true);
});
