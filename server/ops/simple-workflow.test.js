'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID,createHash} = require('node:crypto');
const {mkdtemp,rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {createClient} = require('@libsql/client');
const {KINDS} = require('./store');
const {executeAction,eventMissingFacts} = require('./domain');
const {createOpsService} = require('./service');
const {generateCopy} = require('./providers');

const admin = {uid:'admin',email:'admin@example.invalid',role:'advisor',canApprove:true};
const member = {uid:'member',email:'member@example.invalid',role:'officer',canApprove:false,canDesign:false};
const other = {uid:'other',email:'other@example.invalid',role:'officer',canApprove:false,canDesign:false};
function fixture(initial = {}) {
  let state = {...Object.fromEntries([...KINDS,'audit'].map(kind => [kind,[]])),...structuredClone(initial)}, tick = 0;
  const call = (action,payload = {},record,actor = member) => {
    const draft = structuredClone(state);
    const result = executeAction(draft,{action,payload,id:record?.id,expectedVersion:record?.version},actor,new Date(Date.UTC(2030,0,1,0,0,tick++)).toISOString());
    state = draft; return structuredClone(result.record);
  };
  return {call,read:() => structuredClone(state)};
}
function postFixture(eventFields = {}) {
  const f = fixture();
  const event = f.call('event.create',{title:'一般活動',eventType:'activity',...eventFields});
  const post = f.call('post.create',{title:'活動宣傳',eventId:event.id,caption:'活動細節待確認，請留意後續更新。'});
  return {...f,event,post};
}

test('any active officer can finish an unassigned task without reviewers, criteria, links or reasons', () => {
  const f = fixture();
  let task = f.call('task.create',{title:'帶延長線',notes:'放在社辦即可'});
  assert.equal(task.status,'todo'); assert.equal(task.ownerEmail,'');
  task = f.call('task.set-status',{status:'doing'},task,other);
  task = f.call('task.set-status',{status:'done'},task,other);
  assert.equal(task.completedBy,other.email); assert.equal(task.completionMode,'member_recorded');
  assert.equal(task.reviewerPersonId,undefined); assert.equal(task.acceptedReviewerPersonId,undefined);
  assert.equal(task.deliverableUrl,undefined); assert.equal(task.notes,'放在社辦即可');
  task = f.call('task.set-status',{status:'todo'},task,member);
  assert.equal(task.completedAt,undefined);
  assert.ok(task.deliveryHistory.some(item => item.status === 'done' && item.completedBy === other.email));
  assert.ok(f.read().audit.some(item => item.action === 'task.set-status' && item.actorEmail === other.email));
  assert.throws(() => f.call('task.set-status',{status:'delivered'},task),{code:'INVALID_STATUS'});
  assert.throws(() => f.call('task.set-status',{status:'done',acceptedBy:admin.email},task),{code:'UNSUPPORTED_FIELD'});
});

test('task create and update allow direct completion while optional metadata stays validated', () => {
  const f = fixture();
  let task = f.call('task.create',{title:'已買文具',status:'done'});
  assert.equal(task.completedBy,member.email);
  task = f.call('task.update',{title:'文具已放社辦',notes:'便條紙三本',dueDate:'2030-01-10'},task,other);
  assert.equal(task.status,'done'); assert.equal(task.completedBy,member.email);
  task = f.call('task.update',{status:'doing'},task,other);
  assert.equal(task.status,'doing'); assert.equal(task.completedAt,undefined);
  assert.throws(() => f.call('task.update',{deliverableUrl:'javascript:alert(1)'},task),{code:'INVALID_URL'});
  assert.throws(() => f.call('task.update',{dueDate:'2030-02-30'},task),{code:'INVALID_DATE'});
});

test('task dependencies remain valid references without blocking ordinary progress or project completion', () => {
  const f = fixture();
  const project = f.call('project.create',{title:'聯合活動'});
  const parent = f.call('task.create',{title:'現場安排',projectId:project.id});
  let child = f.call('task.create',{title:'搬桌子',parentId:parent.id});
  assert.equal(f.call('task.set-status',{status:'done'},parent,other).status,'done');
  assert.equal(f.call('project.update',{status:'completed'},project).status,'completed');
  child = f.call('task.update',{status:'doing'},child,other);
  assert.equal(child.status,'doing');
  assert.throws(() => f.call('task.update',{dependsOn:[child.id]},child),{code:'DEPENDENCY_CYCLE'});
  assert.throws(() => f.call('task.update',{dependsOn:['missing-task']},child),{code:'DEPENDENCY_MISSING'});
});

test('legacy delivery actions map to ordinary progress and preserve original review evidence', () => {
  const old = {id:'old-task',version:1,title:'歷史任務',status:'done',ownerEmail:'',reviewerPersonId:'former-person',acceptedAt:'2029-11-01',acceptedBy:'former@example.invalid',reviewIdentityMode:'individual_account',reviewEvidenceUrl:'https://example.org/old-proof',deliverableUrl:'https://example.org/original',deliveryHistory:[{id:'old-history',action:'task.accept-delivery',status:'done',reviewEvidenceUrl:'https://example.org/old-proof'}]};
  const f = fixture({tasks:[old]});
  let task = f.call('task.reopen',{},old,other);
  assert.equal(task.status,'todo'); assert.equal(task.acceptedBy,undefined);
  assert.deepEqual(task.deliveryHistory[0],old.deliveryHistory[0]);
  assert.ok(task.deliveryHistory.some(item => item.acceptedBy === old.acceptedBy && item.reviewEvidenceUrl === old.reviewEvidenceUrl));
  task = f.call('task.deliver',{},task,member);
  assert.equal(task.status,'done'); assert.equal(task.completedBy,member.email); assert.equal(task.acceptedReviewerPersonId,undefined);
  task = f.call('task.return-delivery',{},task,other);
  assert.equal(task.status,'todo');
  assert.equal(f.call('task.accept-delivery',{},task,other).status,'done');
});

test('retired officers cannot use any new simple status or confirmation action', () => {
  const people = [{personId:'ITRC-P0001',name:'離任示範',email:other.email,status:'retired'}];
  const f = fixture({people});
  const task = f.call('task.create',{title:'一般任務'});
  const event = f.call('event.create',{title:'一般活動'});
  const post = f.call('post.create',{title:'一般宣傳',eventId:event.id,caption:'有內容'});
  for (const [action,payload,record] of [['task.set-status',{status:'done'},task],['event.set-status',{status:'done'},event],['post.confirm',{},post],['post.complete',{},post]]) {
    assert.throws(() => f.call(action,payload,record,other),{code:'PERSON_ACCESS_REVOKED'});
  }
  assert.throws(() => f.call('task.update',{ownerPersonId:'ITRC-P0001'},task),{code:'PERSON_INACTIVE'});
});

test('event type defaults preserve old lectures and only explicit general activities omit the speaker hint', () => {
  const f = fixture();
  const lecture = f.call('event.create',{title:'社課'});
  const activity = f.call('event.create',{title:'參訪',eventType:'activity'});
  assert.equal(lecture.eventType,'lecture');
  assert.deepEqual(eventMissingFacts(lecture),['日期','地點','講者']);
  assert.deepEqual(eventMissingFacts(activity),['日期','地點']);
  assert.deepEqual(eventMissingFacts({title:'沒有類型的舊活動'}),['日期','地點','講者']);
  for (const value of ['seminar','',null,123]) assert.throws(() => f.call('event.update',{eventType:value},activity));
});

test('an incomplete event can be reviewed without fabricating facts or preventing promotional confirmation', () => {
  const f = postFixture();
  const event = f.call('event.confirm',{},f.event);
  assert.equal(event.confirmationStatus,'reviewed'); assert.equal(event.date,undefined); assert.equal(event.venue,undefined); assert.equal(event.speaker,undefined);
  assert.ok(event.reviewedAt); assert.deepEqual(eventMissingFacts(event),['日期','地點']);
  const current = f.read().posts[0];
  const post = f.call('post.confirm',{},current,other);
  assert.equal(post.approvedVersion,post.copyVersion); assert.equal(post.approvedBy,other.email);
  assert.equal(post.stage,'approved'); assert.deepEqual(post.slides,[]); assert.equal(f.read().jobs.length,0);
  assert.equal(f.call('post.complete',{},post,other).stage,'completed');
});

test('activity progress is separate from facts and never inferred from a past date', () => {
  const f = fixture();
  let event = f.call('event.create',{title:'歷史日期待核對',date:'2020-01-01',eventType:'activity'});
  assert.equal(event.status,'todo'); assert.equal(event.confirmationStatus,'draft');
  const original = structuredClone(event);
  event = f.call('event.set-status',{status:'done'},event,other);
  assert.equal(event.completedBy,other.email); assert.equal(event.confirmationStatus,'draft');
  assert.equal(event.venue,undefined); assert.deepEqual(eventMissingFacts(event),['地點']);
  assert.throws(() => f.call('event.set-status',{status:'todo'},original),{code:'VERSION_CONFLICT'});
  event = f.call('event.set-status',{status:'todo'},event);
  assert.equal(event.completedAt,undefined); assert.equal(event.progressHistory[1].completedBy,other.email);
});

test('one confirmation allows manual completion or publication without design reviews or evidence URLs', () => {
  const f = postFixture();
  assert.throws(() => f.call('post.complete',{},f.post),{code:'APPROVAL_REQUIRED'});
  let post = f.call('post.confirm',{},f.post,other);
  post = f.call('post.complete',{canvaEditUrl:'https://www.canva.com/design/EXAMPLE/edit'},post,member);
  assert.equal(post.stage,'completed'); assert.equal(post.completedBy,member.email); assert.equal(post.publishedUrl,undefined);
  post = f.call('post.unconfirm',{},post,other);
  assert.equal(post.stage,'draft'); assert.equal(post.completedAt,undefined);
  post = f.call('post.confirm',{},post,member);
  post = f.call('post.publish',{},post,other);
  assert.equal(post.stage,'published'); assert.equal(post.publishedUrl,''); assert.ok(post.publishedAt);
  assert.equal(f.read().jobs.length,0);
  assert.throws(() => f.call('post.update',{caption:'不可覆寫公開歷史'},post),{code:'PUBLISHED_IMMUTABLE'});
});

test('copy edits, event type changes and withdrawing confirmation obsolete earlier design work', () => {
  const f = postFixture({eventType:'lecture'});
  let post = f.call('post.confirm',{},f.post);
  const job = f.call('post.request-design',{},post,other);
  assert.equal(job.status,'queued');
  const event = f.call('event.update',{eventType:'activity'},f.event);
  post = f.read().posts[0];
  assert.equal(post.approvedVersion,undefined); assert.equal(post.stage,'draft');
  assert.equal(f.read().jobs[0].status,'obsolete');
  assert.equal(post.history.find(item => item.action === 'post.confirm').sourceEventSnapshot.eventType,'lecture');
  assert.equal(post.history.at(-1).sourceEventSnapshot.eventType,'activity');
  post = f.call('post.confirm',{},post);
  const fresh = f.call('post.request-design',{},post);
  post = f.call('post.unconfirm',{},f.read().posts[0]);
  assert.ok(post.copyVersion > fresh.copyVersion); assert.equal(f.read().jobs.find(item => item.id === fresh.id).status,'obsolete');
  assert.throws(() => f.call('post.request-design',{},post),{code:'APPROVAL_REQUIRED'});
  assert.equal(event.speaker,undefined);
});

test('imports keep fixed keys, remain drafts, accept explicit types and never reclassify existing records', () => {
  const f = fixture();
  const payload = {events:[{title:'參訪',eventType:'一般活動',sourceLabel:'semester.csv',sourceKey:'event-1'}],tasks:[{title:'帶相機',notes:'使用社團設備',sourceLabel:'semester.csv',sourceKey:'task-1'}]};
  const preview = f.call('import.preview',payload,null,admin);
  assert.equal(preview.events[0].eventType,'activity'); assert.equal(preview.events[0].confirmationStatus,'draft');
  assert.equal(preview.tasks[0].status,'todo'); assert.equal(preview.tasks[0].ownerEmail,'');
  assert.equal(f.read().events.length,0);
  f.call('import.apply',payload,null,admin);
  const before = f.read();
  f.call('import.apply',{...payload,events:[{...payload.events[0],eventType:'lecture'}]},null,admin);
  assert.deepEqual(f.read().events,before.events); assert.deepEqual(f.read().tasks,before.tasks);
});

test('legacy board imports retain todo, doing and done and repeated keys never reopen completed cards', () => {
  const f = fixture();
  const statuses = ['todo','doing','done','unassigned','accepted','blocked','delivered'];
  const tasks = statuses.map((status,index) => ({title:`來源卡 ${index}`,status,sourceKey:`firebase:boards/itrc:card:example-${index}`,sourceUrl:'https://example.org/legacy-board',sourceRevision:'snapshot-1'}));
  const preview = f.call('import.preview',{tasks},null,admin);
  assert.deepEqual(preview.tasks.map(task => task.status),['todo','doing','done','todo','todo','doing','doing']);
  assert.equal(preview.tasks[2].completionMode,'imported_status');
  assert.equal(preview.tasks[2].completedAt,undefined); assert.equal(preview.tasks[2].completedBy,undefined);
  f.call('import.apply',{tasks},null,admin);
  const before = f.read().tasks;
  const repeat = f.call('import.apply',{tasks:tasks.map(task => ({...task,status:'todo'}))},null,admin);
  assert.equal(repeat.importedTasks,0); assert.equal(repeat.duplicates.length,7);
  assert.deepEqual(f.read().tasks,before); assert.equal(f.read().tasks[2].status,'done');
  assert.throws(() => f.call('import.apply',{tasks:[{...tasks[0],sourceKey:'bad-status',status:'maybe'}]},null,admin),{code:'INVALID_STATUS'});
  assert.equal(f.read().tasks.length,7);
});

test('ordinary event and copy edits are collaborative without granting source approval authority', () => {
  const f = postFixture();
  let event = f.call('event.update',{venue:'新教室'},f.event,other);
  event = f.call('event.confirm',{},event,other);
  const created = f.call('post.create',{title:'其他幹部的新宣傳',eventId:event.id,caption:'先留草稿'},null,other);
  let post = f.call('post.update',{caption:'團隊補充內容'},created,member);
  const original = post.history.find(item => item.action === 'post.create');
  post = f.call('post.restore-version',{historyId:original.id},post,member);
  assert.equal(post.caption,'先留草稿');
  assert.equal(f.call('post.generate',{},post,member).status,'queued');
  assert.throws(() => f.call('source-change.propose',{targetKind:'posts',targetId:post.id,targetVersion:post.version,sourceKey:'post-source',sourceUrl:'https://example.org/master',baseSourceRevision:'v1',reason:'更新來源'},null,member),{code:'OWNER_REQUIRED'});
});

test('unchanged retired assignees remain historical while new assignment to a retired person is rejected', () => {
  const legacy = {id:'old-event',version:1,title:'離任前的活動',ownerPersonId:'ITRC-P0001',ownerEmail:'',confirmationStatus:'draft'};
  const f = fixture({people:[{personId:'ITRC-P0001',name:'歷史承辦人',email:'former@example.invalid',status:'retired'}],events:[legacy]});
  const updated = f.call('event.update',{venue:'已核對的新地點'},legacy,other);
  assert.equal(updated.ownerPersonId,'ITRC-P0001'); assert.equal(updated.venue,'已核對的新地點');
  assert.throws(() => f.call('event.create',{title:'不能新派給離任者',ownerPersonId:'ITRC-P0001'}),{code:'PERSON_INACTIVE'});
  assert.throws(() => f.call('event.set-status',{status:'done'},updated,{uid:'former',email:'former@example.invalid',role:'officer'}),{code:'PERSON_ACCESS_REVOKED'});
});

test('source packages include explicit types and progress while stale approvals still cannot write back', () => {
  const f = fixture();
  let event = f.call('event.create',{title:'活動來源',eventType:'activity',sourceUrl:'https://example.org/master',sourceRevision:'source-1'});
  const change = f.call('source-change.propose',{targetKind:'events',targetId:event.id,targetVersion:event.version,sourceKey:'activity-1',baseSourceRevision:'source-1',reason:'核對活動類型。'});
  assert.equal(change.values.eventType,'activity'); assert.equal(change.values.status,'todo');
  const approved = f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:'source-1'},change,admin);
  event = f.call('event.set-status',{status:'done'},event,other);
  assert.throws(() => f.call('source-change.export',{},approved,admin),{code:'SOURCE_WORKFLOW_CHANGED'});
  assert.equal(event.sourceRevision,'source-1');
});

