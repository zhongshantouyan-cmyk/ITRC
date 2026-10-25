import test from 'node:test';
import assert from 'node:assert/strict';
import { canOwn, parseImportText } from './model.js';
import { LEGACY_ASSIGNEE, assignmentFormValue, assignmentPayload, hasAssignee, matchesPerson, ownerLabel, personOptions, projectPendingTasks, taskDeliveryReason } from './people.js';
import { changeDemoActor, DEMO_ACTORS, loadDemo, performDemoAction } from './demo.js';

const people = [
  { personId: 'ITRC-P0001', name: '甲', title: '活動長', email: 'a@example.invalid', status: 'active' },
  { personId: 'ITRC-P0002', name: '乙', title: '管理', email: 'b@example.invalid', status: 'active' },
  { personId: 'ITRC-P0003', name: '丙', email: 'c@example.invalid', status: 'inactive' },
];
function localDemo() {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let state = loadDemo();
  return {
    get state() { return state; },
    actor(index) { state = changeDemoActor(state, DEMO_ACTORS[index].email); },
    act(action, id, payload = {}) {
      const record = [...state.tasks, ...state.projects, ...state.posts, ...state.events].find(item => item.id === id);
      const response = performDemoAction(state, { action, ...(record ? { id, expectedVersion: record.version } : {}), payload });
      state = response.state; return response.result.record;
    },
  };
}

test('fixed IDs preserve assignment through renamed officers and do not grant roles from titles', () => {
  const task = { ownerPersonId: 'ITRC-P0001', ownerEmail: '' };
  assert.equal(matchesPerson(task, { ...people[0], name: '甲的新名字' }), true);
  assert.equal(ownerLabel(task, [{ ...people[0], name: '甲的新名字', title: '公關長' }]), '甲的新名字 · 公關長');
  assert.equal(canOwn({ email: 'other@example.invalid', role: 'officer' }, task, [], [{ ...people[0], title: '社長' }]), false);
  assert.equal(canOwn({ email: people[0].email, role: 'officer' }, task, [], people), true);
  assert.equal(canOwn({ email: people[2].email, role: 'officer' }, { ownerPersonId: people[2].personId }, [], people), false);
  assert.equal(personOptions(people).some(option => option.value === people[2].personId), false);
  assert.equal(personOptions(people, people[2].personId).some(option => option.value === people[2].personId), true);
});

test('shared login filter and legacy assignee migration preserve deliberate unassignment', () => {
  assert.equal(matchesPerson({ ownerPersonId: people[0].personId }, people[1], 'club@example.invalid'), false);
  assert.equal(hasAssignee({ ownerPersonId: '', ownerEmail: '' }), false);
  const legacy = { ownerEmail: 'old@example.invalid' };
  assert.equal(assignmentFormValue(legacy), LEGACY_ASSIGNEE);
  assert.deepEqual(assignmentPayload(LEGACY_ASSIGNEE, legacy), { ownerPersonId: '', ownerEmail: legacy.ownerEmail });
  assert.deepEqual(assignmentPayload('', legacy), { ownerPersonId: '', ownerEmail: '' });
  assert.deepEqual(assignmentPayload(people[0].personId, legacy), { ownerPersonId: people[0].personId, ownerEmail: '' });
});

test('reassignment removes creator access and person ID takes precedence over a conflicting legacy email', () => {
  const creator = { email: people[0].email, role: 'officer' };
  const assignee = { email: people[1].email, role: 'officer' };
  const unassigned = { createdByEmail: creator.email, ownerPersonId: '', ownerEmail: '' };
  assert.equal(canOwn(creator, unassigned, [], people), true);
  const reassigned = { ...unassigned, ownerPersonId: people[1].personId, ownerEmail: creator.email };
  assert.equal(canOwn(creator, reassigned, [], people), false);
  assert.equal(canOwn(assignee, reassigned, [], people), true);
  assert.equal(canOwn(creator, { ownerEmail: assignee.email, adviserPersonId: people[1].personId, adviserEmail: creator.email }, [], people), false);
});

