'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeAction } = require('./domain');
const { KINDS } = require('./store');

const admin = {uid:'club',email:'club@example.com',role:'advisor',canApprove:true,canDesign:true};
const owner = {uid:'owner',email:'owner@example.com',role:'officer',canApprove:false,canDesign:false};
const reviewer = {uid:'reviewer',email:'reviewer@example.com',role:'officer',canApprove:false,canDesign:false};
const other = {uid:'other',email:'other@example.com',role:'officer',canApprove:false,canDesign:false};
const roster = [
  {personId:'ITRC-P0001',name:'示範承辦人',email:owner.email,title:'活動',group:'活動組',status:'active',sourceRevision:'website-test-1'},
  {personId:'ITRC-P0002',name:'示範驗收人',email:reviewer.email,title:'活動長',group:'活動組',status:'active',sourceRevision:'website-test-1'},
  {personId:'ITRC-P0003',name:'示範協作者',email:other.email,title:'行銷',group:'行銷組',status:'active',sourceRevision:'website-test-1'},
];
function fixture() {
  let state = Object.fromEntries([...KINDS,'audit'].map(kind => [kind,[]])), tick = 0;
  const call = (action,payload = {},record,actor = admin) => {
    const draft = structuredClone(state);
    const result = executeAction(draft,{action,payload,id:record?.id,expectedVersion:record?.version},actor,new Date(Date.UTC(2026,9,26,0,0,tick++)).toISOString());
    state = draft;
    return structuredClone(result.record);
  };
  const importPeople = (people = roster) => {
    const preview = call('people.import-preview',{people});
    return call('people.import-apply',{people,previewToken:preview.previewToken});
  };
  const read = () => structuredClone(state);
  return {call,importPeople,read};
}
function taskFixture(extra = {}) {
  const f = fixture(); f.importPeople();
  const task = f.call('task.create',{title:'交付示範',ownerPersonId:'ITRC-P0001',reviewerPersonId:'ITRC-P0002',acceptanceCriteria:'文件包含完整活動日期、地點，且連結可開啟。',...extra});
  return {...f,task};
}
function postFixture() {
  const f = fixture(); f.importPeople();
  let event = f.call('event.create',{title:'文案版本驗證活動',ownerPersonId:'ITRC-P0001',date:'2026-11-01',speaker:'示範講者',venue:'原場地',sourceUrl:'https://example.org/activity-master',sourceRevision:'source-v1'});
  event = f.call('event.confirm',{},event,owner);
  let post = f.call('post.create',{title:'第一版宣傳',eventId:event.id,ownerPersonId:'ITRC-P0001',caption:'第一版文案',slides:[{heading:'原標題',body:'原內文'}]});
  post = f.call('post.submit',{},post,owner);
  post = f.call('post.unit-review',{},post,owner);
  post = f.call('post.approve',{},post);
  return {...f,event,post};
}

test('person import previews are read-only and an explicit matching preview is required', () => {
  const f = fixture();
  const preview = f.call('people.import-preview',{people:roster});
  assert.equal(f.read().people.length,0);
  assert.equal(preview.changes[0].change,'create');
  assert.throws(() => f.call('people.import-apply',{people:roster}),{code:'PEOPLE_PREVIEW_STALE'});
  const applied = f.call('people.import-apply',{people:roster,previewToken:preview.previewToken});
  assert.equal(applied.created,3);
  assert.equal(f.read().people[0].id,'ITRC-P0001');
  assert.equal(f.read().people[0].authorityUrl,'https://nsysu-itrc.vercel.app/');
  assert.equal(f.read().people[0].role,undefined);
});

test('stable person IDs retain contacts and historical people across name/title/source changes', () => {
  const f = fixture(); f.importPeople();
  f.importPeople([{personId:'ITRC-P0001',name:'示範新姓名',title:'活動長',sourceRevision:'website-test-2'}]);
  const state = f.read();
  assert.equal(state.people.length,3);
  assert.equal(state.people[0].email,owner.email);
  assert.equal(state.people[0].personId,'ITRC-P0001');
  assert.equal(state.people[0].title,'活動長');
  assert.equal(state.people[0].version,2);
  assert.equal(owner.canApprove,false);
  assert.ok(state.audit[0].summary.includes('未變更登入授權'));
});

test('stale people previews cannot overwrite a newer roster change', () => {
  const f = fixture(); f.importPeople();
  const rows = [{...roster[0],title:'活動長'}];
  const preview = f.call('people.import-preview',{people:rows});
  f.importPeople([{...roster[1],lineName:'測試 LINE 名稱'}]);
  assert.throws(() => f.call('people.import-apply',{people:rows,previewToken:preview.previewToken}),{code:'PEOPLE_PREVIEW_STALE'});
  assert.equal(f.read().people[0].title,'活動');
});

