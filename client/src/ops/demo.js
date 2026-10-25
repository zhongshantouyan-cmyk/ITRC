import { canOwn, isAdviser } from './model.js';

const KEY = 'itrc-ops-fictional-demo-v1';
const uuid = () => globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = data => JSON.parse(JSON.stringify(data));
export const DEMO_ACTORS = [
  { email: 'activity@example.invalid', name: '活動負責人（示範）', role: 'officer', canApprove: false, canDesign: false },
  { email: 'approver@example.invalid', name: '最終審核者（示範）', role: 'chair', canApprove: true, canDesign: false },
  { email: 'design@example.invalid', name: '行銷負責人（示範）', role: 'officer', canApprove: false, canDesign: true },
  { email: 'adviser@example.invalid', name: '管理顧問（示範）', role: 'advisor', canApprove: false, canDesign: false },
];
function seeded() {
  const now = new Date().toISOString();
  const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };
  const base = { version: 1, createdAt: now, updatedAt: now };
  return {
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
  };
}
export function loadDemo() {
  try { const state = JSON.parse(localStorage.getItem(KEY)); if (state?.schemaVersion === 1 && Array.isArray(state.posts)) return state; } catch { /* corrupt / inaccessible browser storage falls back visibly */ }
  const state = seeded(); saveDemo(state); return state;
}
export function saveDemo(state) { localStorage.setItem(KEY, JSON.stringify(state)); }
export function resetDemo() { const state = seeded(); saveDemo(state); return state; }
export function changeDemoActor(state, email) { const next = { ...state, actor: DEMO_ACTORS.find(a => a.email === email) || DEMO_ACTORS[0] }; saveDemo(next); return next; }