test('the direct parent task owner can manage its child without granting access to unrelated officers', () => {
  const tasks = [{ id: 'parent', ownerPersonId: people[1].personId }];
  const child = { parentId: 'parent', ownerPersonId: people[0].personId };
  assert.equal(canOwn({ email: people[1].email, role: 'officer' }, child, [], people, tasks), true);
  assert.equal(canOwn({ email: 'other@example.invalid', role: 'officer' }, child, [], people, tasks), false);
});

test('existing Chinese roster and task headers map to stable identity fields', () => {
  const roster = parseImportText('職稱\t姓名\tEMAIL\tLINE名稱\t組別\t幹部ID\t任期\t在任狀態\n活動長\t甲\ta@example.invalid\t甲同學\t活動組\tITRC-P0001\t115-1\t在任', 'people');
  assert.deepEqual(roster.people[0], { title: '活動長', name: '甲', email: 'a@example.invalid', lineName: '甲同學', group: '活動組', personId: 'ITRC-P0001', term: '115-1', status: 'active' });
  const actualHeaders = parseImportText('職稱\t姓名\tEMAIL\tLINE 名稱\t組別\t幹部 ID\t任期\t在任狀態\n行銷\t丁\t\t\t行銷\tITRC-P0004\t115-1\t在任', 'people');
  assert.equal(actualHeaders.people[0].personId, 'ITRC-P0004');
  assert.equal(actualHeaders.people[0].email, '');
  assert.equal(actualHeaders.people[0].lineName, '');
  assert.throws(() => parseImportText('姓名,MAIL\n甲,a@example.invalid', 'people'), /幹部ID/);
  for (const status of ['非當期名單', '已卸任', '暫停']) assert.equal(parseImportText(`姓名,幹部ID,在任狀態\n甲,ITRC-P0001,${status}`, 'people').people[0].status, 'inactive');
  const task = parseImportText('標題,負責人ID,驗收人ID,結案必要\n器材,ITRC-P0001,ITRC-P0002,否', 'tasks').tasks[0];
  assert.equal(task.ownerPersonId, people[0].personId); assert.equal(task.reviewerPersonId, people[1].personId); assert.equal(task.requiredForCompletion, false);
  assert.throws(() => parseImportText('標題,結案必要\n器材,或許', 'tasks'), /結案必要/);
});

test('delivery needs a separate reviewer and completed predecessors; required cancelled tasks still block closing', () => {
  const task = { ownerPersonId: people[0].personId, reviewerPersonId: people[1].personId, acceptanceCriteria: '設備可用', dependsOn: ['prior'] };
  assert.match(taskDeliveryReason({ ...task, reviewerPersonId: people[0].personId }, []), /分開/);
  assert.match(taskDeliveryReason(task, [{ id: 'prior', status: 'doing' }]), /前置/);
  assert.equal(taskDeliveryReason(task, [{ id: 'prior', status: 'done' }]), '');
  assert.match(taskDeliveryReason({ ...task, ownerPersonId: '', ownerEmail: people[1].email, dependsOn: [] }, [], people), /分開/);
  assert.match(taskDeliveryReason({ ...task, id: 'parent', dependsOn: [] }, [{ parentId: 'parent', status: 'todo' }]), /必要子任務/);
  const tasks = [{ projectId: 'p', status: 'done' }, { projectId: 'p', status: 'cancelled' }, { projectId: 'p', status: 'todo', requiredForCompletion: false }];
  assert.equal(projectPendingTasks('p', tasks).length, 1);
  assert.equal(projectPendingTasks(undefined, [{ status: 'todo' }]).length, 0);
});

