'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { assert, fail } = require('./errors');

const FIELDS = {
  projects: ['title','objective','ownerEmail','adviserEmail','status','dueDate','completionCriteria'],
  events: ['projectId','title','speaker','date','time','venue','audience','fee','registrationUrl','highlights','ownerEmail','sourceUrl','sourceLabel','sourceDate','sourceRevision','sourceKey'],
  obligations: ['projectId','eventId','title','requirements','channel','requiresSponsorReview','sourceUrl','status','ownerEmail','evidenceUrl'],
  posts: ['projectId','eventId','title','purpose','audience','highlights','cta','channel','scheduledAt','ownerEmail','caption','slides','sourceUrl','sourceLabel','sourceDate','sourceRevision','sourceKey'],
  tasks: ['projectId','eventId','postId','title','ownerEmail','parentId','dependsOn','dueDate','status','blocker','deliverableUrl','acceptanceCriteria','sourceUrl','sourceLabel','sourceDate','sourceRevision','sourceKey'],
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
function canManage(state, actor, record) {
  const project = projectOf(state, record);
  return isAdvisor(actor) || record.ownerEmail === actor.email || record.adviserEmail === actor.email || project?.adviserEmail === actor.email || project?.ownerEmail === actor.email;
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
    } else if (key === 'requiresSponsorReview') {
      assert(typeof value === 'boolean',400,'INVALID_BOOLEAN','贊助方審核欄位需要是布林值。'); cleaned[key] = value;
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
  if (record.postId) {
    const post = find(state,'posts',record.postId);
    assert(!record.eventId || post.eventId === record.eventId,400,'REFERENCE_MISMATCH','任務連結的活動與宣傳不一致。');
    record.eventId ||= post.eventId;
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
  }
  if (candidate.status === 'blocked') assert(candidate.blocker,400,'BLOCKER_REQUIRED','請說明卡關原因。');
  if (['delivered','done'].includes(candidate.status)) {
    assert(candidate.deliverableUrl,400,'DELIVERABLE_REQUIRED','交付或完成任務前，請附上成果網址。');
    httpsUrl(candidate.deliverableUrl,'成果網址',{optional:false});
  }
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
function invalidatePost(state, post, actor, now, reason, { incrementCopy = true } = {}) {
  if (post.stage === 'published') {
    const dedupe = `${post.id}:${reason}`;
    if (!state.tasks.some(task => task.correctionKey === dedupe && task.status !== 'done' && task.status !== 'cancelled')) {
      const task = newRecord({title:`檢查已發布內容：${post.title}`,projectId:post.projectId || '',eventId:post.eventId,postId:post.id,ownerEmail:post.ownerEmail,status:post.ownerEmail?'todo':'unassigned',dependsOn:[],acceptanceCriteria:'核對公開內容；如需修正，另建新版宣傳並附修正證據。',blocker:reason,correctionKey:dedupe},now);
      state.tasks.push(task); audit(state,actor,'post.correction-required',task,0,now,reason);
    }
    return;
  }
  const from = post.version;
  if (post.canvaEditUrl) post.previousDesigns = [...(post.previousDesigns || []),{copyVersion:post.designCopyVersion,canvaDesignId:post.canvaDesignId || '',canvaEditUrl:post.canvaEditUrl}];
  clearApproval(post);
  if (incrementCopy) post.copyVersion += 1;
  post.stage = 'needs_revision'; post.revisionReason = reason;
  const event = state.events.find(item => item.id === post.eventId);
  post.sourceEventVersion = event?.version || 0;
  touch(post,now); obsoleteJobs(state,post,now);
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
      const record = {...fields,sourceKey,ownerEmail:fields.ownerEmail || actor.email};
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
      if (kind === 'tasks') { record.status = record.ownerEmail ? 'todo' : 'unassigned'; record.dependsOn = fields.dependsOn || []; validateTaskGraph(state,{...record,id:`import-${sourceKey}`}); }
      preview[kind].push(record);
    }
  }
  return preview;
}

