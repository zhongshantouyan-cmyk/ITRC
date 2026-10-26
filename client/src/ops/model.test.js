import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportText, canOwn, exportPostsCsv, eventTypeOf, eventMissingFacts, eventSpeakerText, eventProgress, taskProgress, postProgress, nextStep } from './model.js';
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

test('demo stays local and ordinary officers can confirm once, attach a design and complete', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let state = loadDemo();
  const act = (action, payload = {}) => {
    const post = state.posts[0];
    state = performDemoAction(state, { action, id: post.id, expectedVersion: post.version, payload }).state;
  };
  act('post.generate');
  assert.equal(state.posts[0].generationMethod, 'demo_rules');
  act('post.confirm');
  assert.equal(state.posts[0].approvedBy, DEMO_ACTORS[0].email);
  assert.equal(state.jobs.length, 0);
  act('post.request-design');
  assert.equal(state.jobs[0].status, 'blocked_configuration');
  assert.equal(state.posts[0].canvaEditUrl, undefined);
  state = changeDemoActor(state, DEMO_ACTORS[2].email);
  act('post.complete', { canvaEditUrl: 'https://www.canva.com/design/demo-example/edit' });
  assert.equal(state.posts[0].stage, 'completed');
  assert.equal(state.posts[0].publishedUrl, undefined);
  assert.equal(state.jobs[0].status, 'obsolete');
  const stored = loadDemo();
  assert.equal(stored.posts[0].completedBy, DEMO_ACTORS[2].email);
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

test('event imports require an explicit type choice and task notes accept the Chinese header', () => {
  const tsv = parseImportText('標題\t活動類型\t講者\n參訪\t一般活動\t\n社課\t講座／社課\t已知講者', 'events');
  assert.equal(tsv.events[0].eventType, 'activity'); assert.equal(tsv.events[0].speaker, '');
  assert.equal(tsv.events[1].eventType, 'lecture');
  assert.equal(parseImportText('[{"title":"參訪","eventType":"activity"}]', 'events').events[0].eventType, 'activity');
  assert.equal(parseImportText('標題,活動類型\n舊表,', 'events').events[0].eventType, 'lecture');
  assert.equal(parseImportText('標題\n名稱含競賽但沒有指定類型', 'events').events[0].eventType, undefined);
  assert.throws(() => parseImportText('標題,活動類型\n參訪,unknown', 'events'), /活動類型/);
  assert.throws(() => parseImportText('[{"title":"參訪","eventType":true}]', 'events'), /活動類型/);
  assert.equal(parseImportText('標題,備註\n帶相機,放社辦即可', 'tasks').tasks[0].notes, '放社辦即可');
});

test('simple progress labels never infer completion or invent missing activity facts', () => {
  const event = { title: '活動', eventType: 'activity', date: '2020-01-01' };
  assert.equal(eventProgress(event), 'todo'); assert.equal(eventSpeakerText(event), '');
  assert.deepEqual(eventMissingFacts(event), ['地點']);
  assert.equal(eventTypeOf({}), 'lecture'); assert.deepEqual(eventMissingFacts({}), ['日期', '地點', '講者']);
  assert.ok(eventMissingFacts({ eventType: 'activity', date: '2030-02-30', venue: '教室' }).includes('日期'));
  assert.equal(taskProgress({ status: 'unassigned' }), 'todo'); assert.equal(taskProgress({ status: 'delivered' }), 'doing');
  assert.equal(taskProgress({ status: 'cancelled' }), 'cancelled');
  assert.equal(postProgress({ stage: 'approval', copyVersion: 2 }), 'draft');
  assert.equal(postProgress({ stage: 'design_review', copyVersion: 2, approvedVersion: 2 }), 'approved');
  assert.equal(postProgress({ stage: 'completed', copyVersion: 2 }), 'completed');
  assert.match(nextStep({ caption: '現有文案', copyVersion: 1, stage: 'draft' }, { events: [], jobs: [] }), /確認這個版本/);
});

test('demo general activities can finish independently while missing facts stay visible in copy', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let state = loadDemo();
  const act = (action, record, payload = {}) => {
    const response = performDemoAction(state, { action, id: record?.id, expectedVersion: record?.version, payload });
    state = response.state; return response.result.record;
  };
  let event = act('event.create', null, { title: '示範參訪', eventType: 'activity' });
  event = act('event.confirm', event);
  assert.equal(event.confirmationStatus, 'reviewed'); assert.equal(event.date, undefined); assert.equal(event.venue, undefined);
  event = act('event.set-status', event, { status: 'done' });
  assert.equal(event.status, 'done'); assert.equal(event.confirmationStatus, 'reviewed');
  let post = act('post.create', null, { title: '參訪宣傳', eventId: event.id });
  post = act('post.generate', post);
  assert.doesNotMatch(post.caption, /講者|帶領者/); assert.match(post.caption, /日期｜待確認/);
  post = act('post.confirm', post);
  post = act('post.complete', post);
  assert.equal(post.stage, 'completed'); assert.equal(post.publishedUrl, undefined);
});

test('demo board imports preserve doing and done without inventing completion authors or reopening duplicates', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let state = changeDemoActor(loadDemo(), DEMO_ACTORS[3].email);
  const tasks = ['todo', 'doing', 'done', 'delivered'].map((status, index) => ({ title: `示範來源卡 ${index}`, status, sourceKey: `firebase:boards/itrc:card:demo-${index}`, sourceLabel: 'legacy-board.json' }));
  state = performDemoAction(state, { action: 'import.apply', payload: { tasks } }).state;
  const imported = state.tasks.filter(task => task.sourceKey?.startsWith('firebase:boards/itrc:card:'));
  assert.deepEqual(imported.map(task => task.status), ['todo', 'doing', 'done', 'doing']);
  assert.equal(imported[2].completionMode, 'imported_status'); assert.equal(imported[2].completedBy, undefined); assert.equal(imported[2].completedAt, undefined);
  state = performDemoAction(state, { action: 'import.apply', payload: { tasks: tasks.map(task => ({ ...task, status: 'todo' })) } }).state;
  assert.deepEqual(state.tasks.filter(task => task.sourceKey?.startsWith('firebase:boards/itrc:card:')), imported);
});