test('adding optional workflow fields leaves existing pending source snapshots valid without migrating old records', () => {
  const event = {id:'legacy-event',version:1,title:'尚無類型的舊活動',ownerEmail:member.email,confirmationStatus:'draft',sourceUrl:'https://example.org/legacy-master',sourceRevision:'v1'};
  const values = {title:event.title,confirmationStatus:'draft'};
  const change = {id:'legacy-proposal',version:1,targetKind:'events',targetId:event.id,targetVersion:1,title:event.title,sourceUrl:event.sourceUrl,sourceKey:'legacy-1',baseSourceRevision:'v1',reason:'既有待確認提案',status:'pending',values,snapshotHash:createHash('sha256').update(JSON.stringify(values)).digest('hex')};
  const f = fixture({events:[event],sourceChanges:[change]});
  const approved = f.call('source-change.approve',{confirmedSourceReview:true,observedSourceRevision:'v1'},change,admin);
  assert.equal(approved.status,'approved'); assert.deepEqual(f.read().events,[event]);
  assert.equal(f.read().events[0].eventType,undefined); assert.equal(f.read().events[0].status,undefined);
});

test('rules omit optional general-activity speakers but honestly mark missing lecture facts', async () => {
  const noNetwork = async () => { throw Error('Unexpected network'); };
  const activity = await generateCopy({event:{title:'交流活動',eventType:'activity'},post:{}},{env:{},fetchImpl:noNetwork});
  assert.doesNotMatch(activity.caption,/講者|帶領者/); assert.match(activity.caption,/時間｜【待確認】/); assert.match(activity.caption,/地點｜【待確認】/);
  const lecture = await generateCopy({event:{title:'舊版社課'},post:{}},{env:{},fetchImpl:noNetwork});
  assert.match(lecture.caption,/講者｜【待確認】/);
  const guided = await generateCopy({event:{title:'參訪',eventType:'activity',speaker:'已提供的帶領者'},post:{}},{env:{},fetchImpl:noNetwork});
  assert.match(guided.caption,/講者／帶領者｜已提供的帶領者/);
});

