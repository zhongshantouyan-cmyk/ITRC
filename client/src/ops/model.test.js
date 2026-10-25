import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportText, canOwn } from './model.js';
import { loadDemo, performDemoAction, changeDemoActor, DEMO_ACTORS } from './demo.js';

test('spreadsheet import preserves quoted multiline copy and maps Chinese post headers', () => {
  const result = parseImportText('\uFEFF宣傳名稱,活動ID,宣傳重點,文案,來源檔名\r\n"預告,首波",event-1,"第一點\n第二點","他說""來參加""",semester.csv\r\n', 'posts');
  assert.equal(result.posts[0].title, '預告,首波');
  assert.equal(result.posts[0].highlights, '第一點\n第二點');
  assert.equal(result.posts[0].caption, '他說"來參加"');
  assert.equal(result.posts[0].sourceLabel, 'semester.csv');
  assert.equal(result.events.length, 0);
});

test('pasted TSV imports and malformed column/quote data fail without partial import', () => {
  assert.deepEqual(parseImportText('標題\t活動來源鍵\t發布管道\n期中提醒\tsemester-1\tstory', 'posts').posts[0], { title: '期中提醒', eventSourceKey: 'semester-1', channel: 'story' });
  assert.throws(() => parseImportText('標題,標題\nA,B'), /不能重複/);
  assert.throws(() => parseImportText('標題,講者\nA,B,C'), /欄位比標題列多/);
  assert.throws(() => parseImportText('標題,講者\n"A,B'), /未結束/);
});

test('project owner and explicitly assigned adviser can manage child records', () => {
  const projects = [{ id: 'project', ownerEmail: 'owner@example.org', adviserEmail: 'adviser@example.org' }];
  assert.equal(canOwn({ role: 'officer', email: 'owner@example.org' }, { projectId: 'project' }, projects), true);
  assert.equal(canOwn({ role: 'officer', email: 'adviser@example.org' }, { projectId: 'project' }, projects), true);
  assert.equal(canOwn({ role: 'officer', email: 'other@example.org' }, { projectId: 'project' }, projects), false);
});

test('demo stays local, requires the correct review role and exposes missing Canva instead of fabricating a design', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let state = loadDemo();
  const act = (action, payload = {}) => {
    const post = state.posts[0];
    state = performDemoAction(state, { action, id: post.id, expectedVersion: post.version, payload }).state;
  };
  act('post.generate');
  assert.equal(state.posts[0].generationMethod, 'demo_rules');
  act('post.submit'); act('post.unit-review');
  assert.throws(() => act('post.approve'), /最終審核者/);
  state = changeDemoActor(state, DEMO_ACTORS[1].email);
  act('post.approve');
  assert.equal(state.posts[0].stage, 'design_pending');
  assert.equal(state.jobs[0].status, 'blocked_configuration');
  assert.equal(state.posts[0].canvaEditUrl, undefined);
  const stored = loadDemo();
  assert.equal(stored.posts[0].approvedVersion, state.posts[0].copyVersion);
  assert.ok(stored.audit.length >= 4);
});

test('post CSV import deduplicates stable source keys and keeps every imported post unapproved', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let state = changeDemoActor(loadDemo(), DEMO_ACTORS[3].email);
  const payload = { posts: [{ title: '第二則宣傳', eventId: 'demo-event', sourceKey: 'post-2', sourceLabel: 'semester.csv', channel: 'instagram' }] };
  state = performDemoAction(state, { action: 'import.apply', payload }).state;
  state = performDemoAction(state, { action: 'import.apply', payload }).state;
  const post = state.posts.find(item => item.sourceKey === 'post-2');
  assert.equal(state.posts.filter(item => item.sourceKey === 'post-2').length, 1);
  assert.equal(post.stage, 'brief');
  assert.equal(post.approvedVersion, undefined);
});
