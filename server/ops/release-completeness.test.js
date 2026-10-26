'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp,rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {createClient} = require('@libsql/client');
const {executeAction} = require('./domain');
const {createOpsService} = require('./service');
const {KINDS} = require('./store');

const admin = {uid:'admin',email:'club@example.invalid',role:'advisor',canApprove:true};
const owner = {uid:'owner',email:'owner@example.invalid',role:'officer'};
const reviewer = {uid:'reviewer',email:'reviewer@example.invalid',role:'officer'};
const stranger = {uid:'other',email:'other@example.invalid',role:'officer'};
const roster = [
  {personId:'ITRC-P0001',name:'承辦示範',email:owner.email,status:'active'},
  {personId:'ITRC-P0002',name:'驗收示範',email:reviewer.email,status:'active'},
];
function fixture() {
  let state = Object.fromEntries([...KINDS,'audit'].map(kind => [kind,[]]));
  let tick = 0;
  const call = (action,payload = {},record,actor = admin) => {
    const next = structuredClone(state);
    const result = executeAction(next,{action,payload,id:record?.id,expectedVersion:record?.version},actor,new Date(Date.UTC(2030,0,1,0,0,tick++)).toISOString());
    state = next; return structuredClone(result.record);
  };
  const people = input => { const preview = call('people.import-preview',{people:input}); return call('people.import-apply',{people:input,previewToken:preview.previewToken}); };
  people(roster);
  return {call,people,read:() => structuredClone(state)};
}
function sourceFixture() {
  const f = fixture();
  const event = f.call('event.create',{title:'來源版本示範',ownerPersonId:'ITRC-P0001',speaker:'虛構講者',date:'2030-03-01',venue:'示範教室',sourceUrl:'https://example.org/fileos/master',sourceRevision:'master-v1'});
  const payload = {targetKind:'events',targetId:event.id,targetVersion:event.version,sourceKey:'COURSE-001',baseSourceRevision:'master-v1',reason:'將已核對的場地資訊回寫原始檔。'};
  const propose = () => f.call('source-change.propose',payload,null,owner);
  const approve = change => f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:'master-v1'},change);
  return {...f,event,payload,propose,approve};
}

test('retired people retain historical assignments while both ID and legacy-email actors lose access', () => {
  const f = fixture();
  const task = f.call('task.create',{title:'留存交付',ownerPersonId:roster[0].personId,reviewerPersonId:roster[1].personId});
  f.people([{...roster[0],status:'retired'}]);
  assert.equal(f.read().tasks[0].ownerPersonId,roster[0].personId);
  assert.equal(f.read().people.length,2);
  assert.throws(() => f.call('task.create',{title:'不可重新派工',ownerPersonId:roster[0].personId}),{code:'PERSON_INACTIVE'});
  assert.throws(() => f.call('task.update',{title:'離任後不可更改'},task,owner),{code:'PERSON_ACCESS_REVOKED'});
  assert.throws(() => f.call('task.create',{title:'舊角色不能建立',ownerEmail:owner.email},null,owner),{code:'PERSON_ACCESS_REVOKED'});
  const reassigned = f.call('task.update',{ownerPersonId:roster[1].personId,reviewerPersonId:'',ownerEmail:''},task);
  assert.equal(reassigned.ownerPersonId,roster[1].personId);
});

test('revocation blocks bootstrap and cached idempotent replay even with a still-authorized external role', async t => {
  const dir = await mkdtemp(join(tmpdir(),'itrc-retirement-'));
  const db = createClient({url:`file:${join(dir,'test.db')}`});
  t.after(async () => {db.close();await rm(dir,{recursive:true,force:true});});
  const service = createOpsService({db,env:{},providers:{getIntegrationStatus:() => ({})}});
  await service.ready;
  const act = (actor,action,payload,record,key = randomUUID()) => service.action(actor,{action,payload,id:record?.id,expectedVersion:record?.version,idempotencyKey:key});
  const preview = (await act(admin,'people.import-preview',{people:roster})).record;
  await act(admin,'people.import-apply',{people:roster,previewToken:preview.previewToken});
  const key = randomUUID();
  await act(owner,'task.create',{title:'離任前建立'},null,key);
  const changes = [{...roster[0],status:'retired'}];
  const departure = (await act(admin,'people.import-preview',{people:changes})).record;
  await act(admin,'people.import-apply',{people:changes,previewToken:departure.previewToken});
  await assert.rejects(service.bootstrap(owner),{code:'PERSON_ACCESS_REVOKED'});
  await assert.rejects(act(owner,'task.create',{title:'離任前建立'},null,key),{code:'PERSON_ACCESS_REVOKED'});
  assert.equal((await service.bootstrap(admin)).tasks.length,1);
});

