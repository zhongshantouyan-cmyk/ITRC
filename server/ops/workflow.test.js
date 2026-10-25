'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createOpsService } = require('./service');
const { createOpsRouter } = require('./index');
const { actorFromIdentity } = require('./auth');

const env = { OPS_APPROVER_EMAILS:'approver@example.com', OPS_DESIGNER_EMAILS:'designer@example.com' };
const identity = email => ({uid:email,email,email_verified:true,name:email.split('@')[0]});
const actor = (email,role='officer') => actorFromIdentity(identity(email),role,env);
const admin = actor('admin@example.com','advisor');
const owner = actor('owner@example.com');
const approver = actor('approver@example.com');
const designer = actor('designer@example.com');
const outsider = actor('other@example.com');
const providers = {
  getIntegrationStatus:() => ({drafting:{configured:false,status:'rules'},canva:{configured:true},sheets:{configured:false}}),
  generateCopy:async () => ({caption:'這是標示為規則草稿的示範內容',slides:[{heading:'標題',body:'內容'}],generationMethod:'rules'}),
  createCanvaDesign:async () => ({providerJobId:'fake-job',status:'in_progress'}),
  getCanvaJob:async () => ({providerJobId:'fake-job',status:'success',canvaDesignId:'TEST-design',canvaEditUrl:'https://www.canva.com/design/TEST-design/edit'}),
};
async function fixture(t,customProviders = {},customEnv = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(),'itrc-ops-'));
  const db = createClient({url:`file:${path.join(dir,'test.db')}`});
  const service = createOpsService({db,providers:{...providers,...customProviders},env:{...env,...customEnv}});
  await service.ready;
  t.after(async () => { db.close(); await rm(dir,{recursive:true,force:true}); });
  const command = (action,payload = {},record,principal=owner,key=randomUUID()) => service.action(principal,{action,id:record?.id,expectedVersion:record?.version,payload,idempotencyKey:key});
  return {db,service,command,dir};
}
async function readyPost(f,{sponsor=false}={}) {
  const project = (await f.command('project.create',{title:'測試專案',ownerEmail:owner.email},null,admin)).record;
  let event = (await f.command('event.create',{projectId:project.id,title:'測試講座',speaker:'示範講者',date:'2026-11-01',venue:'示範場地'},null,owner)).record;
  event = (await f.command('event.confirm',{},event)).record;
  if (sponsor) await f.command('obligation.create',{projectId:project.id,eventId:event.id,title:'示範贊助義務',requirements:'須檢查贊助標誌',requiresSponsorReview:true,channel:'all'},null,owner);
  let post = (await f.command('post.create',{projectId:project.id,eventId:event.id,title:'示範貼文',caption:'已核對的活動資訊',slides:[{heading:'標題',body:'內文'}]},null,owner)).record;
  post = (await f.command('post.submit',{},post)).record;
  post = (await f.command('post.unit-review',{},post)).record;
  return {project,event,post};
}
async function approvedPost(f,options) {
  const records = await readyPost(f,options);
  records.post = (await f.command('post.approve',{},records.post,approver)).record;
  return records;
}
async function deliveredPost(f,options) {
  const records = await approvedPost(f,options);
  await f.service.runJobs({limit:3}); await f.service.runJobs({limit:3});
  records.post = (await f.service.bootstrap(owner)).posts.find(post => post.id === records.post.id);
  records.post = (await f.command('post.design-review',{},records.post,designer)).record;
  return records;
}

test('actor identity requires verified Firebase email and server configured roles', () => {
  assert.throws(() => actorFromIdentity({...identity(owner.email),email_verified:false},'advisor',env),{code:'IDENTITY_REQUIRED'});
  assert.throws(() => actorFromIdentity(identity(owner.email),'unregistered',env),{code:'ROLE_REQUIRED'});
  assert.equal(actorFromIdentity(identity(approver.email),'officer',{}).canApprove,false);
  assert.equal(owner.canApprove,false);
});

