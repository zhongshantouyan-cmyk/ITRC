'use strict';

const { LESSON_TEMPLATE_ID, lessonTasks } = require('./task-templates');
const { executeSourceAction } = require('./source-changes');
const { randomUUID, createHash } = require('node:crypto');
const { assert, fail } = require('./errors');
const { assertActorActive, person, personMatches, requirePerson, validatePersonReferences, normalizePeopleImport } = require('./people');

const FIELDS = {
  projects: ['title','objective','ownerEmail','ownerPersonId','adviserEmail','adviserPersonId','status','dueDate','completionCriteria'],
  events: ['projectId','title','speaker','date','time','venue','audience','fee','registrationUrl','highlights','ownerEmail','ownerPersonId','sourceUrl','sourceLabel','sourceDate','sourceRevision','sourceKey'],
  obligations: ['projectId','eventId','title','requirements','channel','requiresSponsorReview','sourceUrl','status','ownerEmail','ownerPersonId','evidenceUrl'],
  posts: ['projectId','eventId','title','purpose','audience','highlights','cta','channel','scheduledAt','ownerEmail','ownerPersonId','caption','slides','sourceUrl','sourceLabel','sourceDate','sourceRevision','sourceKey'],
  tasks: ['projectId','eventId','postId','title','ownerEmail','ownerPersonId','reviewerPersonId','requiredForCompletion','parentId','dependsOn','dueDate','status','blocker','deliverableUrl','acceptanceCriteria','sourceUrl','sourceLabel','sourceDate','sourceRevision','sourceKey'],
};
const TASK_STATUS = new Set(['unassigned','accepted','todo','doing','blocked','delivered','done','cancelled']);
const COPY_FIELDS = new Set(['projectId','eventId','title','purpose','audience','highlights','cta','channel','caption','slides']);
const ACTIVE_JOB_STATES = new Set(['queued','running','blocked_configuration','needs_reconciliation']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAdvisor(actor) { return ['advisor','chair'].includes(actor.role); }
function find(state, kind, id) {
  const record = state[kind].find(row => row.id === id);
  assert(record,404,'RECORD_NOT_FOUND','找不到這筆資料，請重新整理。');
  return record;
}
function projectOf(state, record) { return state.projects.find(project => project.id === record.projectId); }
function matchesRecordRole(state, actor, record, role) {
  if (!record) return false;
  return record[`${role}PersonId`] ? personMatches(state,record[`${role}PersonId`],actor) : record[`${role}Email`] === actor.email;
}
function canManage(state, actor, record) {
  const project = projectOf(state, record);
  const parent = state.tasks.find(task => task.id === record.parentId);
  const unassignedCreator = !record.ownerPersonId && !record.ownerEmail && record.createdByEmail === actor.email;
  return isAdvisor(actor) || unassignedCreator || matchesRecordRole(state,actor,record,'owner') || matchesRecordRole(state,actor,record,'adviser') || matchesRecordRole(state,actor,project,'owner') || matchesRecordRole(state,actor,project,'adviser') || matchesRecordRole(state,actor,parent,'owner');
}
function requireManage(state, actor, record) { assert(canManage(state,actor,record),403,'OWNER_REQUIRED','這項操作需要負責人或顧問執行。'); }
function versionCheck(record, expectedVersion) {
  assert(Number.isInteger(expectedVersion) && expectedVersion === record.version,409,'VERSION_CONFLICT','資料已更新，請重新整理後查看最新版本再操作。');
}
function newRecord(fields, now) { return { ...fields, id:randomUUID(), version:1, createdAt:now, updatedAt:now }; }
function touch(record, now) { record.version += 1; record.updatedAt = now; return record; }
function audit(state, actor, action, record, fromVersion, now, summary) {
  state.audit.unshift(newRecord({ action, actorEmail:actor.email, entityId:record?.id || '', fromVersion:fromVersion || 0, toVersion:record?.version || 0, summary },now));
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === value;
}
function httpsUrl(value, name, {canva = false, optional = true} = {}) {
  if (!value && optional) return '';
  let url;
  try { url = new URL(value); } catch { fail(400,'INVALID_URL',`${name}需要完整的 https 網址。`); }
  assert(url.protocol === 'https:' && !url.username && !url.password,400,'INVALID_URL',`${name}需要完整的 https 網址。`);
  if (canva) assert((url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com')) && url.pathname !== '/',400,'INVALID_CANVA_URL','請填入 Canva 設計編輯網址。');
  return value;
}
function cleanFields(kind, payload, { importing = false } = {}) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload),400,'INVALID_PAYLOAD','資料格式不正確。');
  const cleaned = {};
  for (const [key,value] of Object.entries(payload)) {
    assert(FIELDS[kind].includes(key),400,'UNSUPPORTED_FIELD',`不允許直接修改欄位：${key}`);
    if (key === 'slides') {
      assert(Array.isArray(value) && value.length <= 10,400,'INVALID_SLIDES','輪播最多 10 頁。');
      cleaned.slides = value.map(slide => {
        assert(slide && typeof slide.heading === 'string' && typeof slide.body === 'string' && slide.heading.length <= 200 && slide.body.length <= 2000,400,'INVALID_SLIDES','輪播每頁需要標題與內文。');
        return {heading:slide.heading.trim(),body:slide.body.trim()};
      });
    } else if (key === 'dependsOn') {
      assert(Array.isArray(value) && value.length <= 50 && value.every(item => typeof item === 'string'),400,'INVALID_DEPENDENCIES','前置任務格式不正確。');
      cleaned[key] = [...new Set(value)];
    } else if (['requiresSponsorReview','requiredForCompletion'].includes(key)) {
      assert(typeof value === 'boolean',400,'INVALID_BOOLEAN',`${key}欄位需要是布林值。`); cleaned[key] = value;
    } else {
      assert(typeof value === 'string' || (key === 'fee' && typeof value === 'number'),400,'INVALID_FIELD',`${key}需填入文字。`);
      const text = String(value).trim();
      assert(text.length <= (['caption','requirements','highlights','acceptanceCriteria','objective','completionCriteria'].includes(key) ? 12000 : 2000),400,'FIELD_TOO_LONG',`${key}內容太長。`);
      cleaned[key] = key.endsWith('Email') ? text.toLowerCase() : text;
      if (key.endsWith('Email') && text) assert(EMAIL.test(text),400,'INVALID_EMAIL','請填入有效的負責人信箱。');
      if (key.endsWith('Url') && text) httpsUrl(text,key);
      if (['date','dueDate','sourceDate'].includes(key) && text) assert(validDate(text),400,'INVALID_DATE','日期請使用 YYYY-MM-DD。');
      if (key === 'scheduledAt' && text) assert(!Number.isNaN(Date.parse(text)),400,'INVALID_DATE','發布時間格式不正確。');
    }
  }
  if (cleaned.title !== undefined) assert(cleaned.title.length > 0,400,'TITLE_REQUIRED','請填入標題。');
  if (cleaned.channel) assert(['instagram','story','announcement','all'].includes(cleaned.channel) && (kind !== 'posts' || cleaned.channel !== 'all'),400,'INVALID_CHANNEL','宣傳渠道格式不正確。');
  if (kind === 'tasks' && cleaned.status) assert(TASK_STATUS.has(cleaned.status),400,'INVALID_STATUS','任務狀態不正確。');
  if (kind === 'projects' && cleaned.status) assert(['planning','active','on_hold','completed','cancelled'].includes(cleaned.status),400,'INVALID_STATUS','專案狀態不正確。');
  if (kind === 'obligations' && cleaned.status) assert(['pending','active','completed','cancelled'].includes(cleaned.status),400,'INVALID_STATUS','義務狀態不正確。');
  if (!importing) assert(!('sourceKey' in cleaned),400,'SOURCE_KEY_RESERVED','來源識別由匯入流程管理。');
  return cleaned;
}
function references(state, kind, record) {
  validatePersonReferences(state,record);
  if (record.postId) {
    const post = find(state,'posts',record.postId);
    assert(!record.eventId || post.eventId === record.eventId,400,'REFERENCE_MISMATCH','任務連結的活動與宣傳不一致。');
    record.eventId ||= post.eventId;
  }
  if (kind === 'tasks' && record.parentId) {
    const parent = find(state,'tasks',record.parentId);
    assert(!record.projectId || record.projectId === (parent.projectId || ''),400,'REFERENCE_MISMATCH','子任務與上層任務的專案不一致。');
    record.projectId = parent.projectId || '';
    if (parent.eventId) {
      assert(!record.eventId || record.eventId === parent.eventId,400,'REFERENCE_MISMATCH','子任務與上層任務的活動不一致。');
      record.eventId = parent.eventId;
    }
  }
  if (record.eventId) {
    const event = find(state,'events',record.eventId);
    assert(!record.projectId || record.projectId === (event.projectId || ''),400,'REFERENCE_MISMATCH','活動與專案不一致。');
    record.projectId = event.projectId || '';
  }
  if (record.projectId) find(state,'projects',record.projectId);
  if (kind === 'posts') assert(record.eventId,400,'EVENT_REQUIRED','宣傳貼文必須連結活動。');
}
function validateTaskGraph(state, candidate) {
  const tasks = state.tasks.map(task => task.id === candidate.id ? candidate : task);
  if (!tasks.some(task => task.id === candidate.id)) tasks.push(candidate);
  const map = new Map(tasks.map(task => [task.id,task]));
  for (const id of [candidate.parentId,...(candidate.dependsOn || [])].filter(Boolean)) assert(map.has(id),400,'DEPENDENCY_MISSING','前置任務或上層任務不存在。');
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    assert(!visiting.has(id),400,'DEPENDENCY_CYCLE','任務的前置關係或拆分關係不能形成循環。');
    if (visited.has(id)) return;
    visiting.add(id);
    const task = map.get(id);
    for (const dependency of [task.parentId,...(task.dependsOn || [])].filter(Boolean)) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of map.keys()) visit(id);
  if (['doing','delivered','done'].includes(candidate.status)) {
    assert((candidate.dependsOn || []).every(id => map.get(id)?.status === 'done'),409,'DEPENDENCY_BLOCKED','前置任務尚未完成，請先處理依賴項目。');
    assert(candidate.ownerPersonId || candidate.ownerEmail,409,'TASK_UNASSIGNED','請先指派實際承辦人，再開始或交付任務。');
  }
  if (candidate.status === 'blocked') assert(candidate.blocker,400,'BLOCKER_REQUIRED','請說明卡關原因。');
  if (['delivered','done'].includes(candidate.status)) {
    assert(candidate.deliverableUrl,400,'DELIVERABLE_REQUIRED','交付或完成任務前，請附上成果網址。');
    httpsUrl(candidate.deliverableUrl,'成果網址',{optional:false});
  }
}
function canAssign(state, actor, record) {
  const project = projectOf(state,record);
  return isAdvisor(actor) || Boolean(project && canManage(state,actor,project));
}
function assertOpenProject(state, task) {
  const project = projectOf(state,task);
  assert(!project || !['completed','cancelled'].includes(project.status),409,'PROJECT_CLOSED','請先重新開啟專案，再新增或修改任務。');
  const parent = state.tasks.find(row => row.id === task.parentId);
  assert(!parent || !['done','cancelled'].includes(parent.status),409,'PARENT_TASK_CLOSED','請先重新開啟上層任務，再新增或修改子任務。');
}
function requireCompletedChildren(state, task) {
  assert(state.tasks.filter(item => item.parentId === task.id && item.requiredForCompletion !== false).every(item => item.status === 'done'),409,'CHILD_TASKS_INCOMPLETE','必要子任務尚未驗收完成。取消必要子任務前，請由管理者確認是否移出結案要求。');
}
function requireProjectCompletion(state, project) {
  assert(project.completionCriteria?.trim(),400,'PROJECT_CRITERIA_REQUIRED','結案前請填寫專案完成標準。');
  const tasks = state.tasks.filter(task => task.projectId === project.id && task.requiredForCompletion !== false);
  assert(tasks.every(task => task.status === 'done'),409,'PROJECT_TASKS_INCOMPLETE','必要任務尚未驗收完成，專案不能結案。');
}
function clearTaskReview(task) {
  for (const key of ['deliveredAt','deliveredBy','acceptedAt','acceptedBy','acceptedReviewerPersonId','reviewIdentityMode','reviewEvidenceUrl','reviewComment']) delete task[key];
}
function captureTaskDelivery(task, actor, now, action, extra = {}) {
  task.deliveryHistory ||= [];
  task.deliveryHistory.push({id:randomUUID(),action,actorEmail:actor.email,createdAt:now,taskVersion:task.version,status:task.status,ownerPersonId:task.ownerPersonId || '',reviewerPersonId:task.reviewerPersonId || '',deliverableUrl:task.deliverableUrl || '',acceptanceCriteria:task.acceptanceCriteria || '',links:structuredClone(task.links || []),...extra});
}
function taskReviewAuthority(state, task, actor, payload, {accepting = false} = {}) {
  assert(task.reviewerPersonId,400,'TASK_REVIEWER_REQUIRED','請先指定驗收人。');
  const reviewer = requirePerson(state,task.reviewerPersonId,'驗收人');
  const owner = task.ownerPersonId ? requirePerson(state,task.ownerPersonId,'承辦人') : null;
  assert(task.ownerPersonId !== task.reviewerPersonId && (!reviewer.email || reviewer.email !== (owner?.email || task.ownerEmail)),409,'INDEPENDENT_REVIEW_REQUIRED','承辦人與驗收人需要是不同人。');
  if (personMatches(state,task.reviewerPersonId,actor) && (!accepting || actor.email !== task.deliveredBy)) return {reviewIdentityMode:'individual_account',reviewEvidenceUrl:''};
  assert(isAdvisor(actor),403,'TASK_REVIEWER_REQUIRED','請由指定驗收人登入，或由社長／顧問登錄外部驗收結果。');
  if (accepting) {
    assert(payload.confirmedExternalReview === true,400,'EXTERNAL_REVIEW_CONFIRMATION_REQUIRED','共用帳號代登錄時，請確認指定驗收人已在外部完成驗收。');
    httpsUrl(payload.evidenceUrl,'外部驗收證據',{optional:false});
  }
  return {reviewIdentityMode:'recorded_external_review',reviewEvidenceUrl:accepting ? payload.evidenceUrl : ''};
}
const HISTORY_FIELDS = ['title','purpose','audience','highlights','cta','channel','caption','slides','projectId','eventId','sourceUrl','sourceLabel','sourceDate','sourceRevision','sourceEventVersion','stage','generationMethod','unitReviewedVersion','unitReviewedBy','approvedVersion','approvedBy','approvedAt','designCopyVersion','canvaDesignId','canvaEditUrl','designApprovedBy','designApprovedAt','sponsorApprovedVersion','sponsorApprovedBy','sponsorEvidenceUrl','publishedUrl','publishedAt','revisionReason'];
function capturePostRevision(state, post, actor, now, action) {
  const values = Object.fromEntries(HISTORY_FIELDS.filter(key => post[key] !== undefined).map(key => [key,structuredClone(post[key])]));
  const signature = createHash('sha256').update(JSON.stringify({copyVersion:post.copyVersion,postVersion:post.version,...values})).digest('hex');
  post.history ||= [];
  if (post.history.at(-1)?.signature === signature) return;
  const event = state.events.find(item => item.id === post.eventId);
  post.history.push({id:randomUUID(),copyVersion:post.copyVersion,postVersion:post.version,...values,sourceEventSnapshot:event ? structuredClone(event) : null,actorEmail:actor.email,action,createdAt:now,signature});
}
function relevantObligations(state, post) {
  const event = state.events.find(event => event.id === post.eventId);
  const projectId = event ? (event.projectId || '') : post.projectId;
  return state.obligations.filter(item => !['cancelled','waived'].includes(item.status) && (item.eventId ? item.eventId === post.eventId : item.projectId && item.projectId === projectId) && (!item.channel || item.channel === 'all' || item.channel === post.channel));
}
function requireFacts(state, post) {
  const event = find(state,'events',post.eventId);
  assert(event.confirmationStatus === 'confirmed',409,'EVENT_UNCONFIRMED','活動事實尚未確認，請先由活動負責人確認。');
  assert(validDate(event.date || '') && event.speaker && event.venue,409,'EVENT_INCOMPLETE','活動需確認日期、講者與地點後才能送審。');
  assert(post.sourceEventVersion === event.version,409,'SOURCE_CHANGED','活動資料已變更，請更新文案並重新送審。');
  return event;
}
function clearApproval(post) {
  for (const key of ['unitReviewedVersion','unitReviewedBy','approvedVersion','approvedBy','approvedAt','designCopyVersion','designApprovedBy','designApprovedAt','sponsorApprovedVersion','sponsorApprovedBy','sponsorEvidenceUrl','canvaDesignId','canvaEditUrl']) delete post[key];
}
function obsoleteJobs(state, post, now) {
  for (const job of state.jobs.filter(item => item.postId === post.id && ACTIVE_JOB_STATES.has(item.status))) {
    job.status = 'obsolete'; job.lastError = '內容或活動已修改，請依最新版本重新產生。'; touch(job,now);
  }
}
function invalidatePost(state, post, actor, now, reason, { incrementCopy = true, captureBefore = true, captureAfter = true } = {}) {
  if (post.stage === 'published') {
    const dedupe = `${post.id}:${reason}`;
    if (!state.tasks.some(task => task.correctionKey === dedupe && task.status !== 'done' && task.status !== 'cancelled')) {
      const task = newRecord({title:`檢查已發布內容：${post.title}`,projectId:post.projectId || '',eventId:post.eventId,postId:post.id,ownerEmail:post.ownerEmail || '',ownerPersonId:post.ownerPersonId || '',createdByEmail:actor.email,status:post.ownerPersonId || post.ownerEmail?'todo':'unassigned',dependsOn:[],requiredForCompletion:true,acceptanceCriteria:'核對公開內容；如需修正，另建新版宣傳並附修正證據。',blocker:reason,correctionKey:dedupe},now);
      state.tasks.push(task); audit(state,actor,'post.correction-required',task,0,now,reason);
    }
    return;
  }
  if (captureBefore) capturePostRevision(state,post,actor,now,'post.before-invalidation');
  const from = post.version;
  if (post.canvaEditUrl) post.previousDesigns = [...(post.previousDesigns || []),{copyVersion:post.designCopyVersion,canvaDesignId:post.canvaDesignId || '',canvaEditUrl:post.canvaEditUrl}];
  clearApproval(post);
  if (incrementCopy) post.copyVersion += 1;
  post.stage = 'needs_revision'; post.revisionReason = reason;
  const event = state.events.find(item => item.id === post.eventId);
  post.sourceEventVersion = event?.version || 0;
  touch(post,now); obsoleteJobs(state,post,now);
  if (captureAfter) capturePostRevision(state,post,actor,now,'post.invalidated');
  audit(state,actor,'post.invalidated',post,from,now,reason);
}
function enqueue(state, post, type, actor, now) {
  const existing = state.jobs.find(job => job.postId === post.id && job.copyVersion === post.copyVersion && job.type === type && job.status !== 'obsolete');
  if (existing) return existing;
  const job = newRecord({postId:post.id,copyVersion:post.copyVersion,type,status:'queued',attempts:0,lastError:'',requestedBy:actor.email,expectedPostVersion:post.version},now);
  state.jobs.push(job); return job;
}
function canReviewUnit(state,actor,post) {
  const event = state.events.find(item => item.id === post.eventId);
  return canManage(state,actor,post) || (event && canManage(state,actor,event));
}
function normalizeImport(state, payload, actor, now) {
  assert(payload && typeof payload === 'object',400,'INVALID_IMPORT','請提供活動與任務陣列。');
  const events = payload.events || [], posts = payload.posts || [], tasks = payload.tasks || [];
  const total = events.length + posts.length + tasks.length;
  assert(Array.isArray(events) && Array.isArray(posts) && Array.isArray(tasks) && total <= 200 && total > 0,400,'IMPORT_LIMIT','每次可匯入 1 到 200 筆活動、宣傳或任務。');
  const preview = {events:[],posts:[],tasks:[],duplicates:[],warnings:['匯入活動與宣傳一律未審核；來源表不會被改寫。同一來源鍵已存在時會略過，不覆寫既有版本。']};
  for (const [kind,rows] of [['events',events],['posts',posts],['tasks',tasks]]) {
    const seen = new Set(state[kind].map(item => item.sourceKey).filter(Boolean));
    for (const row of rows) {
      const {eventSourceKey,...input} = row || {};
      assert(!eventSourceKey || (kind === 'posts' && typeof eventSourceKey === 'string' && eventSourceKey.length <= 2000),400,'INVALID_EVENT_SOURCE','活動來源鍵格式不正確。');
      const fields = cleanFields(kind,input,{importing:true});
      assert(fields.title,400,'TITLE_REQUIRED','每筆匯入資料都需要標題。');
      assert(fields.sourceUrl || fields.sourceLabel,400,'SOURCE_REQUIRED','每筆匯入資料需保留來源網址或來源檔名。');
      const sourceKey = fields.sourceKey || createHash('sha256').update(`${kind}|${fields.sourceUrl || `file:${fields.sourceLabel}`}|${fields.title}|${fields.date || ''}|${eventSourceKey || fields.eventId || ''}|${fields.channel || ''}`).digest('hex');
      if (seen.has(sourceKey)) { preview.duplicates.push({kind,title:fields.title,sourceKey}); continue; }
      seen.add(sourceKey);
      const record = {...fields,sourceKey,createdByEmail:actor.email,ownerEmail:fields.ownerEmail ?? (kind === 'tasks' || fields.ownerPersonId !== undefined ? '' : actor.email)};
      if (kind === 'posts') {
        const linked = fields.eventId ? find(state,'events',fields.eventId) : [...state.events,...preview.events].find(event => event.sourceKey === eventSourceKey);
        assert(linked,400,'EVENT_REQUIRED','每筆宣傳需填活動 ID，或填入可對應的活動來源鍵。');
        if (eventSourceKey && fields.eventId) assert(linked.sourceKey === eventSourceKey,400,'REFERENCE_MISMATCH','活動 ID 與活動來源鍵對應到不同資料。');
        assert(!record.projectId || record.projectId === (linked.projectId || ''),400,'REFERENCE_MISMATCH','宣傳與活動的專案不一致。');
        record.projectId ||= linked.projectId || '';
        record.channel ||= 'instagram';
        if (eventSourceKey) record.eventSourceKey = eventSourceKey;
        if (linked.id) record.eventId = linked.id;
      } else references(state,kind,record);
      if (kind === 'events') record.confirmationStatus = 'draft';
      if (kind === 'tasks') { record.status = record.ownerPersonId || record.ownerEmail ? 'todo' : 'unassigned'; record.requiredForCompletion ??= true; record.dependsOn = fields.dependsOn || []; assertOpenProject(state,record); validateTaskGraph(state,{...record,id:`import-${sourceKey}`}); }
      preview[kind].push(record);
    }
  }
  return preview;
}

