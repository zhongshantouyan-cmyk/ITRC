'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { createClient } = require('../server/node_modules/@libsql/client');
const { createSystemBackup, RTDB_PATHS } = require('../server/system-backup');
const { createOpsService } = require('../server/ops/service');
const { digest } = require('./prepare-legacy-board-import.cjs');
const { API_BASE, parseArgs, privateDirectory, readToken, apiClient, runMigration, snapshot } = require('./migrate-legacy-board.cjs');
const { verifyDirectory } = require('./verify-legacy-board-migration.cjs');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'itrc-legacy-migration-'));
  execFileSync('git', ['init', '-q', root]);
  const db = createClient({ url: 'file:' + path.join(root, 'source.sqlite') });
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  // Use the real schemas and reducers with fictional data in a fresh local DB.
  for (const file of ['db.js', 'ops/store.js', 'ops-connection.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../server', file), 'utf8');
    const schema = /db\.executeMultiple\(`([\s\S]*?)`\)/.exec(source);
    assert.ok(schema, file); await db.executeMultiple(schema[1]);
  }
  const put = async (kind, value) => db.execute({ sql: 'INSERT INTO ops_records(kind,id,version,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,data=excluded.data', args: [kind, value.id, value.version, JSON.stringify(value)] });
  const actor = { uid: 'fictional-advisor', email: 'fixture@example.invalid', name: 'Fictional Advisor', role: 'advisor' };
  const people = [
    { id: 'ITRC-P0001', personId: 'ITRC-P0001', version: 1, name: 'Active Member', email: actor.email, status: 'active' },
    { id: 'ITRC-P0002', personId: 'ITRC-P0002', version: 1, name: 'Retired Member', email: 'retired@example.invalid', status: 'retired' },
  ];
  for (const person of people) await put('people', person);
  for (const id of ['general-a', 'general-b']) await put('tasks', { id, version: 3, title: `Fictional ${id}`, status: 'todo', notes: 'Preserve this task', sourceKey: `gdrive:fixture:task:${id}` });
  const board = { v: 1, events: [{ id: 'old-event' }], lists: [
    { id: 'todo', title: '待辦', cards: Array.from({ length: 15 }, (_, i) => ({ id: `old-${i}`, title: `Fictional legacy ${i}`, due: '2026-11-01', note: `Original note ${i}`, who: i % 3 === 0 ? 'Retired Member' : 'Active Member', group: '活動組', wid: 'old-event' })) },
    { id: 'doing', title: '進行中', cards: [{ id: 'old-15', title: 'Fictional in progress', who: 'Unknown Member' }] },
    { id: 'done', title: '完成', cards: [{ id: 'old-16', title: 'Fictional complete', who: 'Active Member' }] },
  ] };
  const data = Object.fromEntries(RTDB_PATHS.map(location => [location, null]));
  data.roles = { fixture: { email: actor.email, role: 'advisor' } }; data['boards/itrc'] = board;
  const service = createOpsService({ db, env: {}, providers: { getIntegrationStatus: () => ({}) } });
  await service.ready;
  const calls = [];
  const backup = () => createSystemBackup({ db, ready: service.ready, readRTDB: async location => structuredClone(data[location]) });
  const api = async (endpoint, body) => {
    calls.push({ endpoint, body: body ? structuredClone(body) : undefined });
    if (endpoint === '/system-backup/export') return backup();
    if (endpoint === '/ops/bootstrap') return service.bootstrap(actor);
    if (endpoint === '/ops/actions') return service.action(actor, body);
    throw new Error('Unexpected test endpoint');
  };
  return { root, db, people, put, actor, board, data, service, backup, api, calls, directory: name => privateDirectory(root, name) };
}