test('legacy shared JWT and submitted actor cannot authorize production actions', async t => {
  const f = await fixture(t);
  const app = express();
  app.use('/api/ops',createOpsRouter({db:f.db,providers,env,firebase:{verifyFirebaseToken:async token => { if (token !== 'firebase-owner') throw Error('invalid'); return identity(owner.email); },resolveRole:async () => 'officer'}}));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/ops`;
  const legacy = jwt.sign({email:approver.email,role:'advisor'},'itrc-secret-key-change-in-production');
  const rejected = await fetch(`${url}/bootstrap`,{headers:{Authorization:`Bearer ${legacy}`}});
  assert.equal(rejected.status,401);
  const response = await fetch(`${url}/actions`,{method:'POST',headers:{Authorization:'Bearer firebase-owner','Content-Type':'application/json'},body:JSON.stringify({action:'project.create',actor:{email:approver.email,canApprove:true},payload:{title:'身分防偽驗證'},idempotencyKey:randomUUID()})});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.record.ownerEmail,owner.email);
  const bootstrap = await (await fetch(`${url}/bootstrap`,{headers:{Authorization:'Bearer firebase-owner'}})).json();
  assert.equal(bootstrap.actor.canApprove,false);
});

test('final approval is restricted and each approval creates exactly one durable design job',async t => {
  const f = await fixture(t); const {post} = await readyPost(f);
  await assert.rejects(f.command('post.approve',{},post,owner),{code:'FINAL_APPROVER_REQUIRED'});
  await assert.rejects(f.command('post.update',{approvedVersion:post.copyVersion,stage:'ready'},post),{code:'UNSUPPORTED_FIELD'});
  const key = randomUUID();
  const command = {action:'post.approve',id:post.id,expectedVersion:post.version,payload:{},idempotencyKey:key};
  const [a,b] = await Promise.all([f.service.action(approver,command),f.service.action(approver,command)]);
  assert.equal(a.record.approvedVersion,post.copyVersion); assert.deepEqual(a.record,b.record);
  const state = await f.service.bootstrap(owner); assert.equal(state.jobs.length,1); assert.equal(state.jobs[0].status,'queued');
  assert.equal(state.audit.filter(row => row.action === 'post.approve').length,1);
  await assert.rejects(f.service.action(approver,{...command,payload:{different:true}}),{code:'IDEMPOTENCY_CONFLICT'});
});

test('ownership and optimistic versions prevent unauthorized or stale edits',async t => {
  const f = await fixture(t); const {post} = await readyPost(f);
  await assert.rejects(f.command('post.update',{caption:'改寫'},post,outsider),{code:'OWNER_REQUIRED'});
  const edited = (await f.command('post.update',{caption:'新版內容'},post)).record;
  assert.equal(edited.copyVersion,2); assert.equal(edited.stage,'draft'); assert.equal(edited.unitReviewedVersion,undefined);
  await assert.rejects(f.command('post.approve',{},post,approver),{code:'VERSION_CONFLICT'});
});

test('unconfirmed/incomplete event facts cannot pass unit review or final approval',async t => {
  const f = await fixture(t);
  const event = (await f.command('event.create',{title:'待確認活動'})).record;
  await assert.rejects(f.command('event.confirm',{},event),{code:'EVENT_INCOMPLETE'});
  const post = (await f.command('post.create',{eventId:event.id,title:'草稿',caption:'內容',slides:[{heading:'標題',body:'內文'}]})).record;
  await assert.rejects(f.command('post.submit',{},post),{code:'EVENT_UNCONFIRMED'});
});

test('event and obligation changes invalidate all dependent unpublished approvals',async t => {
  const f = await fixture(t); const {event,post,project} = await approvedPost(f);
  const updatedEvent = (await f.command('event.update',{date:'2026-11-02'},event)).record;
  let state = await f.service.bootstrap(owner); let updatedPost = state.posts.find(item => item.id === post.id);
  assert.equal(updatedEvent.confirmationStatus,'changed'); assert.equal(updatedPost.stage,'needs_revision');
  assert.equal(updatedPost.approvedVersion,undefined); assert.equal(state.jobs[0].status,'obsolete');
  const version = updatedPost.copyVersion;
  await f.command('obligation.create',{projectId:project.id,title:'新增贊助義務',requirements:'需附指定標誌',requiresSponsorReview:true});
  state = await f.service.bootstrap(owner); updatedPost = state.posts.find(item => item.id === post.id);
  assert.equal(updatedPost.copyVersion,version+1);
});

test('Canva jobs preserve version lineage and require sponsor evidence before recording publication',async t => {
  const f = await fixture(t); let {post} = await deliveredPost(f,{sponsor:true});
  assert.equal(post.stage,'sponsor_review'); assert.equal(post.designCopyVersion,post.copyVersion);
  await assert.rejects(f.command('post.publish',{publishedUrl:'https://example.org/post',publishedAt:new Date().toISOString()},post,designer),{code:'NOT_READY'});
  await assert.rejects(f.command('post.sponsor-review',{confirmed:true,evidenceUrl:'http://example.org/evidence'},post,designer),{code:'INVALID_URL'});
  post = (await f.command('post.sponsor-review',{confirmed:true,evidenceUrl:'https://example.org/evidence'},post,designer)).record;
  post = (await f.command('post.publish',{publishedUrl:'https://example.org/post',publishedAt:new Date().toISOString()},post,designer)).record;
  assert.equal(post.stage,'published'); assert.equal(post.sponsorApprovedVersion,post.copyVersion);
});

test('published evidence remains immutable and fact changes create a correction task',async t => {
  const f = await fixture(t); let {post,event} = await deliveredPost(f);
  post = (await f.command('post.publish',{publishedUrl:'https://example.org/published',publishedAt:new Date().toISOString()},post,designer)).record;
  await f.command('event.update',{venue:'新的示範場地'},event);
  const state = await f.service.bootstrap(owner); const preserved = state.posts.find(item => item.id === post.id);
  assert.equal(preserved.publishedUrl,post.publishedUrl); assert.equal(preserved.stage,'published'); assert.equal(preserved.version,post.version);
  assert.equal(state.tasks.filter(task => task.postId === post.id).length,1);
  await assert.rejects(f.command('post.update',{caption:'直接覆蓋歷史'},post),{code:'PUBLISHED_IMMUTABLE'});
});

test('task dependency cycles, missing references and missing deliverables are rejected',async t => {
  const f = await fixture(t);
  const people = [{personId:'ITRC-P0001',name:'示範驗收人',email:outsider.email,status:'active'}];
  const preview = (await f.command('people.import-preview',{people},null,admin)).record;
  await f.command('people.import-apply',{people,previewToken:preview.previewToken},null,admin);
  const first = (await f.command('task.create',{title:'前置任務',ownerEmail:owner.email,reviewerPersonId:'ITRC-P0001',acceptanceCriteria:'成果可開啟並包含完整內容'})).record;
  const second = (await f.command('task.create',{title:'後續任務',ownerEmail:owner.email,dependsOn:[first.id]})).record;
  await assert.rejects(f.command('task.update',{dependsOn:[second.id]},first),{code:'DEPENDENCY_CYCLE'});
  await assert.rejects(f.command('task.update',{dependsOn:['missing']},first),{code:'DEPENDENCY_MISSING'});
  await assert.rejects(f.command('task.update',{status:'doing'},second),{code:'DEPENDENCY_BLOCKED'});
  await assert.rejects(f.command('task.update',{status:'done'},first),{code:'TASK_REVIEW_ACTION_REQUIRED'});
  await assert.rejects(f.command('task.deliver',{},first),{code:'INVALID_URL'});
  await assert.rejects(f.command('task.update',{status:'blocked'},first),{code:'BLOCKER_REQUIRED'});
  const delivered = (await f.command('task.deliver',{deliverableUrl:'https://example.org/result'},first)).record;
  const done = (await f.command('task.accept-delivery',{},delivered,outsider)).record;
  assert.equal(done.status,'done');
  const doing = (await f.command('task.update',{status:'doing'},second)).record; assert.equal(doing.status,'doing');
});

test('missing provider configuration remains visible; ambiguous Canva writes cannot be blindly retried',async t => {
  const f = await fixture(t,{createCanvaDesign:async () => {const error = new Error('secret must not escape'); error.code='UNCERTAIN_RESULT'; error.uncertain=true; throw error;}});
  await approvedPost(f); await f.service.runJobs({limit:1});
  let state = await f.service.bootstrap(owner); const job = state.jobs[0];
  assert.equal(job.status,'needs_reconciliation'); assert.ok(!job.lastError.includes('secret'));
  await assert.rejects(f.command('job.retry',{},job,admin),{code:'RETRY_NOT_ALLOWED'});
  await f.service.runJobs({limit:1}); state = await f.service.bootstrap(owner); assert.equal(state.jobs[0].attempts,1);
  const g = await fixture(t,{createCanvaDesign:async () => {const error=new Error('missing'); error.code='CONFIGURATION_MISSING'; error.configMissing=true; error.definite=true; throw error;}});
  await approvedPost(g); await g.service.runJobs({limit:1}); const blocked=(await g.service.bootstrap(owner)).jobs[0]; assert.equal(blocked.status,'blocked_configuration');
});

test('copy generation is labelled, durable, and does not auto-approve',async t => {
  const f = await fixture(t);
  const event = (await f.command('event.create',{title:'示範活動'})).record;
  const post = (await f.command('post.create',{title:'示範貼文',eventId:event.id})).record;
  const key = randomUUID(); const response = await f.command('post.generate',{},post,owner,key);
  assert.equal(response.record.status,'succeeded');
  await f.command('post.generate',{},post,owner,key);
  const state = await f.service.bootstrap(owner);
  assert.equal(state.jobs.length,1); assert.equal(state.posts[0].generationMethod,'rules'); assert.equal(state.posts[0].stage,'draft'); assert.equal(state.posts[0].approvedVersion,undefined);
});

test('import previews never insert business records; repeated source rows deduplicate and stay drafts',async t => {
  const f = await fixture(t);
  const payload = {events:[{title:'匯入示範',speaker:'講者',date:'2026-11-10',venue:'場地',sourceUrl:'https://example.org/source',sourceRevision:'v1'}],tasks:[]};
  const preview = await f.command('import.preview',payload,null,admin); assert.equal(preview.record.events.length,1);
  assert.equal((await f.service.bootstrap(owner)).events.length,0);
  await assert.rejects(f.command('import.apply',payload,null,owner),{code:'ADVISOR_REQUIRED'});
  await f.command('import.apply',payload,null,admin); await f.command('import.apply',payload,null,admin);
  const state = await f.service.bootstrap(owner); assert.equal(state.events.length,1); assert.equal(state.events[0].confirmationStatus,'draft'); assert.equal(state.events[0].sourceRevision,'v1');
});

test('records and audit survive a fresh database connection',async t => {
  const f = await fixture(t); const created = (await f.command('project.create',{title:'持久化示範'})).record;
  const db2 = createClient({url:`file:${path.join(f.dir,'test.db')}`});
  t.after(() => db2.close());
  const reopened = createOpsService({db:db2,providers,env});
  const state = await reopened.bootstrap(owner); assert.equal(state.projects[0].id,created.id); assert.equal(state.audit.length,1);
});

test('people, accepted deliveries and complete source-linked copy history persist across reconnection',async t => {
  const f = await fixture(t);
  const people = [
    {personId:'ITRC-P0001',name:'示範承辦人',email:owner.email,status:'active'},
    {personId:'ITRC-P0002',name:'示範驗收人',email:outsider.email,status:'active'},
  ];
  const preview = (await f.command('people.import-preview',{people},null,admin)).record;
  await f.command('people.import-apply',{people,previewToken:preview.previewToken},null,admin);
  let task = (await f.command('task.create',{title:'持久化交件',ownerPersonId:'ITRC-P0001',reviewerPersonId:'ITRC-P0002',acceptanceCriteria:'完整交付證據'},null,admin)).record;
  task = (await f.command('task.deliver',{deliverableUrl:'https://example.org/result'},task,owner)).record;
  task = (await f.command('task.accept-delivery',{},task,outsider)).record;
  let {post,event} = await approvedPost(f);
  const approved = post.history.find(row => row.action === 'post.approve');
  post = (await f.command('post.update',{caption:'需保留的新版本'},post,owner)).record;
  const db2 = createClient({url:`file:${path.join(f.dir,'test.db')}`});
  t.after(() => db2.close());
  const reopened = createOpsService({db:db2,providers,env});
  const state = await reopened.bootstrap(owner);
  assert.equal(state.people.length,2);
  assert.equal(state.tasks.find(row => row.id === task.id).reviewIdentityMode,'individual_account');
  assert.equal(state.tasks.find(row => row.id === task.id).deliveryHistory.at(-1).deliverableUrl,'https://example.org/result');
  const saved = state.posts.find(row => row.id === post.id);
  assert.equal(saved.caption,'需保留的新版本');
  assert.equal(saved.approvedVersion,undefined);
  const savedApproval = saved.history.find(row => row.id === approved.id);
  assert.equal(savedApproval.caption,'已核對的活動資訊');
  assert.equal(savedApproval.sourceEventSnapshot.id,event.id);
  assert.equal(savedApproval.approvedBy,approver.email);
});

test('manual design attachments cannot use lookalike domains or bypass final approval',async t => {
  const f = await fixture(t); let {post} = await readyPost(f);
  await assert.rejects(f.command('post.attach-design',{canvaEditUrl:'https://www.canva.com/design/TEST/edit'},post,designer),{code:'APPROVAL_REQUIRED'});
  post = (await f.command('post.approve',{},post,approver)).record;
  await assert.rejects(f.command('post.attach-design',{canvaEditUrl:'https://canva.com.attacker.example/design/TEST/edit'},post,designer),{code:'INVALID_CANVA_URL'});
});

test('in-flight Canva results never overwrite later copy edits and keep the external job identity',async t => {
  let release, entered;
  const waiting = new Promise(resolve => { release=resolve; });
  const started = new Promise(resolve => { entered=resolve; });
  const f = await fixture(t,{createCanvaDesign:async () => { entered(); return waiting; }});
  const {post} = await approvedPost(f);
  const running = f.service.runJobs({limit:1}); await started;
  const edited = (await f.command('post.update',{caption:'等待設計期間完成的新版內容'},post)).record;
  release({status:'in_progress',providerJobId:'external-late-job'}); await running;
  const state = await f.service.bootstrap(owner);
  assert.equal(state.posts[0].caption,edited.caption); assert.equal(state.posts[0].canvaEditUrl,undefined);
  assert.equal(state.jobs[0].status,'obsolete'); assert.equal(state.jobs[0].providerJobId,'external-late-job');
});

test('configured sheet previews are read-only, preserve source evidence and reject arbitrary source IDs',async t => {
  let calls=0;
  const f = await fixture(t,{readSheetSource:async ({spreadsheetId,range}) => {
    calls++; assert.equal(spreadsheetId,'example_sheet_id_123'); assert.equal(range,'活動!A1:D20');
    return {values:[['標題','日期','講者','地點'],['示範來源課程','2026-11-01','示範講者','示範場地']],fetchedAt:'2026-10-25T00:00:00Z'};
  }},{OPS_SHEET_SOURCES_JSON:JSON.stringify([{id:'semester',name:'學期來源',spreadsheetId:'example_sheet_id_123',range:'活動!A1:D20',kind:'events',columns:{title:'標題',date:'日期',speaker:'講者',venue:'地點'}}])});
  await assert.rejects(f.command('import.sheet-preview',{sourceId:'arbitrary'},null,admin),{code:'SOURCE_NOT_ALLOWED'});
  const response = await f.command('import.sheet-preview',{sourceId:'semester'},null,admin);
  assert.equal(calls,1); assert.equal(response.record.events[0].sourceRevision,'2026-10-25T00:00:00Z');
  assert.equal(response.staged.events[0].sourceUrl,'https://docs.google.com/spreadsheets/d/example_sheet_id_123/edit');
  assert.equal((await f.service.bootstrap(owner)).events.length,0);
});

test('automatic design execution is opt-in and retains final human approval as the gate',async t => {
  let creations=0;
  const f = await fixture(t,{createCanvaDesign:async () => {creations++; return {providerJobId:'auto-job',status:'in_progress'};}},{OPS_AUTO_RUN_JOBS:'true'});
  const {post} = await readyPost(f); assert.equal(creations,0);
  const key = randomUUID();
  await f.command('post.approve',{},post,approver,key); assert.equal(creations,1);
  await f.command('post.approve',{},post,approver,key); assert.equal(creations,1);
});

test('a semester import joins promotional rows to event source keys without importing approvals',async t => {
  const f = await fixture(t);
  const payload = {
    events:[{title:'示範學期課程',sourceKey:'course-demo-01',sourceUrl:'https://example.org/semester',date:'2026-11-10',speaker:'示範講者',venue:'示範教室'}],
    posts:[
      {title:'課程預告',eventSourceKey:'course-demo-01',sourceKey:'post-demo-01',sourceUrl:'https://example.org/semester',purpose:'預告課程',channel:'instagram'},
      {title:'課程倒數',eventSourceKey:'course-demo-01',sourceKey:'post-demo-02',sourceUrl:'https://example.org/semester',purpose:'提醒報名',channel:'story'},
    ], tasks:[],
  };
  const preview = await f.command('import.preview',payload,null,admin);
  assert.equal(preview.record.posts.length,2); assert.equal((await f.service.bootstrap(owner)).posts.length,0);
  const applied = await f.command('import.apply',payload,null,admin); assert.equal(applied.record.importedEvents,1); assert.equal(applied.record.importedPosts,2);
  let state = await f.service.bootstrap(owner);
  assert.equal(state.events.length,1); assert.equal(state.posts.length,2);
  assert.ok(state.posts.every(post => post.eventId === state.events[0].id && post.stage === 'brief' && !post.approvedVersion));
  await f.command('import.apply',payload,null,admin); state = await f.service.bootstrap(owner); assert.equal(state.posts.length,2);
  await assert.rejects(f.command('import.apply',{posts:[{...payload.posts[0],sourceKey:'bad',stage:'approved',approvedVersion:1}]},null,admin),{code:'UNSUPPORTED_FIELD'});
  await assert.rejects(f.command('import.apply',{posts:[{...payload.posts[0],sourceKey:'bad',eventSourceKey:'missing-key'}]},null,admin),{code:'EVENT_REQUIRED'});
});

test('local spreadsheet imports preserve filename provenance without requiring a public URL',async t => {
  const f = await fixture(t);
  const payload = {events:[{title:'本機匯入範例',sourceLabel:'社團學期規劃.csv',sourceRevision:'sha256:example-file-version'}]};
  await f.command('import.apply',payload,null,admin); await f.command('import.apply',payload,null,admin);
  const state = await f.service.bootstrap(owner); assert.equal(state.events.length,1); assert.equal(state.events[0].sourceLabel,'社團學期規劃.csv');
  await assert.rejects(f.command('import.apply',{events:[{title:'無來源資料'}]},null,admin),{code:'SOURCE_REQUIRED'});
});

test('manual design delivery reconciles earlier failures and cannot be overwritten by job retry',async t => {
  const f = await fixture(t,{createCanvaDesign:async () => {const e=Error('rejected'); e.code='PROVIDER_REJECTED'; e.definite=true; throw e;}});
  let {post} = await approvedPost(f); await f.service.runJobs({limit:1});
  let state = await f.service.bootstrap(owner); assert.equal(state.jobs[0].status,'failed');
  post = (await f.command('post.attach-design',{canvaEditUrl:'https://www.canva.com/design/manual-example/edit'},post,designer)).record;
  state = await f.service.bootstrap(owner); assert.equal(state.jobs[0].status,'succeeded'); assert.equal(state.jobs[0].result.manual,true);
  await assert.rejects(f.command('job.retry',{},state.jobs[0],admin),{code:'RETRY_NOT_ALLOWED'});
  assert.equal(post.canvaEditUrl,'https://www.canva.com/design/manual-example/edit');
});

test('a definitively failed provider job can be retried as a fresh request without polling its failed ID forever',async t => {
  let creates=0;
  const f = await fixture(t,{createCanvaDesign:async () => ({status:'in_progress',providerJobId:`canva-job-${++creates}`}),getCanvaJob:async () => ({status:'failed'})});
  await approvedPost(f); await f.service.runJobs({limit:1}); await f.service.runJobs({limit:1});
  let state = await f.service.bootstrap(owner); assert.equal(state.jobs[0].errorCode,'PROVIDER_JOB_FAILED');
  await f.command('job.retry',{},state.jobs[0],admin); await f.service.runJobs({limit:1});
  state = await f.service.bootstrap(owner); assert.equal(creates,2); assert.equal(state.jobs[0].providerJobId,'canva-job-2');
});

test('retrying an earlier failed copy job can never reopen a published post',async t => {
  const f = await fixture(t,{generateCopy:async () => {const e=Error('unavailable');e.code='PROVIDER_UNAVAILABLE';e.definite=true;throw e;}});
  let {post} = await readyPost(f);
  post = (await f.command('post.reject',{reason:'再檢查一次'},post)).record;
  await f.command('post.generate',{},post);
  post = (await f.command('post.submit',{},post)).record;
  post = (await f.command('post.unit-review',{},post)).record;
  post = (await f.command('post.approve',{},post,approver)).record;
  post = (await f.command('post.attach-design',{canvaEditUrl:'https://www.canva.com/design/preserved-example/edit'},post,designer)).record;
  post = (await f.command('post.design-review',{},post,designer)).record;
  post = (await f.command('post.publish',{publishedUrl:'https://example.org/preserved-publication',publishedAt:new Date().toISOString()},post,designer)).record;
  const copyJob = (await f.service.bootstrap(owner)).jobs.find(job => job.type === 'copy');
  assert.equal(copyJob.status,'failed'); assert.equal(copyJob.copyVersion,post.copyVersion);
  await assert.rejects(f.command('job.retry',{},copyJob,admin),{code:'INVALID_STAGE'});
  const preserved = (await f.service.bootstrap(owner)).posts[0];
  assert.equal(preserved.stage,'published'); assert.equal(preserved.caption,post.caption); assert.equal(preserved.publishedUrl,post.publishedUrl);
});

test('server derives project scope from the event so omitted or cleared project IDs cannot bypass sponsor review',async t => {
  const f = await fixture(t);
  const project = (await f.command('project.create',{title:'含贊助要求的示範專案'})).record;
  let event = (await f.command('event.create',{title:'示範課程',projectId:project.id,date:'2026-11-01',speaker:'講者',venue:'教室'})).record;
  event = (await f.command('event.confirm',{},event)).record;
  await f.command('obligation.create',{title:'專案共同贊助義務',projectId:project.id,requiresSponsorReview:true,requirements:'須由贊助方確認'});
  let post = (await f.command('post.create',{title:'未提供專案ID的貼文',eventId:event.id,caption:'示範內容',slides:[{heading:'標題',body:'內容'}]})).record;
  assert.equal(post.projectId,project.id);
  post = (await f.command('post.update',{projectId:''},post)).record; assert.equal(post.projectId,project.id);
  post = (await f.command('post.submit',{},post)).record; post = (await f.command('post.unit-review',{},post)).record;
  post = (await f.command('post.approve',{},post,approver)).record;
  post = (await f.command('post.attach-design',{canvaEditUrl:'https://www.canva.com/design/project-scope/edit'},post,designer)).record;
  post = (await f.command('post.design-review',{},post,designer)).record; assert.equal(post.stage,'sponsor_review');
});

test('owning a separate project does not authorize attaching obligations to another person’s unassigned event',async t => {
  const f = await fixture(t);
  const ownProject = (await f.command('project.create',{title:'自己的專案'})).record;
  const victim = (await f.command('event.create',{title:'其他人的活動'},null,outsider)).record;
  await assert.rejects(f.command('obligation.create',{title:'不允許跨範圍附加',projectId:ownProject.id,eventId:victim.id,requirements:'應拒絕'}),{code:'REFERENCE_MISMATCH'});
  await assert.rejects(f.command('obligation.create',{title:'不允許附加',eventId:victim.id,requirements:'應拒絕'}),{code:'OWNER_REQUIRED'});
});