function executeAction(state, command, actor, now) {
  const {action,id,expectedVersion,payload = {}} = command;
  state.people ||= [];
  assertActorActive(state,actor);
  if (action.startsWith('source-change.')) return executeSourceAction(state,command,actor,now,{find,versionCheck,newRecord,touch,audit,isAdvisor,requireManage,httpsUrl});
  if (action === 'people.import-preview' || action === 'people.import-apply') {
    assert(isAdvisor(actor),403,'ADVISOR_REQUIRED','幹部對照更新需要社長或顧問確認。');
    const preview = normalizePeopleImport(state,payload);
    if (action === 'people.import-preview') return {ok:true,record:preview};
    assert(payload.previewToken === preview.previewToken,409,'PEOPLE_PREVIEW_STALE','名單或匯入內容已改變，請重新預覽差異後套用。');
    let created = 0, updated = 0;
    for (const [index,fields] of preview.people.entries()) {
      const change = preview.changes[index];
      if (change.change === 'unchanged') continue;
      const old = state.people.find(row => row.personId === fields.personId);
      if (old) {
        const from = old.version; Object.assign(old,fields,{syncedAt:now,syncedBy:actor.email}); touch(old,now);
        audit(state,actor,'people.import-update',old,from,now,`依固定 ID 更新 ${old.name}：${change.changedFields.join('、')}；未變更登入授權。`); updated++;
      } else {
        const record = {...newRecord({...fields,syncedAt:now,syncedBy:actor.email},now),id:fields.personId};
        state.people.push(record); audit(state,actor,'people.import-create',record,0,now,`新增 ${record.name} 的人員來源對照；未授予登入權限。`); created++;
      }
    }
    return {ok:true,record:{created,updated,unchanged:preview.people.length - created - updated,people:state.people}};
  }
  if (action === 'import.preview' || action === 'import.apply') {
    assert(isAdvisor(actor),403,'ADVISOR_REQUIRED','匯入資料需要社長或顧問執行。');
    const preview = normalizeImport(state,payload,actor,now);
    if (action === 'import.preview') return {ok:true,record:preview};
    for (const kind of ['events','posts','tasks']) for (const fields of preview[kind]) {
      const record = newRecord(fields,now);
      if (kind === 'posts') {
        const event = record.eventId ? find(state,'events',record.eventId) : state.events.find(event => event.sourceKey === record.eventSourceKey);
        assert(event,400,'EVENT_REQUIRED','找不到宣傳對應的活動來源。');
        record.eventId = event.id; delete record.eventSourceKey;
        record.copyVersion = 1; record.stage = record.caption ? 'draft' : 'brief';
        record.caption ||= ''; record.slides ||= []; record.sourceEventVersion = event.version;
      }
      state[kind].push(record); audit(state,actor,'import.create',record,0,now,`由來源匯入 ${record.title}`);
      if (kind === 'posts') capturePostRevision(state,record,actor,now,'import.create');
    }
    return {ok:true,record:{importedEvents:preview.events.length,importedPosts:preview.posts.length,importedTasks:preview.tasks.length,duplicates:preview.duplicates}};
  }
  if (action === 'job.retry') {
    const job = find(state,'jobs',id); versionCheck(job,expectedVersion);
    assert(isAdvisor(actor),403,'ADVISOR_REQUIRED','重試系統工作需要社長或顧問執行。');
    assert(['failed','blocked_configuration'].includes(job.status),409,'RETRY_NOT_ALLOWED','此工作不能直接重試；結果不明的設計須先核對 Canva，避免重複建立。');
    const post = find(state,'posts',job.postId);
    assert(post.copyVersion === job.copyVersion && (job.type !== 'canva' || post.approvedVersion === post.copyVersion),409,'OBSOLETE_JOB','這項工作已不是目前核准的版本。');
    assert(job.type === 'copy' ? ['brief','draft','needs_revision'].includes(post.stage) : ['approved','design_pending'].includes(post.stage),409,'INVALID_STAGE','內容已進入後續階段，不能重試並覆蓋目前成果。');
    const from = job.version; job.status = 'queued'; job.lastError = ''; job.expectedPostVersion = post.version; touch(job,now);
    if (job.errorCode === 'PROVIDER_JOB_FAILED') delete job.providerJobId;
    audit(state,actor,action,job,from,now,'重新排入工作佇列'); return {ok:true,record:job};
  }
  const [entity,operation] = String(action).split('.');
  const kind = {project:'projects',event:'events',obligation:'obligations',task:'tasks',post:'posts'}[entity];
  assert(kind,400,'UNKNOWN_ACTION','不支援這項操作。');
  if (operation === 'create') {
    const fields = cleanFields(kind,payload);
    assert(fields.title,400,'TITLE_REQUIRED','請填入標題。');
    const ownerEmail = fields.ownerEmail ?? (kind === 'tasks' || fields.ownerPersonId !== undefined ? '' : actor.email);
    if ((ownerEmail && ownerEmail !== actor.email) || (fields.ownerPersonId && !personMatches(state,fields.ownerPersonId,actor))) assert(canAssign(state,actor,fields),403,'ASSIGNMENT_REQUIRED','替他人指派工作需要專案負責人或顧問執行。');
    const record = newRecord({...fields,ownerEmail,createdByEmail:actor.email},now);
    references(state,kind,record);
    if (record.projectId) requireManage(state,actor,find(state,'projects',record.projectId));
    if (record.eventId) requireManage(state,actor,find(state,'events',record.eventId));
    if (kind === 'tasks' && record.parentId) requireManage(state,actor,find(state,'tasks',record.parentId));
    if (kind === 'events') record.confirmationStatus = 'draft';
    if (kind === 'projects') { record.status ||= 'planning'; assert(record.status !== 'completed',400,'INVALID_INITIAL_STATUS','新專案需先建立及交付必要成果，再完成結案。'); }
    if (kind === 'obligations') record.status ||= 'pending';
    if (kind === 'tasks') {
      record.status ||= record.ownerPersonId || record.ownerEmail ? 'todo' : 'unassigned';
      if (!record.ownerPersonId && !record.ownerEmail && ['todo','accepted'].includes(record.status)) record.status = 'unassigned';
      record.dependsOn ||= []; record.requiredForCompletion ??= true;
      if (!record.requiredForCompletion) assert(canAssign(state,actor,record),403,'ASSIGNMENT_REQUIRED','移出必要結案項目需要專案負責人或顧問確認。');
      assert(!['done','cancelled','delivered'].includes(record.status),400,'INVALID_INITIAL_STATUS','新任務需從待辦或進行中開始。');
      assertOpenProject(state,record); validateTaskGraph(state,record);
    }
    if (kind === 'posts') { record.copyVersion = 1; record.stage = fields.caption ? 'draft' : 'brief'; record.channel ||= 'instagram'; record.slides ||= []; record.caption ||= ''; record.sourceEventVersion = find(state,'events',record.eventId).version; }
    state[kind].push(record);
    if (kind === 'posts') capturePostRevision(state,record,actor,now,action);
    if (kind === 'obligations') for (const post of state.posts.filter(post => relevantObligations(state,post).some(item => item.id === record.id))) invalidatePost(state,post,actor,now,'新增宣傳義務，需要重新確認內容。');
    audit(state,actor,action,record,0,now,`建立 ${record.title}`);
    return {ok:true,record};
  }
  const record = find(state,kind,id); versionCheck(record,expectedVersion); const from = record.version;
  if (operation === 'update') {
    requireManage(state,actor,record);
    const fields = cleanFields(kind,payload);
    assert(Object.keys(fields).length > 0,400,'EMPTY_UPDATE','沒有可更新的欄位。');
    const candidate = {...record,...fields}; references(state,kind,candidate);
    if (candidate.projectId !== record.projectId || fields.projectId !== undefined) fields.projectId = candidate.projectId || '';
    if (candidate.eventId !== record.eventId) fields.eventId = candidate.eventId;
    if (fields.projectId && fields.projectId !== record.projectId) requireManage(state,actor,find(state,'projects',fields.projectId));
    if (fields.eventId && fields.eventId !== record.eventId) requireManage(state,actor,find(state,'events',fields.eventId));
    if (kind === 'tasks' && fields.parentId && fields.parentId !== record.parentId) requireManage(state,actor,find(state,'tasks',fields.parentId));
    if (kind === 'posts') assert(record.stage !== 'published',409,'PUBLISHED_IMMUTABLE','已發布內容保留原始證據；請建立新版貼文處理修正。');
    if (kind === 'tasks') {
      assert(record.status !== 'done',409,'TASK_COMPLETED_IMMUTABLE','已驗收任務需先以原因重新開啟，不能直接覆寫交付紀錄。');
      assert(!['delivered','done'].includes(fields.status) || fields.status === record.status,409,'TASK_REVIEW_ACTION_REQUIRED','請使用「交件」或「驗收通過」操作，不能直接把任務改成待驗收或完成。');
      assertOpenProject(state,record); assertOpenProject(state,candidate);
      if (candidate.projectId !== record.projectId && record.projectId) assert(canManage(state,actor,find(state,'projects',record.projectId)),403,'TASK_SCOPE_CHANGE_REQUIRED','移動或移除專案中的任務，需要原專案負責人或顧問確認。');
      if (candidate.parentId !== record.parentId && record.parentId) assert(canManage(state,actor,find(state,'tasks',record.parentId)),403,'TASK_SCOPE_CHANGE_REQUIRED','移動或移除必要子任務，需要原上層任務負責人或顧問確認。');
      if (['ownerEmail','ownerPersonId'].some(key => fields[key] !== undefined && fields[key] !== record[key])) {
        const claimingSelf = !record.ownerPersonId && !record.ownerEmail && (personMatches(state,candidate.ownerPersonId,actor) || candidate.ownerEmail === actor.email);
        const matchingLegacyOwner = !record.ownerPersonId && record.ownerEmail === actor.email && personMatches(state,candidate.ownerPersonId,actor);
        const clearingOwnLegacyEmail = record.ownerPersonId && candidate.ownerPersonId === record.ownerPersonId && personMatches(state,record.ownerPersonId,actor) && fields.ownerEmail === '';
        assert(canAssign(state,actor,record) || claimingSelf || matchingLegacyOwner || clearingOwnLegacyEmail,403,'ASSIGNMENT_REQUIRED','改派負責人需要專案負責人或顧問執行。');
      }
      if (fields.requiredForCompletion !== undefined && fields.requiredForCompletion !== (record.requiredForCompletion !== false)) assert(canAssign(state,actor,record),403,'ASSIGNMENT_REQUIRED','調整必要結案項目需要專案負責人或顧問確認。');
      if (record.status === 'delivered' && (fields.status === undefined || fields.status === 'delivered')) candidate.status = fields.status = candidate.ownerPersonId || candidate.ownerEmail ? 'todo' : 'unassigned';
      if (!candidate.ownerPersonId && !candidate.ownerEmail && ['todo','accepted','unassigned'].includes(candidate.status)) candidate.status = fields.status = 'unassigned';
      else if ((candidate.ownerPersonId || candidate.ownerEmail) && candidate.status === 'unassigned') candidate.status = fields.status = 'todo';
      validateTaskGraph(state,candidate);
    }
    if (kind === 'projects' && candidate.status === 'completed') requireProjectCompletion(state,candidate);
    const changed = Object.keys(fields).filter(key => JSON.stringify(record[key]) !== JSON.stringify(fields[key]));
    if (!changed.length) return {ok:true,record};
    if (kind === 'posts') capturePostRevision(state,record,actor,now,'post.before-update');
    if (kind === 'events') for (const post of state.posts.filter(post => post.eventId === record.id && post.stage !== 'published')) capturePostRevision(state,post,actor,now,'event.before-update');
    if (kind === 'tasks' && record.status === 'delivered') {
      captureTaskDelivery(record,actor,now,'task.delivery-invalidated',{reason:'任務資料更新，需要重新交件。'});
      clearTaskReview(record);
    }
    const affectedBefore = kind === 'obligations' ? state.posts.filter(post => relevantObligations(state,post).some(item => item.id === record.id)).map(post => post.id) : [];
    Object.assign(record,fields); touch(record,now);
    if (kind === 'events') {
      record.confirmationStatus = record.confirmationStatus === 'confirmed' ? 'changed' : record.confirmationStatus;
      for (const post of state.posts.filter(post => post.eventId === record.id)) invalidatePost(state,post,actor,now,'活動資料已變更，需要重新確認文案。');
    }
    if (kind === 'obligations' && changed.some(key => ['projectId','eventId','title','requirements','channel','requiresSponsorReview','sourceUrl'].includes(key) || (key === 'status' && (fields.status === 'cancelled' || !affectedBefore.length)))) {
      for (const post of state.posts.filter(post => affectedBefore.includes(post.id) || relevantObligations(state,post).some(item => item.id === record.id))) invalidatePost(state,post,actor,now,'宣傳義務已變更，需要重新確認內容。');
    }
    if (kind === 'posts' && changed.some(key => COPY_FIELDS.has(key) || ['sourceUrl','sourceLabel','sourceDate','sourceRevision'].includes(key))) {
      invalidatePost(state,record,actor,now,'文案或宣傳重點已修改，先前審核已失效。',{captureBefore:false,captureAfter:false});
      record.stage = 'draft'; record.generationMethod = 'manual';
    }
    if (kind === 'posts') capturePostRevision(state,record,actor,now,action);
    audit(state,actor,action,record,from,now,`更新 ${changed.join('、')}`); return {ok:true,record};
  }
  if (entity === 'event' && ['preview-checklist','apply-checklist'].includes(operation)) {
    requireManage(state,actor,record);
    assert(validDate(record.date || ''),400,'EVENT_DATE_REQUIRED','先填寫活動日期，才能產生建議任務期限。');
    assert(record.confirmationStatus !== 'cancelled',409,'EVENT_CANCELLED','已取消的活動不能新增籌辦清單。');
    const proposed = lessonTasks(record);
    const existing = new Set(state.tasks.filter(task => task.eventId === record.id && task.templateId === LESSON_TEMPLATE_ID).map(task => task.templateTaskKey));
    const tasks = proposed.filter(task => !existing.has(task.key));
    if (operation === 'preview-checklist') return {ok:true,record:{templateId:LESSON_TEMPLATE_ID,eventVersion:record.version,tasks,existing:existing.size}};
    assert(payload.confirmed === true && payload.templateId === LESSON_TEMPLATE_ID,400,'TEMPLATE_CONFIRMATION_REQUIRED','先核對社課清單及建議期限，再確認套用。');
    const created = [];
    for (const task of tasks) {
      const result = executeAction(state,{action:'task.create',payload:{title:task.title,eventId:record.id,projectId:record.projectId || '',ownerPersonId:'',ownerEmail:'',reviewerPersonId:'',status:'unassigned',dueDate:task.dueDate,acceptanceCriteria:task.acceptanceCriteria,requiredForCompletion:true,sourceLabel:'ITRC 共通社課檢查清單 v1'}},actor,now).record;
      result.templateId = LESSON_TEMPLATE_ID; result.templateTaskKey = task.key;
      created.push(result);
    }
    audit(state,actor,action,record,record.version,now,`套用社課清單：新增 ${created.length} 項待指派任務；建議期限需依實際流程調整。`);
    return {ok:true,record:{created:created.length,skipped:existing.size,tasks:created}};
  }
  if (entity === 'event' && operation === 'confirm') {
    requireManage(state,actor,record);
    assert(validDate(record.date || '') && record.speaker && record.venue,400,'EVENT_INCOMPLETE','請先填妥日期、講者與場地。');
    if (record.confirmationStatus === 'confirmed') return {ok:true,record};
    for (const post of state.posts.filter(post => post.eventId === record.id && post.stage !== 'published')) capturePostRevision(state,post,actor,now,'event.before-confirm');
    record.confirmationStatus = 'confirmed'; touch(record,now);
    for (const post of state.posts.filter(post => post.eventId === record.id)) invalidatePost(state,post,actor,now,'活動事實已確認，請核對新版活動資料。');
    audit(state,actor,action,record,from,now,'確認活動日期、講者與地點'); return {ok:true,record};
  }
  if (entity === 'event' && operation === 'cancel') {
    requireManage(state,actor,record);
    assert(typeof payload.reason === 'string' && payload.reason.trim(),400,'REASON_REQUIRED','請填入取消原因。');
    for (const post of state.posts.filter(post => post.eventId === record.id && post.stage !== 'published')) capturePostRevision(state,post,actor,now,'event.before-cancel');
    record.confirmationStatus = 'cancelled'; record.cancellationReason = payload.reason.trim().slice(0,2000); touch(record,now);
    for (const post of state.posts.filter(post => post.eventId === record.id)) invalidatePost(state,post,actor,now,'活動已取消，請處理宣傳變更與更正。');
    audit(state,actor,action,record,from,now,record.cancellationReason); return {ok:true,record};
  }
  if (entity === 'task') {
    if (operation === 'comment' || operation === 'add-link') {
      assert(canManage(state,actor,record) || personMatches(state,record.reviewerPersonId,actor),403,'OWNER_REQUIRED','請由承辦人、驗收人或管理顧問補充這項交付。');
      if (operation === 'comment') {
        assert(Object.keys(payload).every(key => ['text','attachmentUrl'].includes(key)),400,'UNSUPPORTED_FIELD','留言只接受內容與補充連結。');
        assert(typeof payload.text === 'string' && payload.text.trim() && payload.text.length <= 2000,400,'COMMENT_REQUIRED','留言需有內容，最多 2000 字。');
        if (payload.attachmentUrl) { assert(typeof payload.attachmentUrl === 'string' && payload.attachmentUrl.length <= 2000,400,'INVALID_URL','補充連結最多 2000 字。'); httpsUrl(payload.attachmentUrl,'補充連結',{optional:false}); }
        record.comments ||= [];
        assert(record.comments.length < 500,400,'COMMENT_LIMIT','單項任務已達 500 則留言，請另開後續任務。');
        record.comments.push({id:randomUUID(),text:payload.text.trim(),attachmentUrl:payload.attachmentUrl || '',actorEmail:actor.email,createdAt:now});
      } else {
        assert(Object.keys(payload).every(key => ['title','url'].includes(key)),400,'UNSUPPORTED_FIELD','補充連結只接受名稱與網址。');
        assert(typeof payload.title === 'string' && payload.title.trim() && payload.title.length <= 200,400,'LINK_TITLE_REQUIRED','請填寫 200 字以內的連結名稱。');
        assert(typeof payload.url === 'string' && payload.url.length <= 2000,400,'INVALID_URL','補充文件網址最多 2000 字。');
        httpsUrl(payload.url,'補充文件網址',{optional:false});
        record.links ||= [];
        assert(record.links.length < 30,400,'LINK_LIMIT','單項任務最多 30 筆補充連結，更多資料請用一份整理頁連結。');
        assert(!record.links.some(link => link.url === payload.url),409,'LINK_EXISTS','這個連結已經在任務內，無需重複新增。');
        record.links.push({id:randomUUID(),title:payload.title.trim(),url:payload.url,actorEmail:actor.email,createdAt:now});
      }
      touch(record,now); audit(state,actor,action,record,from,now,operation === 'comment' ? '追加任務討論；保留既有交付及驗收證據。' : '追加補充連結；既有交付快照不被覆寫。');
      return {ok:true,record};
    }
    assertOpenProject(state,record);
    if (operation === 'deliver') {
      requireManage(state,actor,record);
      assert(['todo','accepted','doing','blocked'].includes(record.status),409,'INVALID_STAGE','任務需已指派並處於待辦或進行中，才能交件。');
      assert(record.ownerPersonId || record.ownerEmail,409,'TASK_UNASSIGNED','請先指派實際承辦人。');
      assert(record.acceptanceCriteria?.trim(),400,'ACCEPTANCE_CRITERIA_REQUIRED','交件前請填寫可核對的驗收標準。');
      assert(record.reviewerPersonId,400,'TASK_REVIEWER_REQUIRED','交件前請指定驗收人。');
      const reviewer = requirePerson(state,record.reviewerPersonId,'驗收人');
      const owner = record.ownerPersonId ? requirePerson(state,record.ownerPersonId,'承辦人') : null;
      assert(record.ownerPersonId !== record.reviewerPersonId && (!reviewer.email || reviewer.email !== (owner?.email || record.ownerEmail)),409,'INDEPENDENT_REVIEW_REQUIRED','承辦人與驗收人需要是不同人。');
      const deliverableUrl = payload.deliverableUrl || record.deliverableUrl;
      httpsUrl(deliverableUrl,'交付成果網址',{optional:false});
      const candidate = {...record,status:'delivered',deliverableUrl};
      validateTaskGraph(state,candidate); requireCompletedChildren(state,record);
      clearTaskReview(record);
      Object.assign(record,{status:'delivered',deliverableUrl,deliveredBy:actor.email,deliveredAt:now,blocker:''});
      delete record.returnReason;
      touch(record,now); captureTaskDelivery(record,actor,now,action);
      audit(state,actor,action,record,from,now,'已交件，等待指定驗收人確認；尚未記為完成。');
      return {ok:true,record};
    }
    if (operation === 'accept-delivery' || operation === 'return-delivery') {
      assert(record.status === 'delivered',409,'INVALID_STAGE','只有已交件的任務可驗收或退回。');
      const accepting = operation === 'accept-delivery';
      const review = taskReviewAuthority(state,record,actor,payload,{accepting});
      if (accepting) {
        assert(record.acceptanceCriteria?.trim(),400,'ACCEPTANCE_CRITERIA_REQUIRED','請先補齊驗收標準並重新交件。');
        validateTaskGraph(state,{...record,status:'done'}); requireCompletedChildren(state,record);
        assert(payload.comment === undefined || (typeof payload.comment === 'string' && payload.comment.length <= 2000),400,'INVALID_COMMENT','驗收備註最多 2000 字。');
        Object.assign(record,review,{status:'done',acceptedAt:now,acceptedBy:actor.email,acceptedReviewerPersonId:record.reviewerPersonId,reviewComment:payload.comment?.trim() || ''});
        touch(record,now); captureTaskDelivery(record,actor,now,action,review);
        audit(state,actor,action,record,from,now,review.reviewIdentityMode === 'individual_account' ? '指定驗收人以個人帳號確認成果。' : '社長／顧問代登錄指定驗收人的外部確認，已附證據；此為代登錄紀錄。');
      } else {
        assert(typeof payload.reason === 'string' && payload.reason.trim() && payload.reason.length <= 2000,400,'REASON_REQUIRED','請填寫退回修改的原因。');
        record.status = 'todo'; record.returnReason = payload.reason.trim();
        Object.assign(record,review); touch(record,now); captureTaskDelivery(record,actor,now,action,{...review,reason:record.returnReason});
        audit(state,actor,action,record,from,now,record.returnReason);
      }
      return {ok:true,record};
    }
    if (operation === 'reopen') {
      assert(canManage(state,actor,record) || personMatches(state,record.reviewerPersonId,actor),403,'OWNER_REQUIRED','重新開啟任務需要負責人、驗收人或管理者。');
      assert(['done','cancelled'].includes(record.status),409,'INVALID_STAGE','只有已完成或已取消任務需要重新開啟。');
      assert(typeof payload.reason === 'string' && payload.reason.trim() && payload.reason.length <= 2000,400,'REASON_REQUIRED','請填寫重新開啟的原因。');
      captureTaskDelivery(record,actor,now,'task.before-reopen',{reason:payload.reason.trim()});
      clearTaskReview(record); record.status = record.ownerPersonId || record.ownerEmail ? 'todo' : 'unassigned'; record.reopenReason = payload.reason.trim();
      touch(record,now); audit(state,actor,action,record,from,now,record.reopenReason); return {ok:true,record};
    }
    fail(400,'UNKNOWN_ACTION','不支援這項任務操作。');
  }
  assert(entity === 'post',400,'UNKNOWN_ACTION','不支援這項操作。');
  assert(record.stage !== 'published',409,'PUBLISHED_IMMUTABLE','已發布記錄不可重寫；請建立新版貼文。');
  switch (operation) {
    case 'restore-version': {
      requireManage(state,actor,record);
      const historical = (record.history || []).find(item => item.id === payload.historyId);
      assert(historical,404,'HISTORY_NOT_FOUND','找不到要回復的文案版本。');
      capturePostRevision(state,record,actor,now,'post.before-restore');
      for (const key of COPY_FIELDS) if (!['eventId','projectId'].includes(key)) record[key] = structuredClone(historical[key] ?? (key === 'slides' ? [] : ''));
      invalidatePost(state,record,actor,now,`由文案第 ${historical.copyVersion} 版建立新草稿，請重新確認目前活動事實。`,{captureBefore:false,captureAfter:false});
      record.stage = 'draft'; record.generationMethod = 'restored'; record.restoredFromHistoryId = historical.id;
      capturePostRevision(state,record,actor,now,action); audit(state,actor,action,record,from,now,record.revisionReason); return {ok:true,record};
    }
    case 'generate': {
      requireManage(state,actor,record);
      assert(['brief','draft','needs_revision'].includes(record.stage),409,'INVALID_STAGE','請先退回修改，再重新產生文案。');
      const job = enqueue(state,record,'copy',actor,now);
      audit(state,actor,action,job,0,now,'排入文案草稿產生工作'); return {ok:true,record:job};
    }
    case 'submit':
      requireManage(state,actor,record);
      assert(['draft','needs_revision'].includes(record.stage),409,'INVALID_STAGE','目前階段無法送出單位審核。');
      assert(record.caption?.trim() && record.slides?.length,400,'COPY_REQUIRED','請先完成文案與輪播短文。');
      requireFacts(state,record); record.stage = 'unit_review'; break;
    case 'unit-review':
      assert(canReviewUnit(state,actor,record),403,'UNIT_REVIEWER_REQUIRED','請由活動負責人或顧問確認內容。');
      assert(record.stage === 'unit_review',409,'INVALID_STAGE','這篇貼文尚未進入單位審核。');
      requireFacts(state,record); record.unitReviewedVersion = record.copyVersion; record.unitReviewedBy = actor.email; record.stage = 'approval'; break;
    case 'approve':
      assert(actor.canApprove,403,'FINAL_APPROVER_REQUIRED','只有指定的最終審核人能核准這一版文案。');
      assert(record.stage === 'approval' && record.unitReviewedVersion === record.copyVersion,409,'INVALID_STAGE','請先完成目前版本的單位審核。');
      requireFacts(state,record); record.approvedVersion = record.copyVersion; record.approvedBy = actor.email; record.approvedAt = now; record.stage = 'design_pending';
      touch(record,now); capturePostRevision(state,record,actor,now,action); enqueue(state,record,'canva',actor,now); audit(state,actor,action,record,from,now,`核准文案第 ${record.copyVersion} 版並排入設計工作`); return {ok:true,record};
    case 'reject':
      assert(canReviewUnit(state,actor,record) || actor.canApprove || actor.canDesign,403,'REVIEWER_REQUIRED','這項操作需要負責人或審核人執行。');
      assert(typeof payload.reason === 'string' && payload.reason.trim().length > 0 && payload.reason.length <= 2000,400,'REASON_REQUIRED','請說明需要修改的原因。');
      invalidatePost(state,record,actor,now,payload.reason.trim(),{incrementCopy:false}); return {ok:true,record};
    case 'request-design': {
      assert(canManage(state,actor,record) || actor.canDesign || actor.canApprove,403,'DESIGNER_REQUIRED','請由負責人或行銷人員安排設計。');
      requireFacts(state,record); assert(record.approvedVersion === record.copyVersion,409,'APPROVAL_REQUIRED','只有已核准的目前版本能產生設計。');
      const job = enqueue(state,record,'canva',actor,now); return {ok:true,record:job};
    }
    case 'attach-design':
      assert(actor.canDesign || isAdvisor(actor),403,'DESIGNER_REQUIRED','設計交付需要指定的行銷負責人或顧問執行。');
      requireFacts(state,record); assert(record.approvedVersion === record.copyVersion,409,'APPROVAL_REQUIRED','文案目前版本尚未核准。');
      httpsUrl(payload.canvaEditUrl,'Canva 編輯網址',{canva:true,optional:false});
      assert(!payload.canvaDesignId || (typeof payload.canvaDesignId === 'string' && /^[A-Za-z0-9_-]{3,100}$/.test(payload.canvaDesignId)),400,'INVALID_DESIGN_ID','Canva 設計識別碼不正確。');
      record.canvaEditUrl = payload.canvaEditUrl; record.canvaDesignId = payload.canvaDesignId || ''; record.designCopyVersion = record.copyVersion; record.stage = 'design_review';
      delete record.designApprovedBy; delete record.sponsorApprovedVersion;
      for (const job of state.jobs.filter(job => job.postId === record.id && job.copyVersion === record.copyVersion && job.type === 'canva' && job.status !== 'obsolete')) { job.status = 'succeeded'; job.result = {canvaEditUrl:record.canvaEditUrl,canvaDesignId:record.canvaDesignId,manual:true}; job.lastError = ''; touch(job,now); }
      break;
    case 'design-review':
      assert(actor.canDesign || isAdvisor(actor),403,'DESIGNER_REQUIRED','設計完稿需要指定的行銷負責人或顧問確認。');
      requireFacts(state,record); assert(record.stage === 'design_review' && record.designCopyVersion === record.copyVersion && record.approvedVersion === record.copyVersion && record.canvaEditUrl,409,'DESIGN_REVIEW_REQUIRED','請先交付與核准文案一致的 Canva 設計。');
      record.designApprovedBy = actor.email; record.designApprovedAt = now;
      record.stage = relevantObligations(state,record).some(item => item.requiresSponsorReview) ? 'sponsor_review' : 'ready'; break;
    case 'sponsor-review':
      assert(canReviewUnit(state,actor,record) || actor.canDesign || isAdvisor(actor),403,'REVIEWER_REQUIRED','請由負責人或行銷人員記錄贊助方確認。');
      requireFacts(state,record); assert(record.stage === 'sponsor_review' && record.designCopyVersion === record.copyVersion && record.approvedVersion === record.copyVersion && record.designApprovedBy,409,'INVALID_STAGE','這篇貼文目前不在贊助方審核階段。');
      assert(payload.confirmed === true,400,'CONFIRMATION_REQUIRED','請確認已取得贊助方同意。'); httpsUrl(payload.evidenceUrl,'贊助方確認證據',{optional:false});
      record.sponsorApprovedVersion = record.copyVersion; record.sponsorApprovedBy = actor.email; record.sponsorEvidenceUrl = payload.evidenceUrl; record.stage = 'ready'; break;
    case 'publish':
      assert(canManage(state,actor,record) || actor.canDesign || isAdvisor(actor),403,'PUBLISHER_REQUIRED','發布紀錄需要負責人或行銷人員填寫。');
      requireFacts(state,record);
      assert(record.stage === 'ready' && record.approvedVersion === record.copyVersion && record.unitReviewedVersion === record.copyVersion && record.designCopyVersion === record.copyVersion && record.designApprovedBy,409,'NOT_READY','目前版本尚未完成所有審核。');
      assert(!relevantObligations(state,record).some(item => item.requiresSponsorReview) || record.sponsorApprovedVersion === record.copyVersion,409,'SPONSOR_REVIEW_REQUIRED','請先記錄贊助方確認。');
      httpsUrl(payload.publishedUrl,'發布證據網址',{optional:false});
      assert(typeof payload.publishedAt === 'string' && !Number.isNaN(Date.parse(payload.publishedAt)) && Date.parse(payload.publishedAt) <= Date.parse(now) + 60000,400,'INVALID_DATE','請填入實際發布時間，不能使用未來時間。');
      record.publishedUrl = payload.publishedUrl; record.publishedAt = new Date(payload.publishedAt).toISOString(); record.stage = 'published'; break;
    default: fail(400,'UNKNOWN_ACTION','不支援這項操作。');
  }
  touch(record,now); capturePostRevision(state,record,actor,now,action); audit(state,actor,action,record,from,now,`${action}（文案第 ${record.copyVersion} 版）`);
  return {ok:true,record};
}

module.exports = { executeAction, isAdvisor, canManage, find, versionCheck, newRecord, touch, audit, relevantObligations, clearApproval, obsoleteJobs, requireFacts, httpsUrl, cleanFields, capturePostRevision };