test('current collaborators can discuss tasks while earlier completion evidence remains unchanged', () => {
  const f = fixture();
  let task = f.call('task.create',{title:'成果整理',ownerPersonId:roster[0].personId,reviewerPersonId:roster[1].personId});
  task = f.call('task.comment',{text:'其他幹部補充現場資訊'},task,stranger);
  assert.equal(task.comments[0].actorEmail,stranger.email);
  assert.throws(() => f.call('task.comment',{text:'',actorEmail:admin.email},task,owner),{code:'UNSUPPORTED_FIELD'});
  task = f.call('task.comment',{text:'已核對場地資料',attachmentUrl:'https://example.org/evidence'},task,reviewer);
  assert.throws(() => f.call('task.add-link',{title:'不可執行',url:'javascript:alert(1)'},task,owner),{code:'INVALID_URL'});
  task = f.call('task.add-link',{title:'原始文件',url:'https://example.org/file-a'},task,owner);
  assert.throws(() => f.call('task.add-link',{title:'重複',url:'https://example.org/file-a'},task,owner),{code:'LINK_EXISTS'});
  task = f.call('task.deliver',{deliverableUrl:'https://example.org/result'},task,owner);
  const deliveredLinks = structuredClone(task.deliveryHistory.at(-1).links);
  task = f.call('task.add-link',{title:'後續補充',url:'https://example.org/file-b'},task,reviewer);
  assert.equal(task.status,'done'); assert.equal(task.links.length,2);
  assert.deepEqual(task.deliveryHistory.find(row => row.action === 'task.deliver').links,deliveredLinks);
  assert.equal(task.completedBy,owner.email);
});

test('source proposals capture a fixed workflow version and deduplicate identical pending work', () => {
  const f = sourceFixture();
  const before = f.read().events;
  const change = f.propose();
  assert.equal(change.status,'pending'); assert.equal(change.values.title,f.event.title);
  assert.equal(f.propose().id,change.id);
  assert.equal(f.read().sourceChanges.length,1);
  assert.deepEqual(f.read().events,before);
  assert.throws(() => f.call('source-change.propose',{...f.payload,targetKind:'toString'},null,owner),{code:'SOURCE_KIND_INVALID'});
  assert.throws(() => f.call('source-change.propose',{...f.payload,targetVersion:999},null,owner),{code:'VERSION_CONFLICT'});
});

test('source approval requires a manager, explicit source check, and the same observed revision', () => {
  const f = sourceFixture(); const change = f.propose();
  assert.throws(() => f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:'master-v1'},change,owner),{code:'ADVISOR_REQUIRED'});
  assert.throws(() => f.call('source-change.export',{},change),{code:'SOURCE_APPROVAL_REQUIRED'});
  assert.throws(() => f.call('source-change.approve',{observedSourceRevision:'master-v1'},change),{code:'SOURCE_CONFIRMATION_REQUIRED'});
  assert.throws(() => f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:'master-v2'},change),{code:'SOURCE_REVISION_CONFLICT'});
  assert.equal(f.approve(change).status,'approved');
});