function executeAction(state, command, actor, now) {
  const {action,id,expectedVersion,payload = {}} = command;
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
    const ownerEmail = fields.ownerEmail || actor.email;
    if (ownerEmail !== actor.email) assert(isAdvisor(actor) || (fields.projectId && canManage(state,actor,find(state,'projects',fields.projectId))),403,'ASSIGNMENT_REQUIRED','替他人指派工作需要專案負責人或顧問執行。');
    const record = newRecord({...fields,ownerEmail},now);
    references(state,kind,record);
    if (record.projectId) requireManage(state,actor,find(state,'projects',record.projectId));
    if (record.eventId) requireManage(state,actor,find(state,'events',record.eventId));
    if (kind === 'events') record.confirmationStatus = 'draft';
    if (kind === 'projects') record.status ||= 'planning';
    if (kind === 'obligations') record.status ||= 'pending';
    if (kind === 'tasks') { record.status ||= 'todo'; record.dependsOn ||= []; assert(!['done','cancelled','delivered'].includes(record.status),400,'INVALID_INITIAL_STATUS','新任務需從待辦或進行中開始。'); validateTaskGraph(state,record); }
    if (kind === 'posts') { record.copyVersion = 1; record.stage = fields.caption ? 'draft' : 'brief'; record.channel ||= 'instagram'; record.slides ||= []; record.caption ||= ''; record.sourceEventVersion = find(state,'events',record.eventId).version; }
    state[kind].push(record);
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
    if (kind === 'posts') assert(record.stage !== 'published',409,'PUBLISHED_IMMUTABLE','已發布內容保留原始證據；請建立新版貼文處理修正。');
    if (kind === 'tasks') {
      if (fields.ownerEmail !== undefined && fields.ownerEmail !== record.ownerEmail) assert(isAdvisor(actor) || projectOf(state,record)?.adviserEmail === actor.email || projectOf(state,record)?.ownerEmail === actor.email,403,'ASSIGNMENT_REQUIRED','改派負責人需要專案負責人或顧問執行。');
      validateTaskGraph(state,candidate);
    }
    const changed = Object.keys(fields).filter(key => JSON.stringify(record[key]) !== JSON.stringify(fields[key]));
    if (!changed.length) return {ok:true,record};
    const affectedBefore = kind === 'obligations' ? state.posts.filter(post => relevantObligations(state,post).some(item => item.id === record.id)).map(post => post.id) : [];
    Object.assign(record,fields); touch(record,now);
    if (kind === 'events') {
      record.confirmationStatus = record.confirmationStatus === 'confirmed' ? 'changed' : record.confirmationStatus;
      for (const post of state.posts.filter(post => post.eventId === record.id)) invalidatePost(state,post,actor,now,'活動資料已變更，需要重新確認文案。');
    }
    if (kind === 'obligations' && changed.some(key => ['projectId','eventId','title','requirements','channel','requiresSponsorReview','sourceUrl'].includes(key) || (key === 'status' && (fields.status === 'cancelled' || !affectedBefore.length)))) {
      for (const post of state.posts.filter(post => affectedBefore.includes(post.id) || relevantObligations(state,post).some(item => item.id === record.id))) invalidatePost(state,post,actor,now,'宣傳義務已變更，需要重新確認內容。');
    }
    if (kind === 'posts' && changed.some(key => COPY_FIELDS.has(key))) {
      invalidatePost(state,record,actor,now,'文案或宣傳重點已修改，先前審核已失效。');
      record.stage = 'draft'; record.generationMethod = 'manual';
    }
    audit(state,actor,action,record,from,now,`更新 ${changed.join('、')}`); return {ok:true,record};
  }
  if (entity === 'event' && operation === 'confirm') {
    requireManage(state,actor,record);
    assert(validDate(record.date || '') && record.speaker && record.venue,400,'EVENT_INCOMPLETE','請先填妥日期、講者與場地。');
    if (record.confirmationStatus === 'confirmed') return {ok:true,record};
    record.confirmationStatus = 'confirmed'; touch(record,now);
    for (const post of state.posts.filter(post => post.eventId === record.id)) invalidatePost(state,post,actor,now,'活動事實已確認，請核對新版活動資料。');
    audit(state,actor,action,record,from,now,'確認活動日期、講者與地點'); return {ok:true,record};
  }
  if (entity === 'event' && operation === 'cancel') {
    requireManage(state,actor,record);
    assert(typeof payload.reason === 'string' && payload.reason.trim(),400,'REASON_REQUIRED','請填入取消原因。');
    record.confirmationStatus = 'cancelled'; record.cancellationReason = payload.reason.trim().slice(0,2000); touch(record,now);
    for (const post of state.posts.filter(post => post.eventId === record.id)) invalidatePost(state,post,actor,now,'活動已取消，請處理宣傳變更與更正。');
    audit(state,actor,action,record,from,now,record.cancellationReason); return {ok:true,record};
  }
  assert(entity === 'post',400,'UNKNOWN_ACTION','不支援這項操作。');
  assert(record.stage !== 'published',409,'PUBLISHED_IMMUTABLE','已發布記錄不可重寫；請建立新版貼文。');
  switch (operation) {
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
      touch(record,now); enqueue(state,record,'canva',actor,now); audit(state,actor,action,record,from,now,`核准文案第 ${record.copyVersion} 版並排入設計工作`); return {ok:true,record};
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
  touch(record,now); audit(state,actor,action,record,from,now,`${action}（文案第 ${record.copyVersion} 版）`);
  return {ok:true,record};
}

module.exports = { executeAction, isAdvisor, canManage, find, versionCheck, newRecord, touch, audit, relevantObligations, clearApproval, obsoleteJobs, requireFacts, httpsUrl, cleanFields };
