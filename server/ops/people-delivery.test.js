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

test('blank task owners stay unassigned and imported rows do not silently assign the importer', () => {
  const f = fixture();
  let task = f.call('task.create',{title:'待指派工作',ownerEmail:''},null,owner);
  assert.equal(task.ownerEmail,''); assert.equal(task.status,'unassigned');
  assert.equal(task.createdByEmail,owner.email);
  task = f.call('task.update',{title:'仍待指派的工作'},task,owner);
  assert.equal(task.status,'unassigned');
  const preview = f.call('import.preview',{tasks:[{title:'來源任務',sourceUrl:'https://example.org/master'}]});
  assert.equal(preview.tasks[0].ownerEmail,''); assert.equal(preview.tasks[0].status,'unassigned');
  assert.throws(() => f.call('task.update',{status:'doing'},task,owner),{code:'TASK_UNASSIGNED'});
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

test('an unassigned task creator may claim themselves without gaining authority to reassign other people', () => {
  const f = fixture(); f.importPeople();
  let task = f.call('task.create',{title:'自行承接的需求'},null,owner);
  task = f.call('task.update',{ownerPersonId:'ITRC-P0001',ownerEmail:''},task,owner);
  assert.equal(task.status,'todo'); assert.equal(task.ownerPersonId,'ITRC-P0001');
  assert.throws(() => f.call('task.update',{ownerPersonId:'ITRC-P0003'},task,owner),{code:'ASSIGNMENT_REQUIRED'});
});

test('person assignment grants existing authorized assignees management without overwriting legacy account identity', () => {
  const f = taskFixture();
  assert.equal(f.task.ownerEmail,'');
  let task = f.call('task.update',{status:'doing'},f.task,owner);
  assert.equal(task.ownerPersonId,'ITRC-P0001');
  assert.equal(task.createdByEmail,admin.email);
  assert.throws(() => f.call('task.update',{title:'無權更改'},task,other),{code:'OWNER_REQUIRED'});
  assert.throws(() => f.call('task.update',{ownerPersonId:'ITRC-P0003'},task,owner),{code:'ASSIGNMENT_REQUIRED'});
});

test('reassignment removes the original creator authority while the new assignee can deliver and reopen', () => {
  const f = fixture(); f.importPeople();
  let task = f.call('task.create',{title:'待分配需求',reviewerPersonId:'ITRC-P0003',acceptanceCriteria:'交付完整文件'},null,owner);
  assert.equal(task.createdByEmail,owner.email);
  task = f.call('task.update',{ownerPersonId:'ITRC-P0002',ownerEmail:''},task);
  assert.throws(() => f.call('task.update',{title:'原建立者不應可改'},task,owner),{code:'OWNER_REQUIRED'});
  assert.throws(() => f.call('task.deliver',{deliverableUrl:'https://example.org/result'},task,owner),{code:'OWNER_REQUIRED'});
  task = f.call('task.update',{status:'doing'},task,reviewer);
  task = f.call('task.deliver',{deliverableUrl:'https://example.org/result'},task,reviewer);
  task = f.call('task.accept-delivery',{},task,other);
  assert.throws(() => f.call('task.reopen',{reason:'原建立者不應可重開'},task,owner),{code:'OWNER_REQUIRED'});
  assert.equal(f.call('task.reopen',{reason:'承辦人需要更新成果'},task,reviewer).status,'todo');
});

test('person IDs reject conflicting legacy email identities and remain authoritative after contact changes', () => {
  const f = fixture(); f.importPeople();
  assert.throws(() => f.call('task.create',{title:'矛盾身分',ownerPersonId:'ITRC-P0001',ownerEmail:other.email}),{code:'PERSON_EMAIL_MISMATCH'});
  assert.throws(() => f.call('project.create',{title:'矛盾督導',adviserPersonId:'ITRC-P0002',adviserEmail:owner.email}),{code:'PERSON_EMAIL_MISMATCH'});
  let task = f.call('task.create',{title:'同一人的舊帳號',ownerPersonId:'ITRC-P0001',ownerEmail:owner.email});
  assert.throws(() => f.call('task.update',{ownerEmail:other.email},task),{code:'PERSON_EMAIL_MISMATCH'});
  f.importPeople([{...roster[0],email:'new-owner@example.com'}]);
  assert.throws(() => f.call('task.update',{title:'舊MAIL不可繼續授權'},task,owner),{code:'OWNER_REQUIRED'});
  const newOwner = {...owner,email:'new-owner@example.com'};
  task = f.call('task.update',{ownerEmail:'',title:'新帳號核對後更新'},task,newOwner);
  assert.equal(task.title,'新帳號核對後更新');
});

test('ordinary task owners cannot remove required project or parent relationships to bypass completion', () => {
  const f = fixture(); f.importPeople();
  const project = f.call('project.create',{title:'由 B 管理的專案',ownerPersonId:'ITRC-P0002',completionCriteria:'必要任務皆完成'});
  let task = f.call('task.create',{title:'由 A 承辦的必要任務',projectId:project.id,ownerPersonId:'ITRC-P0001'});
  assert.throws(() => f.call('task.update',{projectId:''},task,owner),{code:'TASK_SCOPE_CHANGE_REQUIRED'});
  assert.throws(() => f.call('project.update',{status:'completed'},project,reviewer),{code:'PROJECT_TASKS_INCOMPLETE'});
  task = f.call('task.update',{projectId:''},task,reviewer);
  assert.equal(task.projectId,'');
  const parent = f.call('task.create',{title:'由 B 管理的上層任務',ownerPersonId:'ITRC-P0002'});
  let child = f.call('task.create',{title:'由 A 承辦的必要子任務',parentId:parent.id,ownerPersonId:'ITRC-P0001'});
  assert.throws(() => f.call('task.update',{parentId:''},child,owner),{code:'TASK_SCOPE_CHANGE_REQUIRED'});
  child = f.call('task.update',{parentId:''},child,reviewer);
  assert.equal(child.parentId,'');
});

test('task delivery requires criteria, an assigned independent reviewer and a valid result', () => {
  const f = taskFixture({acceptanceCriteria:''});
  assert.throws(() => f.call('task.deliver',{deliverableUrl:'https://example.org/result'},f.task,owner),{code:'ACCEPTANCE_CRITERIA_REQUIRED'});
  let task = f.call('task.update',{acceptanceCriteria:'交付內容可核對',reviewerPersonId:''},f.task,owner);
  assert.throws(() => f.call('task.deliver',{deliverableUrl:'https://example.org/result'},task,owner),{code:'TASK_REVIEWER_REQUIRED'});
  task = f.call('task.update',{reviewerPersonId:'ITRC-P0001'},task,owner);
  assert.throws(() => f.call('task.deliver',{deliverableUrl:'https://example.org/result'},task,owner),{code:'INDEPENDENT_REVIEW_REQUIRED'});
  task = f.call('task.update',{reviewerPersonId:'ITRC-P0002'},task,owner);
  assert.throws(() => f.call('task.deliver',{deliverableUrl:'http://example.org/result'},task,owner),{code:'INVALID_URL'});
});

test('direct status changes cannot bypass delivery and independent acceptance', () => {
  const f = taskFixture();
  for (const status of ['delivered','done']) assert.throws(() => f.call('task.update',{status,deliverableUrl:'https://example.org/result'},f.task,owner),{code:'TASK_REVIEW_ACTION_REQUIRED'});
  const task = f.call('task.deliver',{deliverableUrl:'https://example.org/result'},f.task,owner);
  assert.equal(task.status,'delivered'); assert.equal(task.acceptedBy,undefined);
  assert.throws(() => f.call('task.accept-delivery',{},task,owner),{code:'TASK_REVIEWER_REQUIRED'});
  const done = f.call('task.accept-delivery',{comment:'日期與地點核對完成'},task,reviewer);
  assert.equal(done.status,'done'); assert.equal(done.reviewIdentityMode,'individual_account');
  assert.equal(done.acceptedReviewerPersonId,'ITRC-P0002'); assert.equal(done.acceptedBy,reviewer.email);
  assert.equal(done.deliveryHistory.length,2);
});

test('shared account acceptance records external proof instead of impersonating a reviewer', () => {
  const f = taskFixture();
  const task = f.call('task.deliver',{deliverableUrl:'https://example.org/result'},f.task);
  assert.throws(() => f.call('task.accept-delivery',{},task),{code:'EXTERNAL_REVIEW_CONFIRMATION_REQUIRED'});
  assert.throws(() => f.call('task.accept-delivery',{confirmedExternalReview:true,evidenceUrl:'http://example.org/review'},task),{code:'INVALID_URL'});
  const done = f.call('task.accept-delivery',{confirmedExternalReview:true,evidenceUrl:'https://example.org/review'},task);
  assert.equal(done.reviewIdentityMode,'recorded_external_review');
  assert.equal(done.acceptedBy,admin.email); assert.equal(done.acceptedReviewerPersonId,'ITRC-P0002');
  assert.equal(done.reviewEvidenceUrl,'https://example.org/review');
  assert.match(f.read().audit[0].summary,/代登錄/);
});

test('returning or editing a delivery requires a fresh delivery; accepted evidence survives reopening', () => {
  const f = taskFixture();
  let task = f.call('task.deliver',{deliverableUrl:'https://example.org/result'},f.task,owner);
  assert.throws(() => f.call('task.return-delivery',{},task,reviewer),{code:'REASON_REQUIRED'});
  task = f.call('task.return-delivery',{reason:'請補課程日期'},task,reviewer);
  assert.equal(task.status,'todo'); assert.equal(task.returnReason,'請補課程日期');
  assert.throws(() => f.call('task.accept-delivery',{},task,reviewer),{code:'INVALID_STAGE'});
  task = f.call('task.deliver',{deliverableUrl:'https://example.org/result-v2'},task,owner);
  task = f.call('task.update',{deliverableUrl:'https://example.org/result-v3'},task,owner);
  assert.equal(task.status,'todo'); assert.equal(task.deliveredBy,undefined);
  task = f.call('task.deliver',{},task,owner);
  task = f.call('task.accept-delivery',{},task,reviewer);
  assert.throws(() => f.call('task.update',{title:'改寫已驗收'},task,owner),{code:'TASK_COMPLETED_IMMUTABLE'});
  assert.throws(() => f.call('task.reopen',{},task,owner),{code:'REASON_REQUIRED'});
  task = f.call('task.reopen',{reason:'活動日期更新，需再交件'},task,owner);
  assert.equal(task.status,'todo'); assert.equal(task.acceptedBy,undefined);
  assert.ok(task.deliveryHistory.some(row => row.action === 'task.accept-delivery' && row.deliverableUrl === 'https://example.org/result-v3'));
});

test('projects require criteria and accepted required tasks; cancelling a required task cannot bypass completion', () => {
  const f = fixture(); f.importPeople();
  let project = f.call('project.create',{title:'驗收專案',ownerPersonId:'ITRC-P0001'});
  assert.throws(() => f.call('project.update',{status:'completed'},project,owner),{code:'PROJECT_CRITERIA_REQUIRED'});
  project = f.call('project.update',{completionCriteria:'必要成果完成驗收'},project,owner);
  let task = f.call('task.create',{projectId:project.id,title:'必要任務',ownerPersonId:'ITRC-P0001',reviewerPersonId:'ITRC-P0002',acceptanceCriteria:'成果完整'});
  assert.throws(() => f.call('project.update',{status:'completed'},project,owner),{code:'PROJECT_TASKS_INCOMPLETE'});
  task = f.call('task.update',{status:'cancelled'},task,owner);
  assert.throws(() => f.call('project.update',{status:'completed'},project,owner),{code:'PROJECT_TASKS_INCOMPLETE'});
  task = f.call('task.reopen',{reason:'仍需交付'},task,owner);
  task = f.call('task.deliver',{deliverableUrl:'https://example.org/result'},task,owner);
  f.call('task.accept-delivery',{},task,reviewer);
  project = f.call('project.update',{status:'completed'},project,owner);
  assert.equal(project.status,'completed');
  assert.throws(() => f.call('task.create',{projectId:project.id,title:'不可在結案後偷偷加工作'}),{code:'PROJECT_CLOSED'});
});

test('parent tasks cannot be delivered while required child work awaits acceptance', () => {
  const f = taskFixture();
  let child = f.call('task.create',{title:'必要子任務',parentId:f.task.id,ownerPersonId:'ITRC-P0001',reviewerPersonId:'ITRC-P0002',acceptanceCriteria:'子成果完整'});
  assert.throws(() => f.call('task.deliver',{deliverableUrl:'https://example.org/parent'},f.task,owner),{code:'CHILD_TASKS_INCOMPLETE'});
  child = f.call('task.deliver',{deliverableUrl:'https://example.org/child'},child,owner);
  assert.throws(() => f.call('task.deliver',{deliverableUrl:'https://example.org/parent'},f.task,owner),{code:'CHILD_TASKS_INCOMPLETE'});
  f.call('task.accept-delivery',{},child,reviewer);
  assert.equal(f.call('task.deliver',{deliverableUrl:'https://example.org/parent'},f.task,owner).status,'delivered');
});

test('full post history retains approved content and source snapshots across later event changes', () => {
  const f = postFixture();
  const approved = f.post.history.find(row => row.action === 'post.approve');
  assert.equal(approved.caption,'第一版文案'); assert.equal(approved.slides[0].body,'原內文');
  assert.equal(approved.approvedBy,admin.email); assert.equal(approved.sourceEventSnapshot.venue,'原場地');
  f.call('event.update',{venue:'新場地',sourceRevision:'source-v2'},f.event,owner);
  const post = f.read().posts[0];
  assert.equal(post.approvedVersion,undefined); assert.equal(post.stage,'needs_revision');
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
