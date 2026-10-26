'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { convertBackup, resolveOwner, digest, SOURCE_URL } = require('./prepare-legacy-board-import.cjs');

function seal(bundle) {
  for (const entry of bundle.firebase.paths) entry.sha256 = digest(entry.value);
  const { checksum, ...unsigned } = bundle;
  bundle.checksum = { algorithm: 'sha256', value: digest(unsigned) };
  return bundle;
}

function fixture() {
  const people = [
    { personId: 'ITRC-P0001', name: '現任甲', status: 'active' },
    { personId: 'ITRC-P0002', name: '前任乙', status: 'retired' },
  ];
  return seal({
    format: 'itrc-system-data-backup', version: 1,
    createdAt: '2026-10-25T19:41:11.755Z',
    database: { tables: [{ name: 'ops_records',
      columns: [{ name: 'kind' }, { name: 'id' }, { name: 'version' }, { name: 'data' }],
      rows: people.map(person => ['people', person.personId, 1, JSON.stringify(person)]),
    }] },
    firebase: { paths: [{ path: 'boards/itrc', exists: true, value: {
      v: 1789918883011, events: [{ id: 'old-event' }], lists: [
        { id: 'todo', title: '待辦', cards: [{ id: 'a', title: '原標題', due: '2026-05-30', note: '原文\n第二行', who: '現任甲', group: '活動組', wid: 'old-event' }] },
        { id: 'doing', title: '進行中', cards: [{ id: 'b', title: '進行中的工作', who: '未知丙', group: '資訊組' }] },
        { id: 'blocked', title: '卡關', cards: [{ id: 'c', title: '卡關的工作', who: '前任乙', note: '等資料' }] },
        { id: 'done', title: '完成', cards: [{ id: 'd', title: '原本已完成', who: '現任甲' }] },
        { id: 'empty', title: '空白欄位' }, // RTDB omits empty arrays.
      ],
    } }] },
  });
}

test('preserves progress, source, dates and notes without creating activity links', () => {
  const { payload, report } = convertBackup(fixture());
  assert.deepEqual(payload.tasks.map(task => task.status), ['todo', 'doing', 'doing', 'done']);
  assert.deepEqual(report.counts.byStatus, { todo: 1, doing: 2, done: 1 });
  assert.equal(report.source.eventCount, 1);
  assert.equal(report.source.listCount, 5);
  assert.equal(report.source.captureDateTaipei, '2026-10-26');
  assert.deepEqual(payload.events, []);
  assert.deepEqual(payload.posts, []);
  const first = payload.tasks[0];
  assert.equal(first.title, '原標題');
  assert.equal(first.dueDate, '2026-05-30');
  assert.ok(first.notes.startsWith('原文\n第二行\n\n'));
  assert.ok(first.notes.includes('原負責人：現任甲'));
  assert.ok(first.notes.includes('原組別：活動組'));
  assert.ok(first.notes.includes('原活動參照：old-event'));
  assert.equal(first.sourceKey, 'firebase:boards/itrc:card:a');
  assert.equal(first.sourceUrl, SOURCE_URL);
  assert.match(first.sourceRevision, /v=1789918883011;sha256=[0-9a-f]{64};capturedAt=2026-10-25T19:41:11\.755Z$/);
  assert.equal(payload.tasks[2].blocker, '等資料');
  for (const task of payload.tasks) {
    for (const key of ['eventId', 'projectId', 'postId', 'completedAt', 'completedBy']) assert.equal(Object.hasOwn(task, key), false);
    assert.equal(task.ownerEmail, '');
  }
});

test('assigns only a unique exact active full name; retired and ambiguous identities stay unassigned', () => {
  const active = { personId: 'ITRC-P0001', name: '現任甲', status: 'active' };
  assert.deepEqual(resolveOwner(' 現任甲 ', [active]), { ownerPersonId: 'ITRC-P0001', reason: 'unique_exact_current_name' });
  for (const [who, people, reason] of [
    ['甲', [active], 'not_in_people'],
    ['', [active], 'empty'],
    ['現任甲', [active, { ...active, personId: 'ITRC-P0002' }], 'ambiguous_name'],
    ['現任甲', [active, { ...active, personId: 'ITRC-P0002', status: 'retired' }], 'ambiguous_name'],
    ['現任甲', [{ ...active, status: 'retired' }], 'retired'],
    ['現任甲', [{ ...active, status: 'pending' }], 'not_active'],
    ['現任甲', [{ ...active, disabled: true }], 'not_active'],
    ['現任甲', [{ ...active, active: false }], 'not_active'],
    ['現任甲', [{ ...active, personId: '' }], 'invalid_person_id'],
  ]) assert.deepEqual(resolveOwner(who, people), { ownerPersonId: '', reason });
  const { payload, report } = convertBackup(fixture());
  assert.deepEqual(payload.tasks.map(task => task.ownerPersonId), ['ITRC-P0001', '', '', 'ITRC-P0001']);
  assert.deepEqual(report.counts.ownerResolution, { unique_exact_current_name: 2, not_in_people: 1, retired: 1 });
});

test('rerunning is deterministic, keeps the input unchanged, and reports already imported source keys', () => {
  const bundle = fixture();
  bundle.database.tables[0].rows.push(['tasks', 'existing-task', 3, JSON.stringify({
    id: 'existing-task', sourceKey: 'firebase:boards/itrc:card:a', status: 'done',
  })]);
  seal(bundle);
  const before = JSON.stringify(bundle);
  const first = convertBackup(bundle), second = convertBackup(bundle);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(bundle), before);
  assert.equal(first.report.counts.duplicateSourceKeysAlreadyInOperations, 1);
  assert.equal(first.report.counts.proposedNew, 3);
  assert.equal(first.payload.tasks.length, 4);
  assert.equal(first.payload.tasks[0].status, 'todo');
  assert.equal(first.report.applied, false);
  assert.equal(first.report.offlineOnly, true);
});

test('rejects damaged backups, duplicated IDs, unmapped progress and impossible dates without guessing', () => {
  const damaged = fixture();
  damaged.firebase.paths[0].value.lists[0].cards[0].title = 'changed';
  assert.throws(() => convertBackup(damaged), /checksum mismatch/);
  const boardDamaged = fixture();
  boardDamaged.firebase.paths[0].sha256 = '0'.repeat(64);
  const { checksum, ...unsigned } = boardDamaged;
  boardDamaged.checksum.value = digest(unsigned);
  assert.throws(() => convertBackup(boardDamaged), /checksum differs/);
  for (const [change, error] of [
    [board => { board.lists[1].cards[0].id = 'a'; }, /duplicated card id/],
    [board => { board.lists[0].title = '不明進度'; }, /Unmapped list status/],
    [board => { board.lists[0].cards[0].due = '2026-02-30'; }, /Invalid due date/],
    [board => { board.lists[0].cards[0].due = '6\/1'; }, /Invalid due date/],
    [board => { board.lists[0].cards[0].note = 'x'.repeat(12000); }, /not truncated/],
  ]) {
    const bundle = fixture();
    change(bundle.firebase.paths[0].value);
    assert.throws(() => convertBackup(seal(bundle)), error);
  }
});
