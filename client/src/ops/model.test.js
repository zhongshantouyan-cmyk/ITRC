import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportText, canOwn, exportPostsCsv } from './model.js';
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

test('post export keeps multiline copy in one cell, includes stable provenance and escapes formulas without leaking configuration', () => {
  const csv = exportPostsCsv({
    settings: { secret: 'must-not-appear' },
    events: [{ id: 'event-1', title: '活動,範例', date: '2026-11-30', sourceUrl: 'https://example.org/semester' }],
    posts: [{ id: 'post-1', eventId: 'event-1', title: '=SUM(1,2)', caption: '第一行,"引號"\n第二行',
      slides: [{ heading: '@FORMULA', body: '+123' }, { heading: '一般標題', body: ' -123' }, { heading: '第三頁', body: '內容' }, { heading: '第四頁仍保留', body: '額外內容' }],
      stage: 'draft', copyVersion: 3, sourceKey: 'stable-post-1', sourceLabel: 'semester.csv', secret: 'must-not-appear' }],
  });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /"第一行,""引號""\n第二行"/);
  assert.equal(csv.includes('must-not-appear'), false);
  const result = parseImportText(csv, 'posts').posts;
  assert.equal(result.length, 1);
  assert.equal(result[0].caption, '第一行,"引號"\n第二行');
  assert.equal(result[0].title, "'=SUM(1,2)");
  assert.equal(result[0]['輪播1標題'], "'@FORMULA");
  assert.equal(result[0]['輪播1內文'], "'+123");
  assert.equal(result[0]['輪播2內文'], "' -123");
  assert.equal(result[0]['輪播4標題'], '第四頁仍保留');
  assert.equal(result[0]['宣傳ID'], 'post-1');
  assert.equal(result[0].sourceKey, 'stable-post-1');
  assert.equal(result[0]['活動標題'], '活動,範例');
});