test('demonstration enforces deliver-review-return without silently assigning the shared account', () => {
  const demo = localDemo();
  const empty = demo.act('task.create', null, { title: '待指派測試', ownerEmail: '' });
  assert.equal(empty.status, 'unassigned'); assert.equal(empty.ownerEmail, '');
  assert.throws(() => demo.act('task.update', empty.id, { status: 'done', deliverableUrl: 'https://example.org/work' }), /交件與驗收/);
  demo.act('task.deliver', 'demo-task-5', { deliverableUrl: 'https://example.org/work' });
  assert.equal(demo.state.tasks.find(task => task.id === 'demo-task-5').status, 'delivered');
  assert.throws(() => demo.act('task.accept-delivery', 'demo-task-5'), /指定驗收人/);
  demo.actor(1);
  demo.act('task.return-delivery', 'demo-task-5', { reason: '補上照片' });
  assert.equal(demo.state.tasks.find(task => task.id === 'demo-task-5').returnReason, '補上照片');
  demo.actor(0); demo.act('task.deliver', 'demo-task-5', { deliverableUrl: 'https://example.org/work-2' });
  demo.actor(1); demo.act('task.accept-delivery', 'demo-task-5');
  assert.equal(demo.state.tasks.find(task => task.id === 'demo-task-5').reviewIdentityMode, 'individual_account');
  assert.throws(() => demo.act('project.update', 'demo-project', { status: 'completed' }), /必要任務/);
});

test('shared-account acceptance needs external confirmation evidence and remains labeled as recorded', () => {
  const demo = localDemo(); demo.act('task.deliver', 'demo-task-5', { deliverableUrl: 'https://example.org/work' }); demo.actor(3);
  assert.throws(() => demo.act('task.accept-delivery', 'demo-task-5', {}), /代登錄/);
  demo.act('task.accept-delivery', 'demo-task-5', { confirmedExternalReview: true, evidenceUrl: 'https://example.org/review' });
  const task = demo.state.tasks.find(item => item.id === 'demo-task-5');
  assert.equal(task.reviewIdentityMode, 'recorded_external_review'); assert.equal(task.reviewEvidenceUrl, 'https://example.org/review');
});

test('roster preview preserves contacts, leaves absent people and rejects stale applies or role injection', () => {
  const demo = localDemo(); demo.actor(3);
  const row = { personId: demo.state.people[0].personId, name: '已核對新名字', title: '活動長' };
  const preview = demo.act('people.import-preview', null, { people: [row] });
  assert.equal(preview.people[0].email, DEMO_ACTORS[0].email);
  assert.equal(preview.people[0].status, 'active');
  demo.act('people.import-apply', null, { people: [row], previewToken: preview.previewToken });
  assert.equal(demo.state.people.length, 4);
  assert.equal(demo.state.people[0].name, row.name);
  assert.throws(() => demo.act('people.import-apply', null, { people: [row], previewToken: preview.previewToken }), /重新預覽/);
  assert.throws(() => demo.act('people.import-preview', null, { people: [{ ...row, role: 'chair' }] }), /權限設定/);
});

test('recovering saved copy creates a new unapproved draft and preserves the original version', () => {
  const demo = localDemo(); demo.act('post.generate', 'demo-post');
  const first = demo.state.posts[0].history.find(version => version.caption);
  const savedCaption = first.caption;
  demo.act('post.update', 'demo-post', { caption: '修改後內容', slides: [{ heading: '新標題', body: '新內容' }] });
  const priorVersion = demo.state.posts[0].copyVersion;
  demo.act('post.restore-version', 'demo-post', { historyId: first.id });
  assert.equal(demo.state.posts[0].caption, savedCaption);
  assert.ok(demo.state.posts[0].copyVersion > priorVersion);
  assert.equal(demo.state.posts[0].approvedVersion, null);
  assert.equal(demo.state.posts[0].stage, 'draft');
  assert.ok(demo.state.posts[0].history.some(version => version.caption === '修改後內容'));
});