test('default previews current source, preserves two general tasks and proves isolated recovery without applying', async t => {
  const f = await fixture(t), directory = f.directory('preview');
  const originalBoard = digest(f.board);
  const result = await runMigration({ api: f.api, directory });
  assert.equal(result.status, 'preview_only');
  assert.equal(result.businessApplyAttempted, false);
  assert.equal(result.newTasks, 17); assert.equal(result.duplicates, 0);
  assert.equal((await f.service.store.read()).tasks.length, 2);
  assert.equal(digest(f.board), originalBoard);
  assert.deepEqual(f.calls.filter(call => call.body).map(call => call.body.action), ['import.preview']);
  assert.ok(fs.existsSync(path.join(directory, 'isolated-restore/itrc.sqlite')));
  assert.equal(fs.statSync(path.join(directory, 'before-backup.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  execFileSync('git', ['check-ignore', '--quiet', path.join(directory, 'before-backup.json')], { cwd: f.root });
  assert.deepEqual(verifyDirectory(directory), { ok: true, status: 'preview_only', applied: false, newTasks: 17, duplicates: 0, fieldsVerified: 17 });
});

test('real isolated store applies 17, verifies each field, preserves existing tasks and uses fresh keys for duplicate apply', async t => {
  const f = await fixture(t), directory = f.directory('apply');
  const result = await runMigration({ api: f.api, directory, apply: true });
  assert.equal(result.status, 'applied_and_verified');
  assert.equal(result.imported, 17); assert.equal(result.readbackPresenceVerified, 17); assert.equal(result.newRecordsFieldsVerified, 17);
  assert.equal(result.existingLegacyRecordsPreserved, 0); assert.deepEqual(result.sourceFieldDifferences, []);
  assert.equal(result.existingTasksPreserved, 2); assert.equal(result.repeatImported, 0); assert.equal(result.repeatDuplicates, 17);
  assert.deepEqual(result.statusCounts, { todo: 15, doing: 1, done: 1 });
  const applies = f.calls.filter(call => call.body?.action === 'import.apply');
  assert.equal(applies.length, 2); assert.notEqual(applies[0].body.idempotencyKey, applies[1].body.idempotencyKey);
  const state = await f.service.store.read(); assert.equal(state.tasks.length, 19);
  const done = state.tasks.find(task => task.sourceKey?.endsWith(':old-16'));
  assert.equal(done.completionMode, 'imported_status'); assert.equal(done.completedAt, undefined); assert.equal(done.completedBy, undefined);
  assert.equal(state.tasks.find(task => task.sourceKey?.endsWith(':old-0')).ownerPersonId, '');
  assert.equal(state.tasks.find(task => task.sourceKey?.endsWith(':old-1')).ownerPersonId, 'ITRC-P0001');
  assert.equal(verifyDirectory(directory).repeatDuplicates, 17);
  const rerun = await runMigration({ api: f.api, directory: f.directory('rerun'), apply: true });
  assert.equal(rerun.status, 'already_present_and_preserved'); assert.equal(rerun.imported, 0); assert.equal(rerun.newRecordsFieldsVerified, 0);
  assert.equal(rerun.existingLegacyRecordsPreserved, 17);
  assert.deepEqual((await f.service.store.read()).tasks, state.tasks);
});

test('readback detects unexpected event or post writes even when the apply response claims zero', async t => {
  for (const kind of ['events', 'posts']) {
    const f = await fixture(t); let applyCalls = 0;
    const api = async (endpoint, body) => {
      const result = await f.api(endpoint, body);
      if (body?.action === 'import.apply' && ++applyCalls === 1) {
        await f.put(kind, { id: `unexpected-${kind}`, version: 1, title: 'Unexpected fictional record' });
      }
      return result;
    };
    await assert.rejects(runMigration({ api, directory: f.directory('unexpected'), apply: true }), error => error.code === `${kind.toUpperCase()}_CHANGED_AFTER_APPLY` && error.phase === 'readback' && error.businessApplyAttempted === true);
    assert.equal(applyCalls, 1, 'No duplicate apply runs after detecting an unrelated business write');
  }
});

test('existing legacy title, status and owner differences are preserved and reported separately from new-record verification', async t => {
  const f = await fixture(t);
  await runMigration({ api: f.api, directory: f.directory('initial'), apply: true });
  const original = (await f.service.store.read()).tasks.find(task => task.sourceKey?.endsWith(':old-1'));
  const edited = { ...original, title: 'Later user title', status: 'doing', ownerPersonId: '', version: original.version + 1 };
  await f.put('tasks', edited);
  const directory = f.directory('preserve-edits');
  const result = await runMigration({ api: f.api, directory, apply: true });
  assert.equal(result.status, 'already_present_and_preserved');
  assert.equal(result.readbackPresenceVerified, 17);
  assert.equal(result.newRecordsFieldsVerified, 0);
  assert.equal(result.existingLegacyRecordsPreserved, 17);
  const difference = result.sourceFieldDifferences.find(item => item.id === edited.id);
  for (const field of ['title', 'status', 'ownerPersonId']) assert.ok(difference.fields.includes(field), field);
  assert.deepEqual((await f.service.store.read()).tasks.find(task => task.id === edited.id), edited);
  const detail = JSON.parse(fs.readFileSync(path.join(directory, 'final-verification.json'))).verified.find(item => item.id === edited.id);
  assert.equal(detail.preservedExisting, true); assert.equal(detail.sourceFieldsCompared, true); assert.equal(detail.sourceFieldsVerified, false);
  assert.deepEqual(verifyDirectory(directory).sourceFieldDifferences, result.sourceFieldDifferences);
});

for (const [kind, code] of [['board', 'SOURCE_CHANGED_BEFORE_APPLY'], ['people', 'PEOPLE_CHANGED_BEFORE_APPLY'], ['tasks', 'TARGET_CHANGED_BEFORE_APPLY']]) {
  test(`stops before apply when ${kind} changes after preview`, async t => {
    const f = await fixture(t), directory = f.directory('stale'); let backups = 0;
    const api = async (endpoint, body) => {
      if (endpoint === '/system-backup/export' && ++backups === 2) {
        if (kind === 'board') f.board.v++;
        else if (kind === 'people') await f.put('people', { ...f.people[0], name: 'Edited Member', version: 2 });
        else await f.put('tasks', { ...(await f.service.store.read()).tasks[0], notes: 'Concurrent user edit', version: 4 });
      }
      return f.api(endpoint, body);
    };
    await assert.rejects(runMigration({ api, directory, apply: true }), error => error.code === code && error.businessApplyAttempted === false);
    assert.equal(f.calls.filter(call => call.body?.action === 'import.apply').length, 0);
    assert.equal((await f.service.store.read()).tasks.length, 2);
  });
}

test('a different current card count or reviewed source hash stops before any apply', async t => {
  const f = await fixture(t);
  await assert.rejects(runMigration({ api: f.api, directory: f.directory('count'), expectedCards: 16, apply: true }), { code: 'UNEXPECTED_SOURCE_CARD_COUNT' });
  await assert.rejects(runMigration({ api: f.api, directory: f.directory('hash'), expectedBoardSha256: '0'.repeat(64), apply: true }), { code: 'REVIEWED_SOURCE_CHANGED' });
  assert.equal(f.calls.filter(call => call.body?.action === 'import.apply').length, 0);
});

test('stops when server preview changes source text instead of silently claiming exact preservation', async t => {
  const f = await fixture(t); f.board.lists[0].cards[0].title = '  spaces matter  ';
  await assert.rejects(runMigration({ api: f.api, directory: f.directory('trim'), apply: true }), { code: 'PREVIEW_FIELD_MISMATCH' });
  assert.equal((await f.service.store.read()).tasks.length, 2);
});

test('ambiguous mutation response is saved for reconciliation and never automatically retried', async t => {
  const f = await fixture(t), directory = f.directory('lost-response'); let applyCalls = 0;
  const api = async (endpoint, body) => {
    const result = await f.api(endpoint, body);
    if (body?.action === 'import.apply') { applyCalls++; throw new Error('secret-token-and-provider-details-must-not-escape'); }
    return result;
  };
  await assert.rejects(runMigration({ api, directory, apply: true }), error => error.businessApplyAttempted === true && error.outcomeMayRequireReconciliation === true && !error.message.includes('secret-token'));
  assert.equal(applyCalls, 1); assert.equal((await f.service.store.read()).tasks.length, 19);
  const failure = JSON.parse(fs.readFileSync(path.join(directory, 'failure.json')));
  assert.equal(failure.uncertainReadbackSaved, true);
  assert.equal(fs.readFileSync(path.join(directory, 'failure.json'), 'utf8').includes('secret-token'), false);
  assert.ok(fs.existsSync(path.join(directory, 'apply-command.json')));
});

test('a replayed response does not count as a new-key duplicate proof', async t => {
  const f = await fixture(t); let applyCalls = 0;
  const api = async (endpoint, body) => {
    const result = await f.api(endpoint, body);
    if (body?.action === 'import.apply' && ++applyCalls === 2) result.replayed = true;
    return result;
  };
  await assert.rejects(runMigration({ api, directory: f.directory('replay'), apply: true }), { code: 'APPLY_RESULT_MISMATCH' });
  assert.equal((await f.service.store.read()).tasks.length, 19);
});

test('offline verifier rejects payload tampering and duplicate target source keys are rejected', async t => {
  const f = await fixture(t), directory = f.directory('tampered');
  await runMigration({ api: f.api, directory });
  const file = path.join(directory, 'import-payload.json'), payload = JSON.parse(fs.readFileSync(file));
  payload.tasks[0].title = 'Changed after preview'; fs.writeFileSync(file, JSON.stringify(payload));
  assert.throws(() => verifyDirectory(directory), { code: 'PAYLOAD_DIFFERS_FROM_SOURCE_BACKUP' });
  for (const id of ['dup-a', 'dup-b']) await f.put('tasks', { id, version: 1, title: 'Duplicate fixture', sourceKey: 'firebase:boards/itrc:card:old-0' });
  const duplicateBackup = await f.backup();
  assert.throws(() => snapshot(duplicateBackup), { code: 'DUPLICATE_LEGACY_TARGET_KEYS' });
});

test('transport pins API, prohibits redirects and never returns provider error bodies', async () => {
  let observed;
  const api = apiClient('fictional.private.token', async (url, options) => {
    observed = { url, options };
    return new Response('{"error":"private server details"}', { status: 403, headers: { 'content-type': 'application/json' } });
  });
  await assert.rejects(api('/ops/bootstrap'), { code: 'API_HTTP_403' });
  assert.equal(observed.url, API_BASE + '/ops/bootstrap'); assert.equal(observed.options.redirect, 'error');
  await assert.rejects(api('/unknown'), { code: 'UNEXPECTED_API_ENDPOINT' });
});

test('CLI flags and credential files cannot accidentally enable apply or expose a shared token file', async t => {
  const f = await fixture(t);
  assert.equal(parseArgs(['--token-file', '/private/token', '--out-dir', '.private/run']).apply, false);
  assert.throws(() => parseArgs(['--aply']), { code: 'INVALID_ARGUMENTS' });
  assert.throws(() => parseArgs(['--expect-cards', '0']), { code: 'INVALID_EXPECTED_CARD_COUNT' });
  const token = path.join(f.root, 'token'); fs.writeFileSync(token, 'fictional.private.token\n', { mode: 0o600 });
  assert.equal(readToken(token), 'fictional.private.token');
  fs.chmodSync(token, 0o644); assert.throws(() => readToken(token), { code: 'TOKEN_FILE_MUST_BE_PRIVATE' });
  fs.chmodSync(token, 0o600); fs.symlinkSync(token, path.join(f.root, 'token-link'));
  assert.throws(() => readToken(path.join(f.root, 'token-link')), { code: 'TOKEN_FILE_MUST_BE_PRIVATE' });
  f.directory('private-run'); assert.throws(() => f.directory('private-run'), { code: 'EVIDENCE_DIRECTORY_EXISTS_OR_UNSAFE' });
  assert.throws(() => f.directory('../outside-run'), { code: 'EVIDENCE_DIRECTORY_MUST_BE_INSIDE_REPOSITORY' });
});