test('bootstrap missing-fact hints are read-only and retired identities cannot replay cached simple actions', async t => {
  const directory = await mkdtemp(join(tmpdir(),'itrc-simple-'));
  const db = createClient({url:`file:${join(directory,'test.db')}`});
  t.after(async () => { db.close(); await rm(directory,{recursive:true,force:true}); });
  const service = createOpsService({db,env:{},providers:{getIntegrationStatus:() => ({})}}); await service.ready;
  const command = (who,action,payload,record,key = randomUUID()) => service.action(who,{action,payload,id:record?.id,expectedVersion:record?.version,idempotencyKey:key});
  const event = (await command(member,'event.create',{title:'資料未齊',eventType:'activity'})).record;
  const loaded = await service.bootstrap(member);
  assert.deepEqual(loaded.events[0].missingFacts,['日期','地點']); assert.equal((await service.store.read()).events[0].missingFacts,undefined);
  const key = randomUUID(); await command(member,'event.set-status',{status:'done'},event,key);
  const people = [{personId:'ITRC-P0001',name:'離任示範',email:member.email,status:'retired'}];
  const preview = (await command(admin,'people.import-preview',{people})).record;
  await command(admin,'people.import-apply',{people,previewToken:preview.previewToken});
  await assert.rejects(command(member,'event.set-status',{status:'done'},event,key),{code:'PERSON_ACCESS_REVOKED'});
});
