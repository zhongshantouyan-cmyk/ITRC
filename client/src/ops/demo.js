import { canOwn, isAdviser, EVENT_TYPES, eventMissingFacts, eventSpeakerText } from './model.js';
import { isInactivePerson, personById } from './people.js';

const KEY = 'itrc-ops-fictional-demo-v1';
const uuid = () => globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = data => JSON.parse(JSON.stringify(data));
export const DEMO_ACTORS = [
  { email: 'activity@example.invalid', name: '活動負責人（示範）', role: 'officer', canApprove: false, canDesign: false },
  { email: 'approver@example.invalid', name: '最終審核者（示範）', role: 'chair', canApprove: true, canDesign: false },
  { email: 'design@example.invalid', name: '行銷負責人（示範）', role: 'officer', canApprove: false, canDesign: true },
  { email: 'adviser@example.invalid', name: '管理顧問（示範）', role: 'advisor', canApprove: false, canDesign: false },
];
function demoPeople() {
  return DEMO_ACTORS.map((actor, index) => ({ personId: `DEMO-P${String(index + 1).padStart(4, '0')}`, name: actor.name, email: actor.email, title: actor.name.replace('（示範）', ''), group: ['活動組', '管理組', '行銷組', '管理組'][index], status: 'active', term: '虛構示範學期', lineName: '', sourceUrl: 'https://example.org/demo-roster', sourceRevision: '虛構示範 v1' }));
}
function addDemoPeople(state) {
  state.people ||= demoPeople();
  state.sourceChanges ||= [];
  for (const collection of ['projects', 'events', 'posts', 'tasks', 'obligations']) for (const record of state[collection]) {
    record.createdByEmail ||= record.ownerEmail || DEMO_ACTORS[3].email;
    if (record.ownerPersonId === undefined) record.ownerPersonId = state.people.find(person => person.email === record.ownerEmail)?.personId || '';
    if (collection === 'tasks') { record.requiredForCompletion ??= false; record.reviewerPersonId ??= ''; }
  }
  return state;
}
function seeded() {
  const now = new Date().toISOString();
  const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };
  const base = { version: 1, createdAt: now, updatedAt: now };
  return addDemoPeople({
    schemaVersion: 1, actor: DEMO_ACTORS[0],
    projects: [{ ...base, id: 'demo-project', title: '秋季交流活動（虛構示範）', objective: '練習將活動資料、宣傳與現場交付接起來。', ownerEmail: DEMO_ACTORS[0].email, adviserEmail: DEMO_ACTORS[3].email, status: 'active', dueDate: day(21), completionCriteria: '活動完成、宣傳留存、場務與收支交件。' }],
    events: [{ ...base, id: 'demo-event', projectId: 'demo-project', title: '從研究到表達：交流工作坊（示範）', speaker: '示範講者', date: day(14), time: '18:30', venue: '示範教室 A', audience: '對研究與交流有興趣的同學', fee: '免費（示範）', registrationUrl: 'https://example.org/demo-registration', highlights: '用一張圖整理想法\n分組交換研究觀察\n帶走自己的簡報草稿', ownerEmail: DEMO_ACTORS[0].email, confirmationStatus: 'confirmed', sourceUrl: '', sourceDate: day(0), sourceRevision: '虛構示範 v1' }],
    posts: [{ ...base, id: 'demo-post', projectId: 'demo-project', eventId: 'demo-event', title: '工作坊首波宣傳（示範）', purpose: '讓同學了解活動內容並完成報名', audience: '初次參與的同學', highlights: '不需要先備知識；帶著一個問題來交流。', cta: '查看活動資訊並報名', channel: 'instagram', scheduledAt: `${day(3)}T12:00`, ownerEmail: DEMO_ACTORS[0].email, caption: '', slides: [], copyVersion: 1, stage: 'brief', sourceEventVersion: 1, unitReviewedVersion: null, approvedVersion: null, designCopyVersion: null }],
    tasks: [
      { id: 'demo-task-1', title: '活動組｜確認講者與教室', ownerEmail: DEMO_ACTORS[0].email, status: 'done', dueDate: day(-1), acceptanceCriteria: '講者與場地皆已獲得確認', deliverableUrl: 'https://example.org/demo-confirmation' },
      { id: 'demo-task-2', title: '行銷組｜完成貼文與分層設計', ownerEmail: DEMO_ACTORS[2].email, status: 'todo', dueDate: day(3), dependsOn: ['demo-task-1'], acceptanceCriteria: '當前文案版本通過終審，Canva 可編輯連結已交件' },
      { id: 'demo-task-3', title: '資訊組｜測試投影與錄影', ownerEmail: '', status: 'unassigned', dueDate: day(12), acceptanceCriteria: '完成器材測試並附現場清單' },
      { id: 'demo-task-4', title: '財務組｜整理活動預算', ownerEmail: DEMO_ACTORS[3].email, status: 'blocked', dueDate: day(2), blocker: '等候場地費用確認（示範）', acceptanceCriteria: '預算列有金額、用途與佐證' },
      { id: 'demo-task-5', title: '公關組｜核對合作交付內容', ownerEmail: DEMO_ACTORS[0].email, status: 'doing', dueDate: day(4), acceptanceCriteria: '逐項登錄要求與確認證據' },
      { id: 'demo-task-6', title: '管理組｜驗收活動紀錄', ownerEmail: DEMO_ACTORS[3].email, status: 'todo', dueDate: day(18), dependsOn: ['demo-task-2', 'demo-task-3', 'demo-task-4', 'demo-task-5'], acceptanceCriteria: '活動紀錄、宣傳網址及交付證據完整' },
    ].map(task => ({ ...base, projectId: 'demo-project', eventId: 'demo-event', dependsOn: [], ...task })),
    obligations: [{ ...base, id: 'demo-obligation', projectId: 'demo-project', eventId: 'demo-event', title: '合作露出檢查（虛構）', requirements: '發布前確認合作標示位置；現場照片於結案時交付。', channel: 'instagram', requiresSponsorReview: true, status: 'active', ownerEmail: DEMO_ACTORS[0].email, sourceUrl: '' }],
    jobs: [], audit: [],
    settings: { mode: 'demo', approverConfigured: true, designerConfigured: true, sources: [], integrations: { drafting: { status: 'demo', configured: false, message: '使用本機規則草稿；未呼叫 AI。' }, canva: { status: 'demo', configured: false, message: '展示模式不建立外部設計；可體驗交件與校對欄位。' }, sheets: { status: 'demo', configured: false, message: '可試用 CSV / TSV / JSON 匯入；資料只留在此瀏覽器。' } } },
  });
}
export function loadDemo() {
  try { const state = JSON.parse(localStorage.getItem(KEY)); if (state?.schemaVersion === 1 && Array.isArray(state.posts)) return addDemoPeople(state); } catch { /* corrupt / inaccessible browser storage falls back visibly */ }
  const state = seeded(); saveDemo(state); return state;
}
export function saveDemo(state) { localStorage.setItem(KEY, JSON.stringify(state)); }
export function resetDemo() { const state = seeded(); saveDemo(state); return state; }
export function changeDemoActor(state, email) { const next = { ...state, actor: DEMO_ACTORS.find(a => a.email === email) || DEMO_ACTORS[0] }; saveDemo(next); return next; }