export function performDemoAction(current, command) {
  const state = clone(current); const { action, id, expectedVersion, payload = {} } = command;
  const actor = state.actor; const now = new Date().toISOString();
  const kind = action.split('.')[0]; const collection = { project: 'projects', event: 'events', post: 'posts', task: 'tasks', obligation: 'obligations', job: 'jobs' }[kind];
  let record = collection && state[collection].find(item => item.id === id);
  if (id && !record) throw new Error('找不到這筆示範紀錄，請重新整理。');
  if (record && expectedVersion !== record.version) throw new Error('這筆資料已有新版本，請重新整理再操作。');
  const need = (ok, message) => { if (!ok) throw new Error(message); };
  const owner = () => need(canOwn(actor, record, state.projects), '請由負責人或管理顧問操作。');
  const touch = item => { item.version = (item.version || 0) + 1; item.updatedAt = now; };
  const invalidate = post => {
    if (post.stage === 'published') {
      state.tasks.push({ id: uuid(), version: 1, createdAt: now, updatedAt: now, title: `核對已發布資訊：${post.title}`, projectId: post.projectId, eventId: post.eventId, postId: post.id, ownerEmail: post.ownerEmail, status: 'todo', dependsOn: [], acceptanceCriteria: '核對已發布內容與最新資料，留下更正紀錄。' }); return;
    }
    if (post.canvaEditUrl) post.previousDesigns = [...(post.previousDesigns || []), { copyVersion: post.designCopyVersion, canvaEditUrl: post.canvaEditUrl, canvaDesignId: post.canvaDesignId || '' }];
    post.copyVersion += 1; post.stage = 'needs_revision'; post.unitReviewedVersion = null; post.approvedVersion = null; post.approvedBy = null; post.approvedAt = null; post.designCopyVersion = null; post.designApprovedBy = null; post.sponsorApprovedVersion = null;
    delete post.canvaEditUrl; delete post.canvaDesignId;
    post.sourceEventVersion = state.events.find(event => event.id === post.eventId)?.version || 0;
    state.jobs.filter(j => j.postId === post.id && !['succeeded', 'obsolete'].includes(j.status)).forEach(j => { j.status = 'obsolete'; touch(j); });
    touch(post);
  };
  const confirmed = post => need(state.events.find(e => e.id === post.eventId)?.confirmationStatus === 'confirmed', '先確認活動日期、講者與地點，再繼續送審。');
  const approved = post => need(post.approvedVersion === post.copyVersion, '這一版文案尚未通過終審。');
  const addJob = post => {
    const existing = state.jobs.find(j => j.postId === post.id && j.copyVersion === post.copyVersion && j.type === 'canva' && j.status !== 'obsolete');
    if (!existing) state.jobs.push({ id: uuid(), version: 1, postId: post.id, copyVersion: post.copyVersion, type: 'canva', status: 'blocked_configuration', attempts: 0, lastError: '展示模式沒有外部 Canva 連線，沒有建立設計。', createdAt: now, updatedAt: now });
    post.stage = 'design_pending';
  };
  if (action.startsWith('import.')) {
    const rows = [...(payload.events || []), ...(payload.posts || []), ...(payload.tasks || [])];
    need(rows.length > 0 && rows.length <= 200, '每次匯入 1–200 筆資料。');
    rows.forEach(row => need(row.title?.trim(), '每筆資料都需要標題。'));
    for (const post of payload.posts || []) need(state.events.some(event => event.id === post.eventId || post.eventSourceKey && event.sourceKey === post.eventSourceKey) || (payload.events || []).some(event => post.eventSourceKey && event.sourceKey === post.eventSourceKey), '每則宣傳需要有效的活動 ID 或活動來源鍵。');
    if (action === 'import.preview') return { state: current, result: { ok: true, record: { eventCount: (payload.events || []).length, postCount: (payload.posts || []).length, taskCount: (payload.tasks || []).length, message: '格式可匯入；活動與宣傳將以待確認草稿建立。' } } };
    need(isAdviser(actor), '請切換管理顧問示範身分後確認匯入。');
    for (const entity of ['events', 'posts', 'tasks']) for (const row of payload[entity] || []) {
      const sourceKey = row.sourceKey || `${row.sourceUrl || row.sourceLabel || 'manual'}:${row.title}:${row.date || row.dueDate || ''}:${row.eventId || row.eventSourceKey || ''}:${row.channel || ''}`;
      if (state[entity].some(item => item.sourceKey === sourceKey)) continue;
      const event = entity === 'posts' ? state.events.find(item => item.id === row.eventId || row.eventSourceKey && item.sourceKey === row.eventSourceKey) : null;
      state[entity].push({ ...row, id: uuid(), version: 1, createdAt: now, updatedAt: now, sourceKey, ownerEmail: row.ownerEmail || actor.email, ...(entity === 'events' ? { confirmationStatus: 'draft' } : entity === 'posts' ? { eventId: event.id, projectId: event.projectId, stage: 'brief', copyVersion: 1, sourceEventVersion: event.version, caption: row.caption || '', slides: row.slides || [], channel: row.channel || 'instagram' } : { status: 'todo', dependsOn: [] }) });
    }
    record = { id: 'import', version: 1, title: `${rows.length} 筆匯入資料` };
  } else if (action.endsWith('.create')) {
    need(payload.title?.trim(), '請填寫標題。');
    record = { ...payload, id: uuid(), version: 1, createdAt: now, updatedAt: now, ownerEmail: payload.ownerEmail || actor.email };
    if (kind === 'event') record.confirmationStatus = 'draft';
    if (kind === 'task') { record.status ||= 'todo'; record.dependsOn ||= []; }
    if (kind === 'post') { need(state.events.some(e => e.id === record.eventId), '請先選擇一個活動。'); Object.assign(record, { caption: payload.caption || '', slides: payload.slides || [], stage: payload.caption ? 'draft' : 'brief', copyVersion: 1, sourceEventVersion: state.events.find(e => e.id === record.eventId)?.version }); }
    state[collection].push(record);
  } else if (action.endsWith('.update')) {
    owner();
    if (kind === 'post') { need(record.stage !== 'published', '已發布文案需另開修訂需求，保留原發布證據。'); invalidate(record); }
    if (kind === 'event' || kind === 'obligation') state.posts.filter(post => kind === 'event' ? post.eventId === record.id : (record.eventId ? post.eventId === record.eventId : post.projectId === record.projectId)).forEach(invalidate);
    if (kind === 'task') {
      const proposed = state.tasks.map(t => t.id === id ? { ...t, ...payload } : t);
      const check = (taskId, path = []) => { need(!path.includes(taskId), '任務不能形成循環依賴。'); const task = proposed.find(t => t.id === taskId); need(!!task, '找不到相依任務。'); for (const dependency of [...(task.dependsOn || []), ...(task.parentId ? [task.parentId] : [])]) check(dependency, [...path, taskId]); };
      check(id);
      const status = payload.status || record.status;
      if (['doing', 'delivered', 'done'].includes(status)) need((payload.dependsOn || record.dependsOn || []).every(dependency => state.tasks.find(t => t.id === dependency)?.status === 'done'), '前置任務尚未完成。');
      if (['delivered', 'done'].includes(status)) need(/^https:\/\//.test(payload.deliverableUrl || record.deliverableUrl || ''), '交件與完成需要有效的 https 成果連結。');
      if (status === 'blocked') need(payload.blocker || record.blocker, '請填寫卡點。');
    }
    Object.assign(record, payload);
    if (kind === 'event') record.confirmationStatus = record.confirmationStatus === 'confirmed' ? 'changed' : 'draft';
    if (kind === 'post') record.stage = 'draft';
    touch(record);
  } else if (action === 'event.confirm') {
    owner(); need(record.date && record.speaker && record.venue, '需要日期、講者與地點才能確認。'); record.confirmationStatus = 'confirmed'; touch(record); state.posts.filter(post => post.eventId === record.id).forEach(invalidate);
  } else if (action === 'post.generate') {
    owner(); need(!['published', 'ready'].includes(record.stage), '請先退回修訂再產生草稿。');
    const event = state.events.find(e => e.id === record.eventId); invalidate(record);
    record.caption = `${event.title}\n\n${record.highlights || event.highlights || '請補上活動重點。'}\n\n日期｜${event.date || '待確認'} ${event.time || ''}\n地點｜${event.venue || '待確認'}\n講者｜${event.speaker || '待確認'}\n\n${record.cta || '查看活動資訊'}\n${event.registrationUrl || '報名連結待補'}`;
    record.slides = [{ heading: event.title, body: record.purpose || '活動介紹' }, { heading: '這次會帶走什麼', body: record.highlights || event.highlights || '請補上重點' }, { heading: '一起參與', body: `${event.date || '日期待確認'}｜${event.venue || '地點待確認'}\n${record.cta || '查看活動資訊'}` }];
    record.generationMethod = 'demo_rules'; record.stage = 'draft'; record.sourceEventVersion = event.version;
  } else if (action === 'post.submit') {
    owner(); confirmed(record); need(record.caption?.trim() && record.slides?.length, '請先填寫文案與輪播文字。'); need(['draft', 'needs_revision'].includes(record.stage), '目前不在可送審階段。'); record.stage = 'unit_review'; touch(record);
  } else if (action === 'post.unit-review') {
    need(canOwn(actor, record, state.projects) || canOwn(actor, state.events.find(event => event.id === record.eventId), state.projects), '請由活動負責人或顧問確認。'); confirmed(record); need(record.stage === 'unit_review', '目前不在單位確認階段。'); record.unitReviewedVersion = record.copyVersion; record.stage = 'approval'; touch(record);
  } else if (action === 'post.approve') {
    need(actor.canApprove, '請切換最終審核者示範身分。'); confirmed(record); need(record.stage === 'approval' && record.unitReviewedVersion === record.copyVersion, '需要當前版本的單位確認。'); Object.assign(record, { approvedVersion: record.copyVersion, approvedBy: actor.email, approvedAt: now }); addJob(record); touch(record);
  } else if (action === 'post.reject') {
    need(canOwn(actor, record, state.projects) || actor.canApprove || actor.canDesign, '目前身分不能退回這筆文案。'); need(payload.reason?.trim(), '請填寫退回原因。'); need(record.stage !== 'published', '已發布紀錄需另開修正任務。'); invalidate(record); record.rejectionReason = payload.reason;
  } else if (action === 'post.request-design') {
    approved(record); addJob(record); touch(record);
  } else if (action === 'post.attach-design') {
    need(actor.canDesign || isAdviser(actor), '請由行銷負責人或管理顧問登錄。'); approved(record);
    let url; try { url = new URL(payload.canvaEditUrl); } catch { /* validated below */ }
    need(url?.protocol === 'https:' && (url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com')), '請輸入有效的 https Canva 設計連結。');
    Object.assign(record, { canvaEditUrl: url.href, canvaDesignId: payload.canvaDesignId || '', designCopyVersion: record.copyVersion, stage: 'design_review' }); touch(record);
    for (const job of state.jobs.filter(job => job.postId === record.id && job.copyVersion === record.copyVersion && job.type === 'canva' && !['obsolete', 'succeeded'].includes(job.status))) { job.status = 'succeeded'; job.lastError = ''; job.result = { manual: true, canvaEditUrl: url.href }; touch(job); }
  } else if (action === 'post.design-review') {
    need(actor.canDesign || isAdviser(actor), '請由行銷負責人或管理顧問校對。'); approved(record); need(record.designCopyVersion === record.copyVersion && record.stage === 'design_review', '請先登錄當前版本的設計。'); record.designApprovedBy = actor.email; record.stage = state.obligations.some(o => (o.eventId === record.eventId || (!o.eventId && o.projectId === record.projectId)) && o.requiresSponsorReview && o.status !== 'cancelled') ? 'sponsor_review' : 'ready'; touch(record);
  } else if (action === 'post.sponsor-review') {
    need(actor.canDesign || canOwn(actor, record, state.projects) || canOwn(actor, state.events.find(event => event.id === record.eventId), state.projects), '請由負責人或行銷人員記錄。'); need(record.stage === 'sponsor_review' && payload.confirmed && /^https:\/\//.test(payload.evidenceUrl || ''), '需要確認勾選與 https 證據連結。'); record.sponsorApprovedVersion = record.copyVersion; record.sponsorEvidenceUrl = payload.evidenceUrl; record.stage = 'ready'; touch(record);
  } else if (action === 'post.publish') {
    need(actor.canDesign || canOwn(actor, record, state.projects), '請由發布負責人登錄。'); approved(record); need(record.stage === 'ready' && /^https:\/\//.test(payload.publishedUrl || ''), '需要通過設計校對與有效的 https 發布連結。'); Object.assign(record, { publishedUrl: payload.publishedUrl, publishedAt: payload.publishedAt || now, stage: 'published' }); touch(record);
  } else if (action === 'job.retry' || action === 'jobs.run') {
    need(isAdviser(actor), '請由管理顧問處理工作。');
    if (record) need(record.status !== 'needs_reconciliation', '先核對外部結果，不能直接重試。');
    for (const job of record ? [record] : state.jobs.filter(j => !['succeeded', 'obsolete', 'needs_reconciliation'].includes(j.status))) { job.status = 'blocked_configuration'; job.lastError = '展示模式不會呼叫外部服務。'; touch(job); }
    record ||= { id: 'jobs', version: 1, title: '展示模式工作檢查' };
  } else throw new Error('此展示操作尚未支援。');
  state.audit.unshift({ id: uuid(), action, actorEmail: actor.email, entityId: record.id, fromVersion: expectedVersion || null, toVersion: record.version, createdAt: now, summary: record.title || action });
  saveDemo(state);
  return { state, result: { ok: true, record } };
}