test('people cache rejects role injection, unstable IDs, and ambiguous identity merging', () => {
  const f = fixture(); f.importPeople();
  assert.throws(() => f.call('people.import-preview',{people:[{...roster[0],role:'advisor'}]}),{code:'UNSUPPORTED_PERSON_FIELD'});
  assert.throws(() => f.call('people.import-preview',{people:[{...roster[0],personId:'活動長'}]}),{code:'PERSON_ID_REQUIRED'});
  assert.throws(() => f.call('people.import-preview',{people:[{...roster[0],personId:'ITRC-P0017'}]}),{code:'DUPLICATE_PERSON_EMAIL'});
  assert.throws(() => f.call('people.import-preview',{people:[roster[0],roster[0]]}),{code:'DUPLICATE_PERSON_ID'});
  assert.throws(() => f.call('people.import-preview',{people:roster},null,owner),{code:'ADVISOR_REQUIRED'});
});

test('missing emails are allowed; inactive people remain historical but cannot receive new work', () => {
  const f = fixture(); f.importPeople();
  f.importPeople([{personId:'ITRC-P0017',name:'尚未提供 MAIL 的示範幹部',status:'active'},{...roster[2],status:'inactive'}]);
  assert.equal(f.read().people.length,4);
  assert.equal(f.read().people.find(row => row.personId === 'ITRC-P0017').email,'');
  assert.throws(() => f.call('task.create',{title:'不可派給歷史幹部',ownerPersonId:'ITRC-P0003'}),{code:'PERSON_INACTIVE'});
});

test('blank task owners remain blank while tasks use ordinary todo and doing states', () => {
  const f = fixture();
  let task = f.call('task.create',{title:'待認領工作',ownerEmail:''},null,owner);
  assert.equal(task.ownerEmail,''); assert.equal(task.status,'todo');
  assert.equal(task.createdByEmail,owner.email);
  task = f.call('task.update',{title:'仍未指派的工作'},task,other);
  assert.equal(task.ownerEmail,'');
  const preview = f.call('import.preview',{tasks:[{title:'來源任務',sourceUrl:'https://example.org/master'}]});
  assert.equal(preview.tasks[0].ownerEmail,''); assert.equal(preview.tasks[0].status,'todo');
  assert.equal(f.call('task.update',{status:'doing'},task,other).status,'doing');
});

test('explicit blank people selections are preserved for projects, events and imports', () => {
  const f = fixture();
  const project = f.call('project.create',{title:'待派專案',ownerPersonId:'',ownerEmail:''},null,owner);
  assert.equal(project.ownerEmail,''); assert.equal(project.createdByEmail,owner.email);
  assert.equal(f.call('project.update',{objective:'建立者仍可整理需求'},project,owner).objective,'建立者仍可整理需求');
  const event = f.call('event.create',{title:'待派活動',ownerPersonId:'',ownerEmail:''},null,owner);
  assert.equal(event.ownerEmail,'');
  const preview = f.call('import.preview',{events:[{title:'匯入待派活動',ownerEmail:'',sourceUrl:'https://example.org/master'}]});
  assert.equal(preview.events[0].ownerEmail,'');
  const legacy = f.call('project.create',{title:'舊客戶端未提供負責欄位'},null,owner);
  assert.equal(legacy.ownerEmail,owner.email);
});

test('active collaborators may assign ordinary tasks to current people without changing account roles', () => {
  const f = fixture(); f.importPeople();
  let task = f.call('task.create',{title:'自行承接的需求'},null,owner);
  task = f.call('task.update',{ownerPersonId:'ITRC-P0001',ownerEmail:''},task,owner);
  task = f.call('task.update',{ownerPersonId:'ITRC-P0003'},task,other);
  assert.equal(task.status,'todo'); assert.equal(task.ownerPersonId,'ITRC-P0003');
  assert.equal(owner.canApprove,false); assert.equal(f.read().people[2].role,undefined);
});

test('ordinary collaboration keeps the recorded assignee and creator distinct from the updater', () => {
  const f = taskFixture();
  const task = f.call('task.update',{status:'doing',notes:'幫忙補充現場資訊'},f.task,other);
  assert.equal(task.ownerPersonId,'ITRC-P0001'); assert.equal(task.ownerEmail,'');
  assert.equal(task.createdByEmail,admin.email);
  assert.equal(f.read().audit[0].actorEmail,other.email);
});