test('approved export is explicitly pending external writeback and never exports private people or credentials', () => {
  const f = sourceFixture(); const change = f.approve(f.propose());
  const output = f.call('source-change.export',{},change);
  assert.equal(output.package.status,'approved_pending_writeback');
  assert.equal(output.package.expectedSourceRevision,'master-v1');
  assert.equal(output.package.writeMode,'reviewed_manual_writeback');
  assert.match(output.package.checksumSha256,/^[a-f0-9]{64}$/);
  assert.equal(output.package.values.ownerPersonId,roster[0].personId);
  assert.equal(output.package.values.email,undefined);
  assert.equal(JSON.stringify(output).includes(owner.email),false);
  assert.equal(output.package.people,undefined);
  assert.equal(f.read().sourceChanges[0].status,'approved');
});

test('workflow changes invalidate a source proposal at approval, export and writeback', () => {
  const f = sourceFixture(); let change = f.approve(f.propose());
  f.call('event.update',{venue:'已修改教室'},f.event,owner);
  assert.throws(() => f.call('source-change.export',{},change),{code:'SOURCE_WORKFLOW_CHANGED'});
  assert.throws(() => f.call('source-change.record-writeback',{confirmedSourceWriteback:true,observedSourceRevision:'master-v1',appliedSourceRevision:'master-v2',evidenceUrl:'https://example.org/proof'},change),{code:'SOURCE_WORKFLOW_CHANGED'});
  change = f.call('source-change.reject',{reason:'工作資料已變更，依新版重新提出。'},change);
  assert.equal(change.status,'rejected');
});

test('writeback completion records manual evidence and a new revision without mutating the original workflow data', () => {
  const f = sourceFixture(); let change = f.approve(f.propose());
  const before = f.read().events;
  const payload = {confirmedSourceWriteback:true,observedSourceRevision:'master-v1',appliedSourceRevision:'master-v2',evidenceUrl:'https://example.org/master-revision-2'};
  assert.throws(() => f.call('source-change.record-writeback',{...payload,confirmedSourceWriteback:false},change),{code:'SOURCE_CONFIRMATION_REQUIRED'});
  assert.throws(() => f.call('source-change.record-writeback',{...payload,appliedSourceRevision:'master-v1'},change),{code:'SOURCE_NEW_REVISION_REQUIRED'});
  assert.throws(() => f.call('source-change.record-writeback',{...payload,evidenceUrl:'file:///tmp/private'},change),{code:'INVALID_URL'});
  change = f.call('source-change.record-writeback',payload,change);
  assert.equal(change.status,'written_back'); assert.equal(change.writebackMode,'human_recorded');
  assert.deepEqual(f.read().events,before);
  assert.throws(() => f.call('source-change.record-writeback',payload,change),{code:'SOURCE_APPROVAL_REQUIRED'});
  assert.throws(() => f.propose(),{code:'SOURCE_REVISION_CONFLICT'});
  const next = f.call('source-change.propose',{...f.payload,baseSourceRevision:'master-v2'},null,owner);
  assert.equal(next.baseSourceRevision,'master-v2');
});


test('lesson checklist previews are read-only, require confirmation, and repeated apply never duplicates tasks', () => {
  const f = sourceFixture();
  const preview = f.call('event.preview-checklist',{},f.event,owner);
  assert.equal(preview.tasks.length,8); assert.equal(f.read().tasks.length,0);
  assert.equal(preview.tasks.find(task => task.key === 'speaker').dueDate,'2030-02-08');
  assert.equal(preview.tasks.find(task => task.key === 'closeout').dueDate,'2030-03-08');
  assert.throws(() => f.call('event.apply-checklist',{templateId:preview.templateId},f.event,owner),{code:'TEMPLATE_CONFIRMATION_REQUIRED'});
  const result = f.call('event.apply-checklist',{templateId:preview.templateId,confirmed:true},f.event,owner);
  assert.equal(result.created,8);
  assert.ok(f.read().tasks.every(task => task.status === 'todo' && task.ownerEmail === '' && task.ownerPersonId === '' && task.reviewerPersonId === ''));
  const again = f.call('event.apply-checklist',{templateId:preview.templateId,confirmed:true},f.event,owner);
  assert.equal(again.created,0); assert.equal(again.skipped,8); assert.equal(f.read().tasks.length,8);
});