export function performDemoAction(current, command) {
  const state = addDemoPeople(clone(current)); const { action, id, expectedVersion, payload = {} } = command;
  const actor = state.actor; const now = new Date().toISOString();
  const kind = action.split('.')[0]; const collection = { project: 'projects', event: 'events', post: 'posts', task: 'tasks', obligation: 'obligations', job: 'jobs' }[kind];
  let record = collection && state[collection].find(item => item.id === id);
  if (id && !record) throw new Error('找不到這筆示範紀錄，請重新整理。');
  if (record && expectedVersion !== record.version) throw new Error('這筆資料已有新版本，請重新整理再操作。');
  const need = (ok, message) => { if (!ok) throw new Error(message); };
  const owner = () => need(canOwn(actor, record, state.projects, state.people, state.tasks), '請由負責人或管理顧問操作。');
  const touch = item => { item.version = (item.version || 0) + 1; item.updatedAt = now; };
  const saveHistory = (post, actionName = action) => {
    const { history, ...snapshot } = clone(post);
    post.history ||= [];
    post.history.push({ ...snapshot, id: uuid(), postVersion: post.version, sourceEventSnapshot: clone(state.events.find(event => event.id === post.eventId) || {}), action: actionName, actorEmail: actor.email, createdAt: now });
  };
  const invalidate = post => {
    saveHistory(post, 'post.snapshot');
    if (post.stage === 'published') {
      state.tasks.push({ id: uuid(), version: 1, createdAt: now, updatedAt: now, title: `核對已發布資訊：${post.title}`, projectId: post.projectId, eventId: post.eventId, postId: post.id, ownerEmail: post.ownerEmail, status: 'todo', dependsOn: [], acceptanceCriteria: '核對已發布內容與最新資料，留下更正紀錄。' }); return;
    }
    if (post.canvaEditUrl) post.previousDesigns = [...(post.previousDesigns || []), { copyVersion: post.designCopyVersion, canvaEditUrl: post.canvaEditUrl, canvaDesignId: post.canvaDesignId || '' }];
    post.copyVersion += 1; post.stage = 'draft'; post.unitReviewedVersion = null; post.approvedVersion = null; post.approvedBy = null; post.approvedAt = null; post.designCopyVersion = null; post.designApprovedBy = null; post.sponsorApprovedVersion = null;
    delete post.canvaEditUrl; delete post.canvaDesignId;
    delete post.completedAt; delete post.completedBy;
    post.sourceEventVersion = state.events.find(event => event.id === post.eventId)?.version || 0;
    state.jobs.filter(j => j.postId === post.id && !['succeeded', 'obsolete'].includes(j.status)).forEach(j => { j.status = 'obsolete'; touch(j); });
    touch(post);
  };
  need(!isInactivePerson(state.people.find(person => person.email === actor.email)), '此帳號已不在現任幹部名單。');
  if (kind === 'post' && record) need(record.stage !== 'published', '已發布紀錄保留原始證據，請另開新版文案。');
  const approved = post => need(post.approvedVersion === post.copyVersion, '請先確認目前這一版文案。');
  const eventType = value => { const type = value === undefined ? 'lecture' : value; need(Object.hasOwn(EVENT_TYPES, type), '活動類型請選擇講座／社課或一般活動。'); return type; };
  const taskStatus = value => ({ unassigned: 'todo', accepted: 'todo', blocked: 'doing', delivered: 'done' })[value] || value || 'todo';
  const importTaskStatus = value => ({ unassigned: 'todo', accepted: 'todo', blocked: 'doing', delivered: 'doing', '待辦': 'todo', '待開始': 'todo', '進行中': 'doing', '完成': 'done', '已完成': 'done' })[value] || value || 'todo';
  const validatePeople = fields => {
    for (const key of ['ownerPersonId', 'reviewerPersonId', 'adviserPersonId']) if (fields[key]) {
      const person = personById(state.people, fields[key]); need(person && !isInactivePerson(person), '請選擇目前在任的幹部。');
    }
  };
  const taskSnapshot = (task, name) => {
    const { deliveryHistory, ...saved } = clone(task);
    task.deliveryHistory ||= []; task.deliveryHistory.push({ ...saved, id: uuid(), action: name, actorEmail: actor.email, createdAt: now, taskVersion: task.version });
  };
  const completion = item => {
    if (item.status === 'done') Object.assign(item, { completedAt: now, completedBy: actor.email, completionMode: 'member_recorded' });
    else for (const key of ['completedAt', 'completedBy', 'completionMode']) delete item[key];
  };
  const addJob = post => {
    const existing = state.jobs.find(j => j.postId === post.id && j.copyVersion === post.copyVersion && j.type === 'canva' && j.status !== 'obsolete');
    if (!existing) state.jobs.push({ id: uuid(), version: 1, postId: post.id, copyVersion: post.copyVersion, type: 'canva', status: 'blocked_configuration', attempts: 0, lastError: '展示模式沒有外部 Canva 連線，沒有建立設計。', createdAt: now, updatedAt: now });
    post.stage = 'design_pending';
  };
  if (action.startsWith('people.')) {
    need(isAdviser(actor), '請由管理顧問確認人員對照。');
    const fields = ['personId', 'name', 'email', 'title', 'group', 'lineName', 'term', 'status', 'sourceUrl', 'sourceRevision', 'contactSourceUrl'];
    need(Array.isArray(payload.people) && payload.people.length > 0 && payload.people.length <= 200, '每次更新 1–200 人。');
    const ids = new Set();
    const people = payload.people.map(row => {
      need(row.personId?.trim() && row.name?.trim(), '每人需要姓名與固定幹部 ID。'); need(!ids.has(row.personId), '幹部 ID 不能重複。'); ids.add(row.personId);
      need(Object.keys(row).every(key => fields.includes(key)), '名單只接受人員欄位；不接受權限設定。');
      const existing = personById(state.people, row.personId) || {};
      return { status: 'pending', ...existing, ...row };
    });
    const previewToken = JSON.stringify({ current: state.people, people });
    const changes = people.map(person => { const before = personById(state.people, person.personId); const changedFields = fields.filter(field => field !== 'personId' && (before?.[field] || '') !== (person[field] || '')); return { personId: person.personId, name: person.name, change: !before ? 'create' : changedFields.length ? 'update' : 'unchanged', changedFields }; });
    if (action === 'people.import-preview') return { state: current, result: { ok: true, record: { people, changes, previewToken, warnings: ['展示模式只更新此瀏覽器的虛構人員對照。'] } } };
    need(action === 'people.import-apply' && payload.previewToken === previewToken, '名單已更新，請重新預覽差異。');
    for (const person of people) { const index = state.people.findIndex(item => item.personId === person.personId); if (index < 0) state.people.push(person); else state.people[index] = person; }
    record = { id: 'people', version: 1, title: `${people.length} 筆人員對照更新` };
  } else if (action.startsWith('import.')) {
    const rows = [...(payload.events || []), ...(payload.posts || []), ...(payload.tasks || [])];
    need(rows.length > 0 && rows.length <= 200, '每次匯入 1–200 筆資料。');
    rows.forEach(row => need(row.title?.trim(), '每筆資料都需要標題。'));
    for (const event of payload.events || []) eventType(event.eventType);
    for (const task of payload.tasks || []) need(['todo', 'doing', 'done', 'cancelled'].includes(importTaskStatus(task.status)), '任務狀態不正確。');
    rows.forEach(validatePeople);
    for (const post of payload.posts || []) need(state.events.some(event => event.id === post.eventId || post.eventSourceKey && event.sourceKey === post.eventSourceKey) || (payload.events || []).some(event => post.eventSourceKey && event.sourceKey === post.eventSourceKey), '每則宣傳需要有效的活動 ID 或活動來源鍵。');
    if (action === 'import.preview') return { state: current, result: { ok: true, record: { eventCount: (payload.events || []).length, postCount: (payload.posts || []).length, taskCount: (payload.tasks || []).length, message: '格式可匯入；活動與宣傳將以待確認草稿建立。' } } };
    need(isAdviser(actor), '請切換管理顧問示範身分後確認匯入。');
    for (const entity of ['events', 'posts', 'tasks']) for (const row of payload[entity] || []) {
      const sourceKey = row.sourceKey || `${row.sourceUrl || row.sourceLabel || 'manual'}:${row.title}:${row.date || row.dueDate || ''}:${row.eventId || row.eventSourceKey || ''}:${row.channel || ''}`;
      if (state[entity].some(item => item.sourceKey === sourceKey)) continue;
      const event = entity === 'posts' ? state.events.find(item => item.id === row.eventId || row.eventSourceKey && item.sourceKey === row.eventSourceKey) : null;
      state[entity].push({ ...row, id: uuid(), version: 1, createdAt: now, updatedAt: now, sourceKey, ownerEmail: row.ownerEmail || '', ownerPersonId: row.ownerPersonId || '', createdByEmail: actor.email, ...(entity === 'events' ? { eventType: eventType(row.eventType), status: 'todo', confirmationStatus: 'draft' } : entity === 'posts' ? { eventId: event.id, projectId: event.projectId, stage: 'brief', copyVersion: 1, sourceEventVersion: event.version, caption: row.caption || '', slides: row.slides || [], channel: row.channel || 'instagram' } : { status: importTaskStatus(row.status), reviewerPersonId: row.reviewerPersonId || '', ...(importTaskStatus(row.status) === 'done' ? {completionMode:'imported_status'} : {}), dependsOn: row.dependsOn || [], requiredForCompletion: row.requiredForCompletion ?? false }) });
    }
    record = { id: 'import', version: 1, title: `${rows.length} 筆匯入資料` };
  } else if (action.endsWith('.create')) {
    need(payload.title?.trim(), '請填寫標題。');
    validatePeople(payload);
    record = { ...payload, id: uuid(), version: 1, createdAt: now, updatedAt: now, ownerEmail: payload.ownerEmail || '', createdByEmail: actor.email };
    if (kind === 'event') { record.eventType = eventType(record.eventType); record.status = 'todo'; record.confirmationStatus = 'draft'; }
    if (kind === 'task') { record.status = taskStatus(record.status); need(['todo','doing','done','cancelled'].includes(record.status), '任務狀態不正確。'); record.dependsOn ||= []; record.requiredForCompletion ??= false; completion(record); }
    if (kind === 'post') { need(state.events.some(e => e.id === record.eventId), '請先選擇一個活動。'); Object.assign(record, { caption: payload.caption || '', slides: payload.slides || [], stage: payload.caption ? 'draft' : 'brief', copyVersion: 1, sourceEventVersion: state.events.find(e => e.id === record.eventId)?.version }); }
    state[collection].push(record);
  } else if (action.endsWith('.update')) {
    if (!['task', 'event', 'post'].includes(kind)) owner();
    validatePeople(payload);
    if (kind === 'event' && payload.eventType !== undefined) eventType(payload.eventType);
    if (kind === 'post') { need(record.stage !== 'published', '已發布文案需另開修訂需求，保留原發布證據。'); invalidate(record); }
    if (kind === 'event' || kind === 'obligation') state.posts.filter(post => kind === 'event' ? post.eventId === record.id : (record.eventId ? post.eventId === record.eventId : post.projectId === record.projectId)).forEach(invalidate);
    if (kind === 'task') {
      taskSnapshot(record, 'task.before-update');
      if (payload.status !== undefined) { payload.status = taskStatus(payload.status); need(['todo','doing','done','cancelled'].includes(payload.status), '任務狀態不正確。'); }
      const proposed = state.tasks.map(t => t.id === id ? { ...t, ...payload } : t);
      const check = (taskId, path = []) => { need(!path.includes(taskId), '任務不能形成循環依賴。'); const task = proposed.find(t => t.id === taskId); need(!!task, '找不到相依任務。'); for (const dependency of [...(task.dependsOn || []), ...(task.parentId ? [task.parentId] : [])]) check(dependency, [...path, taskId]); };
      check(id);
      if (payload.deliverableUrl) need(/^https:\/\//.test(payload.deliverableUrl), '成果連結需使用 https。');
    }
    Object.assign(record, payload);
    if (kind === 'task' && payload.status !== undefined) completion(record);
    if (kind === 'event') record.confirmationStatus = ['confirmed', 'reviewed'].includes(record.confirmationStatus) ? 'changed' : 'draft';
    if (kind === 'post') record.stage = 'draft';
    touch(record);
    if (kind === 'task') taskSnapshot(record, action);
  } else if (action === 'task.comment' || action === 'task.add-link') {
    if (action === 'task.comment') {
      need(typeof payload.text === 'string' && payload.text.trim() && payload.text.length <= 2000,'請填寫 2000 字以內的留言。');
      need(!payload.attachmentUrl || /^https:\/\//.test(payload.attachmentUrl),'補充連結需使用 https。');
      record.comments ||= []; record.comments.push({id:uuid(),text:payload.text.trim(),attachmentUrl:payload.attachmentUrl || '',actorEmail:actor.email,createdAt:now});
    } else {
      need(payload.title?.trim() && /^https:\/\//.test(payload.url || ''),'請填寫文件名稱與有效 https 連結。');
      record.links ||= []; need(!record.links.some(link => link.url === payload.url),'這個連結已經存在。');
      record.links.push({id:uuid(),title:payload.title.trim(),url:payload.url,actorEmail:actor.email,createdAt:now});
    }
    touch(record);
  } else if (['task.set-status', 'task.deliver', 'task.submit', 'task.accept-delivery', 'task.return-delivery', 'task.reopen'].includes(action)) {
    const status = action === 'task.set-status' ? payload.status : ['task.deliver', 'task.submit', 'task.accept-delivery'].includes(action) ? 'done' : 'todo';
    need(['todo', 'doing', 'done'].includes(status), '任務進度請選擇待辦、進行中或完成。');
    if (payload.deliverableUrl) need(/^https:\/\//.test(payload.deliverableUrl), '成果連結需使用 https。');
    taskSnapshot(record, 'task.before-status-change'); record.status = status;
    for (const key of ['deliveredAt', 'deliveredBy', 'acceptedAt', 'acceptedBy', 'acceptedReviewerPersonId', 'reviewIdentityMode', 'reviewEvidenceUrl', 'reviewComment']) delete record[key];
    if (payload.deliverableUrl !== undefined) record.deliverableUrl = payload.deliverableUrl;
    completion(record); touch(record); taskSnapshot(record, action);
  } else if (action === 'event.set-status') {
    need(['todo', 'doing', 'done'].includes(payload.status), '活動進度請選擇待辦、進行中或完成。');
    record.progressHistory ||= []; record.progressHistory.push({ status: record.status || 'todo', completedAt: record.completedAt || '', completedBy: record.completedBy || '', actorEmail: actor.email, createdAt: now });
    record.status = payload.status; completion(record); touch(record);
  } else if (action === 'post.restore-version') {
    need(record.stage !== 'published', '已發布紀錄不能直接還原。'); const saved = record.history?.find(version => version.id === payload.historyId); need(saved, '找不到已保存版本。'); invalidate(record); for (const key of ['title', 'purpose', 'audience', 'highlights', 'cta', 'channel', 'caption', 'slides']) record[key] = clone(saved[key] ?? (key === 'slides' ? [] : '')); record.stage = 'draft';
  } else if (action === 'event.confirm') {
    record.confirmationStatus = eventMissingFacts(record).length ? 'reviewed' : 'confirmed'; record.reviewedAt = now; record.reviewedBy = actor.email; touch(record); state.posts.filter(post => post.eventId === record.id).forEach(invalidate);
  } else if (action === 'post.generate') {
    need(['brief', 'draft', 'needs_revision'].includes(record.stage), '請先撤回文案確認，再產生新版草稿。');
    const event = state.events.find(e => e.id === record.eventId); invalidate(record);
    const speaker = eventSpeakerText(event);
    record.caption = `${event.title}\n\n${record.highlights || event.highlights || '請補上活動重點。'}\n\n日期｜${event.date || '待確認'} ${event.time || ''}\n地點｜${event.venue || '待確認'}${speaker ? `\n講者／帶領者｜${speaker}` : ''}\n\n${record.cta || '查看活動資訊'}\n${event.registrationUrl || '報名連結待補'}`;
    record.slides = [{ heading: event.title, body: record.purpose || '活動介紹' }, { heading: '這次會帶走什麼', body: record.highlights || event.highlights || '請補上重點' }, { heading: '一起參與', body: `${event.date || '日期待確認'}｜${event.venue || '地點待確認'}\n${record.cta || '查看活動資訊'}` }];
    record.generationMethod = 'demo_rules'; record.stage = 'draft'; record.sourceEventVersion = event.version;
  } else if (['post.confirm', 'post.submit', 'post.unit-review', 'post.approve'].includes(action)) {
    need(record.caption?.trim(), '請先填寫文案，再確認這一版內容。');
    if (action === 'post.confirm' && record.approvedVersion === record.copyVersion) return { state: current, result: { ok: true, record } };
    Object.assign(record, { approvedVersion: record.copyVersion, approvedBy: actor.email, approvedAt: now, sourceEventVersion: state.events.find(event => event.id === record.eventId)?.version, stage: 'approved' });
    if (action === 'post.unit-review') record.unitReviewedVersion = record.copyVersion;
    if (action === 'post.approve') addJob(record);
    touch(record);
  } else if (['post.unconfirm', 'post.reject'].includes(action)) {
    invalidate(record); record.rejectionReason = payload.reason || '';
  } else if (action === 'post.request-design') {
    approved(record); delete record.completedAt; delete record.completedBy; addJob(record); touch(record);
  } else if (action === 'post.attach-design') {
    let url; try { url = new URL(payload.canvaEditUrl); } catch { /* validated below */ }
    need(url?.protocol === 'https:' && !url.username && !url.password && url.pathname !== '/' && (url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com')), '請輸入有效的 https Canva 設計連結。');
    Object.assign(record, { canvaEditUrl: url.href, canvaDesignId: payload.canvaDesignId || '', designCopyVersion: record.copyVersion, stage: record.stage === 'completed' ? 'completed' : record.approvedVersion === record.copyVersion ? 'approved' : 'draft' }); touch(record);
    for (const job of state.jobs.filter(job => job.postId === record.id && job.copyVersion === record.copyVersion && job.type === 'canva' && !['obsolete', 'succeeded'].includes(job.status))) { job.status = 'succeeded'; job.lastError = ''; job.result = { manual: true, canvaEditUrl: url.href }; touch(job); }
  } else if (action === 'post.design-review') {
    record.designApprovedBy = actor.email; record.designApprovedAt = now; if (record.stage !== 'completed') record.stage = record.approvedVersion === record.copyVersion ? 'approved' : 'draft'; touch(record);
  } else if (action === 'post.sponsor-review') {
    if (payload.evidenceUrl) need(/^https:\/\//.test(payload.evidenceUrl), '證據連結需使用 https。');
    if (payload.confirmed) { record.sponsorApprovedVersion = record.copyVersion; record.sponsorEvidenceUrl = payload.evidenceUrl || ''; }
    if (record.stage !== 'completed') record.stage = record.approvedVersion === record.copyVersion ? 'approved' : 'draft'; touch(record);
  } else if (['post.complete', 'post.publish'].includes(action)) {
    approved(record);
    if (payload.canvaEditUrl) {
      let url; try { url = new URL(payload.canvaEditUrl); } catch { /* validated below */ }
      need(url?.protocol === 'https:' && !url.username && !url.password && url.pathname !== '/' && (url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com')), '請輸入有效的 https Canva 設計連結。');
      Object.assign(record, { canvaEditUrl: url.href, canvaDesignId: payload.canvaDesignId || '', designCopyVersion: record.copyVersion });
    }
    if (payload.publishedUrl) need(/^https:\/\//.test(payload.publishedUrl), '發布連結需使用 https。');
    if (payload.publishedAt) need(!Number.isNaN(Date.parse(payload.publishedAt)) && Date.parse(payload.publishedAt) <= Date.parse(now) + 60000, '發布時間不可使用未來時間。');
    const published = action === 'post.publish' || !!payload.publishedUrl;
    Object.assign(record, { stage: published ? 'published' : 'completed', completedAt: now, completedBy: actor.email });
    if (published) Object.assign(record, { publishedUrl: payload.publishedUrl || '', publishedAt: payload.publishedAt || now });
    state.jobs.filter(job => job.postId === record.id && !['succeeded', 'obsolete'].includes(job.status)).forEach(job => { job.status = 'obsolete'; touch(job); });
    touch(record);
  } else if (action === 'job.retry' || action === 'jobs.run') {
    need(isAdviser(actor), '請由管理顧問處理工作。');
    if (record) need(record.status !== 'needs_reconciliation', '先核對外部結果，不能直接重試。');
    for (const job of record ? [record] : state.jobs.filter(j => !['succeeded', 'obsolete', 'needs_reconciliation'].includes(j.status))) { job.status = 'blocked_configuration'; job.lastError = '展示模式不會呼叫外部服務。'; touch(job); }
    record ||= { id: 'jobs', version: 1, title: '展示模式工作檢查' };
  } else throw new Error('此展示操作尚未支援。');
  if (kind === 'post' && record) saveHistory(record);
  state.audit.unshift({ id: uuid(), action, actorEmail: actor.email, entityId: record.id, fromVersion: expectedVersion || null, toVersion: record.version, createdAt: now, summary: record.title || action });
  saveDemo(state);
  return { state, result: { ok: true, record } };
}