test('event facts are collaborative while proposing formal source updates still follows assignment', () => {
  const f = fixture(); f.importPeople();
  let event = f.call('event.create',{title:'待分配活動',ownerPersonId:'',ownerEmail:'',sourceUrl:'https://example.org/event-master',sourceRevision:'v1'},null,owner);
  event = f.call('event.update',{ownerPersonId:'ITRC-P0002',ownerEmail:''},event);
  event = f.call('event.update',{title:'團隊協作更新活動事實'},event,owner);
  const proposal = {targetKind:'events',targetId:event.id,targetVersion:event.version,sourceKey:'event-1',baseSourceRevision:'v1',reason:'回寫已核對資料'};
  assert.throws(() => f.call('source-change.propose',proposal,null,owner),{code:'OWNER_REQUIRED'});
  assert.equal(f.call('source-change.propose',proposal,null,reviewer).status,'pending');
  assert.equal(f.call('event.set-status',{status:'done'},event,owner).completedBy,owner.email);
});

test('person IDs reject conflicting identities and still govern source authority after contact changes', () => {
  const f = fixture(); f.importPeople();
  assert.throws(() => f.call('task.create',{title:'矛盾身分',ownerPersonId:'ITRC-P0001',ownerEmail:other.email}),{code:'PERSON_EMAIL_MISMATCH'});
  assert.throws(() => f.call('project.create',{title:'矛盾督導',adviserPersonId:'ITRC-P0002',adviserEmail:owner.email}),{code:'PERSON_EMAIL_MISMATCH'});
  let event = f.call('event.create',{title:'同一人的舊帳號',ownerPersonId:'ITRC-P0001',ownerEmail:owner.email,sourceUrl:'https://example.org/master',sourceRevision:'v1'});
  assert.throws(() => f.call('event.update',{ownerEmail:other.email},event),{code:'PERSON_EMAIL_MISMATCH'});
  f.importPeople([{...roster[0],email:'new-owner@example.com'}]);
  const proposal = {targetKind:'events',targetId:event.id,targetVersion:event.version,sourceKey:'event-1',baseSourceRevision:'v1',reason:'核對最新原始資料'};
  assert.throws(() => f.call('source-change.propose',proposal,null,owner),{code:'OWNER_REQUIRED'});
  const newOwner = {...owner,email:'new-owner@example.com'};
  event = f.call('event.update',{ownerEmail:'',title:'新帳號核對後更新'},event,newOwner);
  assert.equal(event.title,'新帳號核對後更新');
  assert.equal(f.call('source-change.propose',{...proposal,targetVersion:event.version},null,newOwner).status,'pending');
});

test('ordinary task relationships can be reorganized without a completion gate while invalid references fail', () => {
  const f = fixture(); f.importPeople();
  const project = f.call('project.create',{title:'共同專案',ownerPersonId:'ITRC-P0002'});
  let task = f.call('task.create',{title:'一般任務',projectId:project.id,ownerPersonId:'ITRC-P0001'});
  task = f.call('task.update',{projectId:''},task,other);
  assert.equal(task.projectId,'');
  assert.throws(() => f.call('task.update',{projectId:'missing-project'},task,other),{code:'RECORD_NOT_FOUND'});
  assert.equal(f.call('project.update',{status:'completed'},project,reviewer).status,'completed');
});













test('full post history retains approved content and source snapshots across later event changes', () => {
  const f = postFixture();
  const approved = f.post.history.find(row => row.action === 'post.approve');
  assert.equal(approved.caption,'第一版文案'); assert.equal(approved.slides[0].body,'原內文');
  assert.equal(approved.approvedBy,admin.email); assert.equal(approved.sourceEventSnapshot.venue,'原場地');
  f.call('event.update',{venue:'新場地',sourceRevision:'source-v2'},f.event,owner);
  const post = f.read().posts[0];
  assert.equal(post.approvedVersion,undefined); assert.equal(post.stage,'draft');
  assert.equal(post.history.find(row => row.id === approved.id).sourceEventSnapshot.venue,'原場地');
  assert.equal(post.history.at(-1).sourceEventSnapshot.venue,'新場地');
  assert.equal(post.history.find(row => row.id === approved.id).approvedVersion,1);
});

test('restoring a full historical copy creates a new unapproved draft and preserves the original history', () => {
  const f = postFixture();
  const old = f.post.history.find(row => row.action === 'post.create');
  let post = f.call('post.update',{caption:'第二版文案',cta:'後加的 CTA',slides:[{heading:'新版',body:'新版內文'}]},f.post,owner);
  const version = post.copyVersion;
  post = f.call('post.restore-version',{historyId:old.id},post,owner);
  assert.equal(post.caption,'第一版文案'); assert.equal(post.slides[0].body,'原內文'); assert.equal(post.cta,'');
  assert.equal(post.copyVersion,version+1); assert.equal(post.stage,'draft'); assert.equal(post.approvedVersion,undefined);
  assert.equal(post.restoredFromHistoryId,old.id);
  assert.deepEqual(post.history.find(row => row.id === old.id),old);
  assert.throws(() => f.call('post.update',{history:[]},post,owner),{code:'UNSUPPORTED_FIELD'});
});