test('lesson checklist requires activity ownership, a real date and a current event version', () => {
  const f = sourceFixture();
  assert.throws(() => f.call('event.preview-checklist',{},f.event,stranger),{code:'OWNER_REQUIRED'});
  const event = f.call('event.create',{title:'日期未定',ownerPersonId:roster[0].personId});
  assert.throws(() => f.call('event.preview-checklist',{},event,owner),{code:'EVENT_DATE_REQUIRED'});
  const updated = f.call('event.update',{date:'2030-04-01'},f.event,owner);
  assert.throws(() => f.call('event.apply-checklist',{confirmed:true,templateId:'itrc-lesson-v1'},f.event,owner),{code:'VERSION_CONFLICT'});
  const preview = f.call('event.preview-checklist',{},updated,owner);
  assert.equal(preview.tasks.find(task => task.key === 'closeout').dueDate,'2030-04-08');
});


test('successive source writebacks retain a monotonic version chain despite an older workflow sourceRevision', () => {
  const f = sourceFixture();
  const write = (base,next) => {
    let change = f.call('source-change.propose',{...f.payload,baseSourceRevision:base},null,owner);
    change = f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:base},change);
    return f.call('source-change.record-writeback',{confirmedSourceWriteback:true,observedSourceRevision:base,appliedSourceRevision:next,evidenceUrl:'https://example.org/readback'},change);
  };
  const one = write('master-v1','master-v2');
  const two = write('master-v2','master-v3');
  assert.equal(two.baseWritebackId,one.id); assert.equal(two.writebackSequence,2);
  assert.throws(() => f.propose(),{code:'SOURCE_REVISION_CONFLICT'});
  assert.throws(() => f.call('source-change.propose',{...f.payload,baseSourceRevision:'master-v2'},null,owner),{code:'SOURCE_REVISION_CONFLICT'});
  const three = write('master-v3','master-v4');
  assert.equal(three.baseWritebackId,two.id); assert.equal(three.writebackSequence,3);
  assert.equal(f.read().events[0].sourceRevision,'master-v1');
});

test('a same-timestamp writeback cannot bypass another proposal chain lock', () => {
  const f = sourceFixture(); const first = f.approve(f.propose());
  const otherEvent = f.call('event.create',{title:'同來源另一份工作快照',sourceUrl:f.event.sourceUrl,sourceRevision:'master-v1'});
  let other = f.call('source-change.propose',{...f.payload,targetId:otherEvent.id,targetVersion:otherEvent.version});
  other = f.approve(other);
  const state = f.read();
  const stamp = other.createdAt;
  executeAction(state,{action:'source-change.record-writeback',id:first.id,expectedVersion:first.version,payload:{confirmedSourceWriteback:true,observedSourceRevision:'master-v1',appliedSourceRevision:'master-v2',evidenceUrl:'https://example.org/proof'}},admin,stamp);
  assert.throws(() => executeAction(state,{action:'source-change.export',id:other.id,expectedVersion:other.version},admin,stamp),{code:'SOURCE_REVISION_CONFLICT'});
});

test('an unassigned creator may propose but cannot approve, and loses proposal authority after reassignment', () => {
  const f = fixture();
  let task = f.call('task.create',{title:'未指派來源提案',sourceUrl:'https://example.org/master',sourceRevision:'v1'},null,owner);
  const input = {targetKind:'tasks',targetId:task.id,targetVersion:task.version,sourceKey:'TASK-001',baseSourceRevision:'v1',reason:'待核對資料'};
  const change = f.call('source-change.propose',input,null,owner);
  assert.throws(() => f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:'v1'},change,owner),{code:'ADVISOR_REQUIRED'});
  task = f.call('task.update',{ownerPersonId:roster[1].personId},task);
  assert.throws(() => f.call('source-change.propose',{...input,targetVersion:task.version},null,owner),{code:'OWNER_REQUIRED'});
  assert.throws(() => f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:'v1'},change),{code:'SOURCE_WORKFLOW_CHANGED'});
});
