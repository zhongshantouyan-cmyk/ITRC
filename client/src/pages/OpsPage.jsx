import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { opsApi as api } from '../api';
import { ACTION_LABELS, CHANNELS, EVENT_STATES, JOB_STATES, STAGES, TABS, TASK_STATES, canOwn, dateText, exportPostsCsv, isAdviser, nextStep, parseImportText, safeLink } from '../ops/model';
import { changeDemoActor, DEMO_ACTORS, loadDemo, performDemoAction, resetDemo } from '../ops/demo';
import { PERSON_STATES, actorPerson, assignmentFormValue, assignmentOptions, assignmentPayload, canReviewTask, hasAssignee, matchesPerson, ownerLabel, personById, personLabel, personOptions, projectPendingTasks, taskDeliveryReason } from '../ops/people';
import './ops.css';

const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const noop = () => {};
const collectionFor = kind => ({ project: 'projects', event: 'events', post: 'posts', task: 'tasks', obligation: 'obligations' })[kind];
const titleFor = kind => ({ project: '專案', event: '活動', post: '宣傳需求', task: '任務', obligation: '交付要求' })[kind];
const values = map => Object.entries(map).map(([value, label]) => ({ value, label }));
const records = list => list.map(item => ({ value: item.id, label: item.title }));
const initialCollections = { projects: [], events: [], posts: [], tasks: [], obligations: [], jobs: [], audit: [], people: [] };
const normalize = state => ({ ...initialCollections, ...state, settings: state.settings || { integrations: {} } });
const humanError = error => {
  const body = error.response?.data;
  const message = typeof body?.error === 'string' ? body.error : body?.message || body?.error?.message || error.message;
  if (error.response?.status === 401) return '登入已失效，請重新登入後再試。尚未儲存的內容仍保留在表單中。';
  if (error.response?.status === 403) return message || '目前帳號沒有執行這個動作的權限。';
  if (error.response?.status === 409) return `${message || '這筆資料或流程已更新。'} 請重新整理，再核對要送出的版本。`;
  return message?.slice(0, 500) || '暫時無法連線。請稍後重試；系統沒有將這次操作標記為完成。';
};

function Badge({ value, type = 'post' }) {
  const mapped = type === 'post' ? STAGES[value] : type === 'task' ? [TASK_STATES[value], value === 'blocked' ? 'red' : value === 'done' ? 'green' : 'neutral'] : type === 'event' ? [EVENT_STATES[value], value === 'confirmed' ? 'green' : 'amber'] : [JOB_STATES[value] || value, ['failed', 'needs_reconciliation'].includes(value) ? 'red' : value === 'succeeded' ? 'green' : 'amber'];
  return <span className={`ops-badge ops-badge-${mapped?.[1] || 'neutral'}`}>{mapped?.[0] || value || '未設定'}</span>;
}
function ExternalLink({ href, children, className = '' }) {
  const target = safeLink(href);
  return target ? <a className={className} href={target} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span></a> : null;
}
function Empty({ title, detail, children }) {
  return <div className="ops-empty"><span className="ops-empty-mark" aria-hidden="true">＋</span><h3>{title}</h3><p>{detail}</p>{children}</div>;
}
function ActionButton({ children, reason, busy, onClick, tone = 'primary', ...rest }) {
  return <div className="ops-action"><button type="button" className={`ops-button ${tone}`} onClick={onClick} disabled={!!reason || busy} title={reason || undefined} {...rest}>{children}</button>{reason && <small className="ops-disabled-reason">{reason}</small>}</div>;
}
function Panel({ title, kicker, action, children, className = '' }) {
  return <section className={`ops-panel ${className}`}><div className="ops-panel-heading"><div>{kicker && <span className="ops-kicker">{kicker}</span>}<h2>{title}</h2></div>{action}</div>{children}</section>;
}

function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current; dialog.showModal();
    const onCancel = event => { event.preventDefault(); closeRef.current(); };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, []);
  return <dialog ref={ref} className={`ops-dialog ${wide ? 'wide' : ''}`} aria-labelledby="ops-dialog-title" onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="ops-dialog-heading"><div><span className="ops-kicker">ITRC WORKSPACE</span><h2 id="ops-dialog-title">{title}</h2></div><button className="ops-icon-button" type="button" aria-label="關閉對話框" onClick={onClose}>×</button></div>{children}
  </dialog>;
}
function Field({ field, value, onChange }) {
  const id = `ops-field-${field.key}`;
  return <div className={`ops-field ${field.wide ? 'wide' : ''}`}>
    <label htmlFor={id}>{field.label}{field.required && <span className="ops-required"> 必填</span>}</label>
    {field.type === 'textarea' ? <textarea id={id} rows={field.rows || 3} value={value || ''} required={field.required} maxLength={field.maxLength || 12000} onChange={event => onChange(event.target.value)} placeholder={field.placeholder} />
      : field.type === 'select' ? <select id={id} value={value || ''} required={field.required} onChange={event => onChange(event.target.value)}><option value="">{field.placeholder || '請選擇'}</option>{field.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        : field.type === 'multi' ? <select id={id} multiple size={Math.min(Math.max(field.options.length, 2), 5)} value={value || []} onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value))}>{field.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          : field.type === 'checkbox' ? <label className="ops-checkbox"><input id={id} type="checkbox" required={field.required} checked={!!value} onChange={event => onChange(event.target.checked)} />{field.checkboxLabel || '需要'}</label>
            : <input id={id} type={field.type || 'text'} value={value || ''} required={field.required} maxLength={field.maxLength || 2000} onChange={event => onChange(event.target.value)} placeholder={field.placeholder} />}
    {field.hint && <small>{field.hint}</small>}
  </div>;
}

function fieldsFor(kind, data, record) {
  const common = [{ key: 'title', label: `${titleFor(kind)}名稱`, required: true, wide: true }, { key: 'ownerPersonId', label: '實際承辦人', type: 'select', options: assignmentOptions(data.people, record), placeholder: '待指派', hint: data.people.length ? '依幹部主表選擇；職稱與姓名以官網為準。' : '尚未帶入幹部對照。可以先保留待指派，再到「系統連線」更新名單。' }];
  const projectField = { key: 'projectId', label: '所屬專案', type: 'select', options: records(data.projects) };
  const eventField = { key: 'eventId', label: '所屬活動', type: 'select', options: records(data.events) };
  if (kind === 'project') return [...common,
    { key: 'adviserPersonId', label: '協助確認的人員', type: 'select', options: personOptions(data.people, record?.adviserPersonId) }, { key: 'objective', label: '目標', type: 'textarea', wide: true },
    { key: 'dueDate', label: '完成期限', type: 'date' }, { key: 'status', label: '狀態', type: 'select', options: values({ planning: '規劃中', active: '執行中', on_hold: '暫停', ...(record ? { completed: '已結案', cancelled: '已取消' } : {}) }) },
    { key: 'completionCriteria', label: '結案標準', type: 'textarea', wide: true, placeholder: '什麼成果交出來，這個專案才算完成？' },
  ];
  if (kind === 'event') return [...common, projectField,
    { key: 'speaker', label: '講者／帶領者' }, { key: 'date', label: '活動日期', type: 'date' }, { key: 'time', label: '活動時間', placeholder: '例如：16:00–18:00', hint: '可填開始與結束時間，保留完整活動時段。' },
    { key: 'venue', label: '地點／線上會議' }, { key: 'audience', label: '參與對象' }, { key: 'fee', label: '費用說明' },
    { key: 'registrationUrl', label: '報名連結', type: 'url', placeholder: 'https://' }, { key: 'highlights', label: '活動內容與宣傳重點', type: 'textarea', wide: true },
    { key: 'sourceUrl', label: '原始資料連結', type: 'url' }, { key: 'sourceDate', label: '原資料確認日期', type: 'date' },
    { key: 'sourceRevision', label: '原資料版本', placeholder: '例如：活動組確認版 v1' },
  ];
  if (kind === 'task') return [...common, projectField, eventField,
    { key: 'postId', label: '關聯宣傳', type: 'select', options: records(data.posts) }, { key: 'dueDate', label: '截止日期', type: 'date' },
    { key: 'reviewerPersonId', label: '驗收人', type: 'select', options: personOptions(data.people, record?.reviewerPersonId), hint: '交件時需要不同於承辦人的驗收人。' },
    ...(!['delivered', 'done'].includes(record?.status) ? [{ key: 'status', label: '進度', type: 'select', options: values(Object.fromEntries(Object.entries(TASK_STATES).filter(([state]) => !['delivered', 'done', ...(!record ? ['cancelled'] : [])].includes(state)))), required: true }] : []),
    { key: 'requiredForCompletion', label: '專案結案', type: 'checkbox', checkboxLabel: '這項任務通過驗收後，專案才能結案' },
    { key: 'parentId', label: '上層任務', type: 'select', options: records(data.tasks.filter(task => task.id !== record?.id)) },
    { key: 'dependsOn', label: '前置任務', type: 'multi', options: records(data.tasks.filter(task => task.id !== record?.id)), wide: true, hint: '按住 Ctrl 或 ⌘ 可多選。完成前置任務後再驗收。' },
    { key: 'acceptanceCriteria', label: '驗收標準', type: 'textarea', wide: true, placeholder: '成果、格式、檢查方式' },
    { key: 'blocker', label: '目前卡點', type: 'textarea', wide: true }, { key: 'deliverableUrl', label: '交付成果連結', type: 'url', wide: true, placeholder: 'https://' },
  ];
  if (kind === 'obligation') return [...common, projectField, eventField,
    { key: 'channel', label: '適用管道', type: 'select', options: values(CHANNELS) },
    { key: 'requirements', label: '完整交付要求', type: 'textarea', wide: true, required: true, placeholder: '例如：Logo 位置、連結、需事前確認的內容、照片與結案資料。' },
    { key: 'requiresSponsorReview', label: '發布前確認', type: 'checkbox', checkboxLabel: '需要贊助方確認並留下證據' },
    { key: 'status', label: '狀態', type: 'select', options: values({ active: '適用中', completed: '已履約', cancelled: '已取消' }) },
    { key: 'sourceUrl', label: '要求來源連結', type: 'url' }, { key: 'evidenceUrl', label: '履約證據連結', type: 'url' },
  ];
  return [];
}

function RecordForm({ kind, record, defaults = {}, data, busy, onClose, onSubmit }) {
  const fields = fieldsFor(kind, data, record);
  const [form, setForm] = useState(() => ({ status: kind === 'project' || kind === 'obligation' ? 'active' : kind === 'task' ? 'unassigned' : 'todo', requiredForCompletion: true, dependsOn: [], ...defaults, ...record, ownerPersonId: assignmentFormValue(record || defaults) }));
  const [error, setError] = useState('');
  const editable = (!record || canOwn(data.actor, record, data.projects, data.people, data.tasks)) && !(kind === 'task' && record?.status === 'done');
  const save = async event => {
    event.preventDefault(); setError('');
    const payload = Object.fromEntries(fields.map(field => [field.key, form[field.key] ?? (field.type === 'multi' ? [] : field.type === 'checkbox' ? false : '')]));
    Object.assign(payload, assignmentPayload(form.ownerPersonId, record));
    if (kind === 'project') payload.adviserEmail = form.adviserPersonId ? '' : record?.adviserEmail || '';
    if (kind === 'task' && payload.ownerPersonId && payload.status === 'unassigned') payload.status = 'todo';
    if (kind === 'project' && payload.status === 'completed' && projectPendingTasks(record?.id, data.tasks).length) { setError('還有結案必要任務尚未通過驗收。請先完成交付，再結案。'); return; }
    try { await onSubmit(`${kind}.${record ? 'update' : 'create'}`, record, payload); onClose(); } catch (issue) { setError(humanError(issue)); }
  };
  return <Dialog title={`${record ? '編輯' : '新增'}${titleFor(kind)}`} onClose={busy ? noop : onClose} wide>
    <form onSubmit={save}><div className="ops-form-grid">{fields.map(field => <Field key={field.key} field={field} value={form[field.key]} onChange={value => setForm(old => ({ ...old, [field.key]: value }))} />)}</div>
      {kind === 'event' && record && <p className="ops-note">活動異動會讓相關未發布宣傳重新確認；已發布紀錄會保留，並建立更正任務。</p>}
      {!record?.ownerPersonId && record?.ownerEmail && <p className="ops-note">原指派紀錄：{record.ownerEmail}。選擇幹部後會改用固定人員對照；選「待指派」則清除這筆工作的原指派。</p>}
      {kind === 'task' && record?.status === 'delivered' && <p className="ops-note">成果正在等待驗收。修改任務資料後，需要重新交件。</p>}
      {kind === 'task' && record?.status === 'done' && <p className="ops-note">這項任務已通過驗收。若需修改，先在任務卡片選擇「重新開啟」，並留下原因。</p>}
      {kind === 'project' && record && projectPendingTasks(record.id, data.tasks).length > 0 && <p className="ops-note">結案前仍需驗收：{projectPendingTasks(record.id, data.tasks).map(task => task.title).join('、')}。</p>}
      {!editable && <p className="ops-note">目前可查看資料；變更由負責人或顧問儲存。</p>}
      {error && <p className="ops-inline-error" role="alert">{error}</p>}
      <div className="ops-dialog-actions"><button type="button" className="ops-button quiet" onClick={onClose} disabled={busy}>取消</button><button className="ops-button primary" disabled={busy || !editable}>{busy ? '儲存中…' : '儲存'}</button></div>
    </form>
  </Dialog>;
}

function PostForm({ record, defaults = {}, data, busy, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({ title: '', eventId: data.events[0]?.id || '', projectId: '', purpose: '', audience: '', highlights: '', cta: '', channel: 'instagram', scheduledAt: '', caption: '', slides: [], ...defaults, ...record, ownerPersonId: assignmentFormValue(record || defaults) }));
  const [error, setError] = useState('');
  const fields = [
    { key: 'title', label: '宣傳名稱', required: true, wide: true }, { key: 'eventId', label: '所屬活動', type: 'select', required: true, options: records(data.events) },
    { key: 'channel', label: '發布管道', type: 'select', required: true, options: values(CHANNELS) }, { key: 'ownerPersonId', label: '文案承辦人', type: 'select', options: assignmentOptions(data.people, record), placeholder: '待指派' },
    { key: 'scheduledAt', label: '預計發布時間', type: 'datetime-local', hint: '依填寫者裝置時區；尚未代表排程發布。' },
    { key: 'purpose', label: '這則宣傳的目的', type: 'textarea' }, { key: 'audience', label: '對誰說' },
    { key: 'highlights', label: '這則貼文的宣傳重點', type: 'textarea', wide: true }, { key: 'cta', label: '希望讀者採取的行動', wide: true },
    { key: 'caption', label: '正式貼文文案', type: 'textarea', rows: 8, wide: true, hint: '送審與設計綁定此版本；修改文案後須重新確認。' },
  ];
  const set = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const save = async event => {
    event.preventDefault(); setError('');
    const payload = Object.fromEntries(fields.map(field => [field.key, form[field.key] || '']));
    Object.assign(payload, assignmentPayload(form.ownerPersonId, record));
    payload.projectId = data.events.find(e => e.id === form.eventId)?.projectId || '';
    payload.slides = form.slides.map(slide => ({ heading: slide.heading || '', body: slide.body || '' }));
    if (payload.scheduledAt) payload.scheduledAt = new Date(payload.scheduledAt).toISOString();
    try { await onSubmit(`post.${record ? 'update' : 'create'}`, record, payload); onClose(); } catch (issue) { setError(humanError(issue)); }
  };
  return <Dialog title={record ? `編輯文案 · v${record.copyVersion}` : '新增宣傳需求'} onClose={busy ? noop : onClose} wide>
    <form onSubmit={save}><div className="ops-form-grid">{fields.map(field => <Field key={field.key} field={field} value={field.type === 'datetime-local' && form[field.key] ? localDateTime(form[field.key]) : form[field.key]} onChange={value => set(field.key, value)} />)}</div>
      <div className="ops-slide-editor"><div className="ops-section-heading"><h3>輪播各頁文字</h3><button type="button" className="ops-button quiet small" disabled={form.slides.length >= 10} onClick={() => set('slides', [...form.slides, { heading: '', body: '' }])}>＋ 新增頁面</button></div>
        <p className="ops-muted">每頁標題與內文分開，作為 Canva 可編輯文字圖層的資料。</p>
        {form.slides.map((slide, index) => <div className="ops-slide-edit" key={index}><div className="ops-slide-number">{String(index + 1).padStart(2, '0')}</div><div><label htmlFor={`slide-title-${index}`}>第 {index + 1} 頁標題</label><input id={`slide-title-${index}`} value={slide.heading} maxLength={200} onChange={e => set('slides', form.slides.map((s, i) => i === index ? { ...s, heading: e.target.value } : s))} /><label htmlFor={`slide-body-${index}`}>第 {index + 1} 頁內容</label><textarea id={`slide-body-${index}`} rows={3} value={slide.body} maxLength={2000} onChange={e => set('slides', form.slides.map((s, i) => i === index ? { ...s, body: e.target.value } : s))} /></div><button type="button" className="ops-icon-button" aria-label={`移除第 ${index + 1} 頁`} onClick={() => set('slides', form.slides.filter((_, i) => i !== index))}>×</button></div>)}
        {!form.slides.length && <p className="ops-note">可先建立需求，再用「產生草稿」整理貼文與各頁文字。</p>}
      </div>
      {error && <p className="ops-inline-error" role="alert">{error}</p>}
      <div className="ops-dialog-actions"><button type="button" className="ops-button quiet" onClick={onClose} disabled={busy}>取消</button><button className="ops-button primary" disabled={busy}>{busy ? '儲存中…' : record ? '儲存新版本' : '建立宣傳需求'}</button></div>
    </form>
  </Dialog>;
}
function localDateTime(value) {
  if (!value) return '';
  if (!value.endsWith('Z') && !/[+-]\d\d:\d\d$/.test(value)) return value.slice(0, 16);
  const date = new Date(value); if (Number.isNaN(date.valueOf())) return '';
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function ActionForm({ config, busy, onClose, onSubmit }) {
  const [form, setForm] = useState(config.defaults || {}); const [error, setError] = useState('');
  const save = async event => {
    event.preventDefault(); setError('');
    const payload = { ...form };
    if (config.action === 'post.publish' && payload.publishedAt) payload.publishedAt = new Date(payload.publishedAt).toISOString();
    try { await onSubmit(config.action, config.record, payload); onClose(); } catch (issue) { setError(humanError(issue)); }
  };
  return <Dialog title={config.title} onClose={busy ? noop : onClose}><form onSubmit={save}>{config.description && <p className="ops-note">{config.description}</p>}<div className="ops-form-grid one">{config.fields.map(field => <Field key={field.key} field={field} value={form[field.key]} onChange={value => setForm(old => ({ ...old, [field.key]: value }))} />)}</div>{error && <p className="ops-inline-error" role="alert">{error}</p>}<div className="ops-dialog-actions"><button className="ops-button quiet" type="button" disabled={busy} onClick={onClose}>取消</button><button className="ops-button primary" disabled={busy}>{busy ? '處理中…' : config.button || '確認記錄'}</button></div></form></Dialog>;
}

function Overview({ data, busy, go, openForm, openPost }) {
  const unfinished = data.tasks.filter(t => !['done', 'cancelled'].includes(t.status));
  const reviews = data.posts.filter(p => ['unit_review', 'approval', 'design_review', 'sponsor_review'].includes(p.stage));
  const blockedJobs = data.jobs.filter(j => ['blocked_configuration', 'failed', 'needs_reconciliation'].includes(j.status));
  const blocked = unfinished.filter(t => t.status === 'blocked');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const due = unfinished.filter(t => t.dueDate && t.dueDate.slice(0, 10) <= today);
  const currentPerson = actorPerson(data.actor, data.people);
  const myTasks = unfinished.filter(task => matchesPerson(task, currentPerson, data.actor.email)).slice(0, 5);
  const groups = [
    ['準備資料', ['brief', 'draft', 'needs_revision']], ['內容確認', ['unit_review', 'approval']], ['製作設計', ['approved', 'design_pending', 'design_review', 'sponsor_review']], ['等待發布', ['ready']], ['已發布', ['published']],
  ];
  return <>
    <div className="ops-stats">{[['等待審核', reviews.length + data.tasks.filter(task => task.status === 'delivered').length, 'review', '文案版本與交件成果等待確認'], ['進行中任務', unfinished.length, 'tasks', `${due.length} 件已到期`], ['等待排除', blocked.length + blockedJobs.length, 'settings', '任務卡點與系統工作'], ['已發布宣傳', data.posts.filter(p => p.stage === 'published').length, 'posts', '已登錄實際發布證據']].map(([label, count, tab, note]) => <button className="ops-stat" key={label} onClick={() => go(tab)}><span>{label}</span><strong>{String(count).padStart(2, '0')}</strong><small>{note}<span aria-hidden="true"> ↗</span></small></button>)}</div>
    <div className="ops-overview-columns"><Panel title="下一步，先處理這些" kicker="ACTION QUEUE" action={<button className="ops-text-button" onClick={() => go('review')}>全部審核 →</button>}>
      {data.posts.length ? <div className="ops-action-list">{[...data.posts].filter(p => p.stage !== 'published').slice(0, 4).map(post => <button className="ops-next-item" key={post.id} onClick={() => openPost(post)}><span className="ops-next-dot" aria-hidden="true" /><span><span className="ops-item-line"><strong>{post.title}</strong><Badge value={post.stage} /></span><small>{nextStep(post, data)}</small></span><span className="ops-arrow" aria-hidden="true">→</span></button>)}{data.posts.every(p => p.stage === 'published') && <p className="ops-note">目前宣傳均已登錄發布。可以新增下一則需求。</p>}</div> : <Empty title="從第一個活動開始" detail="活動資料確認後，再建立宣傳需求與任務。"><button className="ops-button primary" disabled={busy} onClick={() => openForm('event')}>新增活動</button></Empty>}
    </Panel><Panel title="我的交付" kicker="MY DELIVERABLES" action={<button className="ops-text-button" onClick={() => go('tasks')}>查看任務 →</button>}>
      {myTasks.length ? <div className="ops-my-list">{myTasks.map(task => <button key={task.id} className="ops-my-item" onClick={() => openForm('task', task)}><span className="ops-square" aria-hidden="true" /><span><strong>{task.title}</strong><small>{task.status === 'blocked' ? task.blocker || '請補上卡點' : `期限 ${dateText(task.dueDate)}`}</small></span><Badge value={task.status} type="task" /></button>)}</div> : <p className="ops-note">目前沒有指派給你的未完成任務。到「我的任務」可查看全組交付。</p>}
    </Panel></div>
    <Panel title="宣傳製作進度" kicker="CONTENT PIPELINE"><div className="ops-pipeline">{groups.map(([label, stages], index) => <button key={label} onClick={() => go('posts')} className="ops-pipeline-step"><span className="ops-step-number">0{index + 1}</span><strong>{data.posts.filter(p => stages.includes(p.stage)).length}</strong><span>{label}</span></button>)}</div><p className="ops-footnote">文案核准後才建立設計；資料或文案異動會重新確認。每次交接都有版本與負責人。</p></Panel>
    {(blocked.length > 0 || blockedJobs.length > 0) && <Panel title="目前卡點" kicker="NEEDS ATTENTION"><div className="ops-attention-list">{blocked.map(task => <div key={task.id}><span className="ops-badge ops-badge-red">任務</span><strong>{task.title}</strong><p>{task.blocker || '尚未填寫原因'}</p><button className="ops-text-button" onClick={() => openForm('task', task)}>更新卡點 →</button></div>)}{blockedJobs.slice(0, 3).map(job => <div key={job.id}><Badge value={job.status} type="job" /><strong>{data.posts.find(p => p.id === job.postId)?.title || '自動工作'}</strong><p>{job.lastError || '請查看系統連線設定。'}</p><button className="ops-text-button" onClick={() => go('settings')}>查看處理方式 →</button></div>)}</div></Panel>}
  </>;
}

function Projects({ data, busy, openForm, run, openPost }) {
  const [selected, setSelected] = useState('all');
  const events = selected === 'all' ? data.events : data.events.filter(e => e.projectId === selected);
  return <>
    <div className="ops-section-heading"><div><h2>專案有目標，活動有依據</h2><p className="ops-muted">每件事由一位負責人推進，顧問協助確認交付。</p></div><div className="ops-button-row"><button className="ops-button quiet" disabled={busy} onClick={() => openForm('project')}>＋ 新增專案</button><button className="ops-button primary" disabled={busy} onClick={() => openForm('event', null, selected === 'all' ? {} : { projectId: selected })}>＋ 新增活動</button></div></div>
    <div className="ops-project-grid">{data.projects.map(project => {
      const tasks = data.tasks.filter(task => task.projectId === project.id); const done = tasks.filter(t => t.status === 'done').length;
      return <article className={`ops-project-card ${selected === project.id ? 'selected' : ''}`} key={project.id}><div className="ops-item-line"><span className="ops-kicker">PROJECT</span><button className="ops-text-button" disabled={busy} onClick={() => openForm('project', project)}>編輯</button></div><button className="ops-project-select" aria-pressed={selected === project.id} onClick={() => setSelected(selected === project.id ? 'all' : project.id)}><h3>{project.title}</h3><p>{project.objective || '尚未補上專案目標'}</p></button><div className="ops-progress-label"><span>已驗收任務</span><strong>{done} / {tasks.length}</strong></div><div className="ops-progress-track" role="progressbar" aria-label={`${project.title}任務完成比例`} aria-valuemin={0} aria-valuemax={tasks.length || 1} aria-valuenow={done}><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div><div className="ops-project-meta"><span>期限 {dateText(project.dueDate)}</span><span>{ownerLabel(project, data.people)}</span></div><p className="ops-footnote">結案標準：{project.completionCriteria || '待補'}</p></article>;
    })}</div>
    <Panel title={selected === 'all' ? '活動資料' : `${data.projects.find(p => p.id === selected)?.title || '專案'}的活動`} action={selected !== 'all' && <button className="ops-text-button" onClick={() => setSelected('all')}>顯示全部</button>}>
      {!events.length ? <Empty title="尚未建立活動" detail="先填標題、講者、時間與地點；確認資料後就能進入宣傳流程。" /> : <div className="ops-event-list">{events.map(event => <article className="ops-event" key={event.id}><div className="ops-event-date"><strong>{event.date ? event.date.slice(8, 10) : '—'}</strong><span>{event.date ? `${event.date.slice(5, 7)} 月` : '日期待定'}</span></div><div className="ops-event-body"><div className="ops-item-line"><h3>{event.title}</h3><Badge type="event" value={event.confirmationStatus} /></div><p className="ops-event-facts">{event.speaker || '講者待確認'}<span>·</span>{event.time || '時間待確認'}<span>·</span>{event.venue || '地點待確認'}</p>{event.highlights && <p className="ops-pre-line ops-muted">{event.highlights}</p>}<div className="ops-source-line"><span>資料 v{event.version}</span>{event.sourceRevision && <span>{event.sourceRevision}</span>}<ExternalLink href={event.sourceUrl}>查看來源</ExternalLink></div><div className="ops-button-row"><button className="ops-button quiet small" disabled={busy} onClick={() => openForm('event', event)}>編輯資料</button><ActionButton tone="quiet small" busy={busy} reason={event.confirmationStatus === 'confirmed' ? '資料已確認' : !canOwn(data.actor, event, data.projects, data.people) ? '由活動負責人或顧問確認' : !event.date || !event.speaker || !event.venue ? '請補齊日期、講者與地點' : ''} onClick={() => run('event.confirm', event)}>確認活動資料</ActionButton><button className="ops-button quiet small" disabled={busy} onClick={() => openForm('post', null, { eventId: event.id, projectId: event.projectId, title: `${event.title}｜宣傳`, audience: event.audience, highlights: event.highlights })}>＋ 建立宣傳</button><button className="ops-button quiet small" disabled={busy} onClick={() => openForm('task', null, { eventId: event.id, projectId: event.projectId })}>＋ 拆分任務</button></div>{data.posts.filter(p => p.eventId === event.id).length > 0 && <div className="ops-event-posts">{data.posts.filter(p => p.eventId === event.id).map(post => <button key={post.id} onClick={() => openPost(post)}>{post.title}<Badge value={post.stage} /></button>)}</div>}</div></article>)}</div>}
    </Panel>
    <Panel title="合作與跨組交付要求" kicker="REQUIREMENTS" action={<button className="ops-button quiet small" disabled={busy} onClick={() => openForm('obligation')}>＋ 新增要求</button>}>
      {data.obligations.length ? <div className="ops-requirement-grid">{data.obligations.map(item => <article className="ops-requirement" key={item.id}><div className="ops-item-line"><h3>{item.title}</h3><button className="ops-text-button" onClick={() => openForm('obligation', item)}>編輯</button></div><p className="ops-pre-line">{item.requirements}</p><span className={`ops-badge ${item.requiresSponsorReview ? 'ops-badge-amber' : 'ops-badge-neutral'}`}>{item.requiresSponsorReview ? '發布前需贊助方確認' : '依內容交付'}</span><div className="ops-source-line"><ExternalLink href={item.sourceUrl}>來源</ExternalLink><ExternalLink href={item.evidenceUrl}>交付證據</ExternalLink></div></article>)}</div> : <p className="ops-note">把 Logo、露出、照片、連結或事前審稿等要求集中記錄，宣傳審核時就能一起核對。</p>}
    </Panel>
  </>;
}

function Posts({ data, selectedId, setSelectedId, busy, openForm, run, openAction, batchGenerate, batchProgress }) {
  const [filter, setFilter] = useState('all'); const [query, setQuery] = useState('');
  const list = data.posts.filter(post => (filter === 'all' || post.stage === filter) && `${post.title} ${post.caption || ''}`.toLowerCase().includes(query.toLowerCase()));
  const selected = list.find(p => p.id === selectedId) || list[0];
  const batchCount = Math.min(20, data.posts.filter(post => post.stage === 'brief' && !post.caption && canOwn(data.actor, post, data.projects, data.people)).length);
  const exportPosts = () => {
    const url = URL.createObjectURL(new Blob([exportPostsCsv(data)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `ITRC_宣傳總表_${data.settings.mode === 'demo' ? '示範資料_' : ''}${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="ops-section-heading"><div><h2>宣傳製作</h2><p className="ops-muted">一次一個版本，從需求一路交到發布紀錄。</p></div><div className="ops-button-row"><button className="ops-button quiet" disabled={!data.posts.length} onClick={exportPosts}>匯出宣傳總表</button><button className="ops-button primary" disabled={busy || !data.events.length} onClick={() => openForm('post')}>＋ 新增宣傳</button></div></div>
    {!data.events.length && <p className="ops-note">先到「活動與專案」新增活動，才能建立宣傳需求。</p>}
    {batchCount > 0 && <div className="ops-batch-panel"><div><strong>把待製作需求一次整理成草稿</strong><p>這次最多 {batchCount} 則；{data.settings.mode === 'demo' ? '使用示範規則草稿' : data.settings.integrations?.drafting?.configured ? '使用已設定的 AI 服務' : '使用規則草稿'}。產生後仍逐則送審，已有文案的版本會保留。</p></div><button className="ops-button quiet" disabled={busy} onClick={batchGenerate}>批次產生待製作文案（{batchCount}）</button></div>}
    {batchProgress && <div className="ops-batch-progress" role="status"><strong>{batchProgress.running ? '正在逐則產生草稿' : '這一批已處理'} · {batchProgress.done} / {batchProgress.total}</strong><p>完成 {batchProgress.done - batchProgress.failures.length} 則；需要處理 {batchProgress.failures.length} 則。</p>{batchProgress.failures.length > 0 && <ul>{batchProgress.failures.map((item, index) => <li key={index}>{item.title}：{item.message}</li>)}</ul>}</div>}
    <div className="ops-filters"><label className="ops-search"><span className="ops-sr-only">搜尋宣傳</span><input type="search" placeholder="搜尋標題或文案…" value={query} onChange={e => setQuery(e.target.value)} /></label><label><span className="ops-sr-only">宣傳階段</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部階段</option>{Object.entries(STAGES).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}</select></label><span className="ops-muted">{list.length} 則宣傳</span></div>
    {data.posts.length ? <div className="ops-post-workspace"><div className="ops-post-list" aria-label="宣傳清單">{list.map(post => <button key={post.id} className={`ops-post-card ${selected?.id === post.id ? 'selected' : ''}`} onClick={() => setSelectedId(post.id)} aria-pressed={selected?.id === post.id}><div className="ops-item-line"><Badge value={post.stage} /><span className="ops-version">v{post.copyVersion}</span></div><strong>{post.title}</strong><p>{CHANNELS[post.channel] || post.channel} · {dateText(post.scheduledAt)}</p><small>{nextStep(post, data)}</small></button>)}{!list.length && <p className="ops-note">沒有符合條件的宣傳。</p>}</div>{selected && <PostDetail post={selected} data={data} busy={busy} openForm={openForm} run={run} openAction={openAction} />}</div> : <Empty title="讓第一則宣傳開始流動" detail="填入標題、內容與宣傳重點，產生草稿後再交由單位與終審者確認。" />}
  </>;
}

function PostDetail({ post, data, busy, openForm, run, openAction }) {
  const event = data.events.find(e => e.id === post.eventId); const owner = canOwn(data.actor, post, data.projects, data.people);
  const unitReviewer = owner || canOwn(data.actor, event, data.projects, data.people);
  const designAllowed = data.actor.canDesign || isAdviser(data.actor);
  const requirements = data.obligations.filter(item => item.status !== 'cancelled' && (item.eventId === post.eventId || (!item.eventId && item.projectId === post.projectId)));
  const jobs = data.jobs.filter(job => job.postId === post.id);
  const confirmed = event?.confirmationStatus === 'confirmed';
  const currentApproved = post.approvedVersion === post.copyVersion;
  const reasonOwner = owner ? '' : '由文案負責人或顧問操作';
  const phase = ['brief', 'draft', 'needs_revision'].includes(post.stage) ? 0 : post.stage === 'unit_review' ? 1 : post.stage === 'approval' ? 2 : ['approved', 'design_pending', 'design_review', 'sponsor_review'].includes(post.stage) ? 3 : 4;
  return <article className="ops-post-detail">
    <div className="ops-detail-heading"><div><span className="ops-kicker">{CHANNELS[post.channel]} · COPY v{post.copyVersion}</span><h2>{post.title}</h2></div><Badge value={post.stage} /></div>
    <ol className="ops-workflow" aria-label="宣傳交接階段">{['整理文案', '單位確認', '文案終審', '設計交件', '發布留存'].map((label, index) => <li key={label} className={index === phase ? 'current' : index < phase ? 'passed' : ''}><span>{index < phase ? '✓' : index + 1}</span>{label}</li>)}</ol>
    <div className="ops-next-banner"><span>下一步</span><strong>{nextStep(post, data)}</strong></div>
    {(post.revisionReason || post.rejectionReason) && <p className="ops-inline-error">需要修訂：{post.revisionReason || post.rejectionReason}</p>}
    <div className="ops-post-actions">
      {['brief', 'draft', 'needs_revision'].includes(post.stage) && <><ActionButton tone="quiet" busy={busy} reason={reasonOwner} onClick={() => run('post.generate', post)}>產生草稿</ActionButton><ActionButton busy={busy} reason={reasonOwner || (!post.caption?.trim() || !post.slides?.length ? '先完成文案與輪播各頁文字' : !confirmed ? '先確認活動資料' : '')} onClick={() => run('post.submit', post)}>送交單位確認 →</ActionButton></>}
      {post.stage === 'unit_review' && <ActionButton busy={busy} reason={!unitReviewer ? '由活動負責人或顧問確認' : !confirmed ? '先確認活動資料' : ''} onClick={() => run('post.unit-review', post)}>內容無誤，送交終審 →</ActionButton>}
      {post.stage === 'approval' && <ActionButton busy={busy} reason={!data.actor.canApprove ? data.settings.approverConfigured === false ? '尚未指定正式終審帳號' : '由指定終審帳號核准' : !confirmed ? '先確認活動資料' : ''} onClick={() => run('post.approve', post)}>核准 v{post.copyVersion}，建立設計工作 →</ActionButton>}
      {post.stage === 'approved' && <ActionButton busy={busy} reason={!currentApproved ? '當前文案需要重新核准' : reasonOwner} onClick={() => run('post.request-design', post)}>建立設計工作</ActionButton>}
      {['approved', 'design_pending', 'design_review'].includes(post.stage) && <ActionButton tone="quiet" busy={busy} reason={!currentApproved ? '先核准當前文案' : !designAllowed ? '由行銷負責人或顧問交件' : ''} onClick={() => openAction({ action: 'post.attach-design', record: post, title: '登錄可編輯的 Canva 設計', description: '請確認設計的文字與主要素材可分別編輯，並與目前通過的文案版本一致。', defaults: { canvaEditUrl: post.canvaEditUrl || '', canvaDesignId: post.canvaDesignId || '' }, fields: [{ key: 'canvaEditUrl', label: 'Canva 編輯連結', type: 'url', required: true, placeholder: 'https://www.canva.com/design/…/edit' }, { key: 'canvaDesignId', label: '設計 ID（可留空）' }] })}>登錄 Canva 交件</ActionButton>}
      {post.stage === 'design_review' && <ActionButton busy={busy} reason={!designAllowed ? '由行銷負責人或顧問校對' : post.designCopyVersion !== post.copyVersion ? '設計需對應當前文案版本' : ''} onClick={() => run('post.design-review', post, { confirmed: true })}>設計校對通過 →</ActionButton>}
      {post.stage === 'sponsor_review' && <ActionButton busy={busy} reason={!unitReviewer && !designAllowed ? '由負責人或行銷人員記錄' : ''} onClick={() => openAction({ action: 'post.sponsor-review', record: post, title: '登錄贊助方確認', description: '收到贊助方明確確認後，填入可核對的紀錄連結。', defaults: { confirmed: false }, fields: [{ key: 'confirmed', label: '確認狀態', type: 'checkbox', checkboxLabel: '贊助方已確認當前版本' }, { key: 'evidenceUrl', label: '確認證據連結', type: 'url', required: true, placeholder: 'https://' }] })}>登錄確認證據 →</ActionButton>}
      {post.stage === 'ready' && <ActionButton busy={busy} reason={!designAllowed && !owner ? '由發布負責人登錄' : ''} onClick={() => openAction({ action: 'post.publish', record: post, title: '登錄已發布的宣傳', description: '請先在發布平台完成發布，再留下實際網址與時間。工作台會保留這次交付紀錄。', defaults: { publishedUrl: '', publishedAt: localDateTime(new Date().toISOString()) }, fields: [{ key: 'publishedUrl', label: '正式發布網址', type: 'url', required: true, placeholder: 'https://' }, { key: 'publishedAt', label: '實際發布時間', type: 'datetime-local', required: true }] })}>登錄發布證據</ActionButton>}
      {post.stage !== 'published' && <ActionButton tone="quiet" busy={busy} reason={reasonOwner} onClick={() => openForm('post', post)}>編輯文案</ActionButton>}
      {!['brief', 'draft', 'needs_revision', 'published'].includes(post.stage) && <ActionButton tone="danger" busy={busy} reason={!unitReviewer && !data.actor.canApprove && !designAllowed ? '由本案審核者操作' : ''} onClick={() => openAction({ action: 'post.reject', record: post, title: '退回修訂', description: '原核准與設計確認會失效；修改後重新送審。', fields: [{ key: 'reason', label: '需要修改的內容與原因', type: 'textarea', required: true }], button: '退回修訂' })}>退回修訂</ActionButton>}
    </div>
    <div className="ops-copy-block"><div className="ops-section-heading"><h3>貼文文案</h3><span className="ops-version">{post.generationMethod?.includes('demo') ? '示範規則草稿' : post.generationMethod?.includes('rule') || post.generationMethod?.includes('template') ? '規則草稿' : post.generationMethod ? 'AI 草稿 · 仍需人工審核' : '人工輸入／尚未產生'}</span></div>{post.caption ? <p className="ops-caption">{post.caption}</p> : <div className="ops-copy-empty"><span>先填需求，再整理文字</span><p>產生草稿會帶入活動資料、宣傳重點與合作要求。</p></div>}</div>
    {post.slides?.length > 0 && <section className="ops-slide-preview"><h3>分層設計文字 · {post.slides.length} 頁</h3><div>{post.slides.map((slide, index) => <article key={index}><span className="ops-slide-number">{String(index + 1).padStart(2, '0')}</span><h4>{slide.heading || '待填標題'}</h4><p className="ops-pre-line">{slide.body || '待填內文'}</p></article>)}</div></section>}
    <div className="ops-post-metadata"><div><span>活動資料</span><strong>{event?.title || '尚未連結活動'}</strong><small>{dateText(event?.date)} · {event?.venue || '地點待確認'}</small></div><div><span>負責人</span><strong>{ownerLabel(post, data.people)}</strong><small>預計發布 {dateText(post.scheduledAt)}</small></div><div><span>核准版本</span><strong>{currentApproved ? `v${post.approvedVersion} · 已核准` : '當前版本未核准'}</strong><small>{currentApproved ? post.approvedBy : '修改內容後會重新確認'}</small></div><div><span>設計交件</span>{post.canvaEditUrl ? <ExternalLink href={post.canvaEditUrl}>開啟 Canva 設計</ExternalLink> : <strong>等待設計連結</strong>}<small>{post.designCopyVersion ? `對應文案 v${post.designCopyVersion}` : '文字與素材需要可分別編輯'}</small></div></div>
    {post.stage === 'published' && <div className="ops-publication"><span className="ops-badge ops-badge-green">發布已留存</span><ExternalLink href={post.publishedUrl}>查看正式貼文</ExternalLink><span>{dateText(post.publishedAt)}</span></div>}
    {requirements.length > 0 && <section className="ops-detail-section"><h3>這則宣傳的交付要求</h3>{requirements.map(item => <div className="ops-inline-requirement" key={item.id}><strong>{item.title}</strong><p className="ops-pre-line">{item.requirements}</p>{item.requiresSponsorReview && <span className="ops-badge ops-badge-amber">發布前需贊助方確認</span>}</div>)}</section>}
    <CopyHistory post={post} data={data} busy={busy} openAction={openAction} />
    {jobs.length > 0 && <details className="ops-job-details"><summary>自動工作紀錄（{jobs.length}）</summary>{jobs.map(job => <div key={job.id} className="ops-job-row"><Badge type="job" value={job.status} /><span>{job.type} · v{job.copyVersion}</span>{job.lastError && <p>{job.lastError}</p>}</div>)}</details>}
  </article>;
}

function TaskActions({ task, data, busy, run, openAction }) {
  const editable = canOwn(data.actor, task, data.projects, data.people, data.tasks);
  const reviewer = personById(data.people, task.reviewerPersonId);
  const personalReview = !!reviewer?.email && reviewer.email.toLowerCase() === data.actor.email?.toLowerCase() && task.deliveredBy !== data.actor.email;
  const reviewAllowed = canReviewTask(data.actor, task, data.people);
  const deliveryReason = taskDeliveryReason(task, data.tasks, data.people);
  const projectClosed = ['completed', 'cancelled'].includes(data.projects.find(project => project.id === task.projectId)?.status);
  const reviewReason = !reviewAllowed ? '由指定驗收人或管理顧問確認' : !personalReview && !isAdviser(data.actor) ? '交件與驗收需分開；請由顧問登錄外部確認' : deliveryReason;
  const openReview = () => openAction({
    action: 'task.accept-delivery', record: task, title: '確認驗收通過',
    description: personalReview ? `請依驗收標準核對「${task.title}」的成果。` : `請先取得 ${reviewer?.name || '指定驗收人'} 的明確確認，再留下證據代為登錄。紀錄會保留實際登入帳號與代登錄方式。`,
    defaults: { comment: '', confirmedExternalReview: false },
    fields: [...(!personalReview ? [
      { key: 'confirmedExternalReview', label: '驗收人確認', type: 'checkbox', required: true, checkboxLabel: `${reviewer?.name || '指定驗收人'} 已確認成果符合標準` },
      { key: 'evidenceUrl', label: '驗收確認證據', type: 'url', required: true, placeholder: 'https://' },
    ] : []), { key: 'comment', label: '驗收備註', type: 'textarea' }], button: '記錄驗收通過',
  });
  return <>
    {editable && ['accepted', 'todo'].includes(task.status) && <ActionButton tone="quiet small" busy={busy} reason={projectClosed ? '請先重新開啟專案' : !hasAssignee(task) ? '先指派承辦人' : (task.dependsOn || []).some(id => data.tasks.find(item => item.id === id)?.status !== 'done') ? '前置任務尚未驗收' : ''} onClick={() => run('task.update', task, { status: 'doing' })}>開始處理</ActionButton>}
    {editable && ['accepted', 'todo', 'doing', 'blocked'].includes(task.status) && <ActionButton tone="primary small" busy={busy} reason={projectClosed ? '請先重新開啟專案' : deliveryReason} onClick={() => openAction({ action: 'task.deliver', record: task, title: '提交成果待驗收', description: `承辦人：${ownerLabel(task, data.people)}。交件後由 ${reviewer?.name || '指定驗收人'} 核對成果。`, defaults: { deliverableUrl: task.deliverableUrl || '' }, fields: [{ key: 'deliverableUrl', label: '交付成果連結', type: 'url', required: true, placeholder: 'https://' }], button: '提交成果' })}>交件待驗收</ActionButton>}
    {task.status === 'delivered' && <>
      <ActionButton tone="primary small" busy={busy} reason={projectClosed ? '請先重新開啟專案' : reviewReason} onClick={openReview}>驗收通過</ActionButton>
      <ActionButton tone="danger small" busy={busy} reason={!reviewAllowed ? '由指定驗收人或管理顧問退回' : ''} onClick={() => openAction({ action: 'task.return-delivery', record: task, title: '退回補件', description: '保留原交件紀錄，讓承辦人依原因修改後重新交件。', fields: [{ key: 'reason', label: '需補充或修改的內容', type: 'textarea', required: true }], button: '退回補件' })}>退回補件</ActionButton>
    </>}
    {['done', 'cancelled'].includes(task.status) && (reviewAllowed || editable) && <ActionButton tone="quiet small" busy={busy} reason={projectClosed ? '請先重新開啟專案' : ''} onClick={() => openAction({ action: 'task.reopen', record: task, title: '重新開啟任務', description: '原驗收紀錄會保留；修改後需要重新交件與驗收。', fields: [{ key: 'reason', label: '重新開啟的原因', type: 'textarea', required: true }], button: '重新開啟' })}>重新開啟</ActionButton>}
  </>;
}

function CopyHistory({ post, data, busy, openAction }) {
  const history = [...(post.history || [])].reverse();
  const [selectedId, setSelectedId] = useState('');
  const selected = history.find(version => version.id === selectedId) || history.find(version => version.copyVersion < post.copyVersion) || history[0];
  if (!selected) return <p className="ops-footnote">內容版本會從啟用保存後留存，舊資料未保存的版本無法回復。</p>;
  const renderContent = version => <><dl className="ops-history-meta">{[['宣傳名稱', version.title], ['目的', version.purpose], ['對象', version.audience], ['重點', version.highlights], ['希望採取的行動', version.cta], ['管道', CHANNELS[version.channel] || version.channel]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="ops-caption">{version.caption || '此版本尚無文案'}</p>{version.slides?.map((slide, index) => <div className="ops-history-slide" key={index}><strong>{index + 1}. {slide.heading}</strong><p className="ops-pre-line">{slide.body}</p></div>)}</>;
  return <details className="ops-history"><summary>內容版本與來源（{history.length} 筆保存紀錄）</summary>
    <div className="ops-history-controls"><label htmlFor={`ops-version-${post.id}`}>比較版本</label><select id={`ops-version-${post.id}`} value={selected.id} onChange={event => setSelectedId(event.target.value)}>{history.map(version => <option key={version.id} value={version.id}>v{version.copyVersion} · {ACTION_LABELS[version.action] || version.action || STAGES[version.stage]?.[0] || '保存版本'} · {dateText(version.createdAt)}</option>)}</select></div>
    <div className="ops-history-comparison"><section><h4>已保存 v{selected.copyVersion}</h4>{renderContent(selected)}<p className="ops-footnote">保存於 {dateText(selected.createdAt)} · {selected.actorEmail || '系統工作'}</p></section><section><h4>目前 v{post.copyVersion}</h4>{renderContent(post)}</section></div>
    {selected.sourceEventSnapshot && <div className="ops-note"><strong>當時活動資料</strong><p>{selected.sourceEventSnapshot.title || '活動'} · {dateText(selected.sourceEventSnapshot.date)} {selected.sourceEventSnapshot.time || ''}</p><p>{selected.sourceEventSnapshot.venue || '地點待確認'} · {selected.sourceEventSnapshot.speaker || '講者待確認'}</p><ExternalLink href={selected.sourceEventSnapshot.sourceUrl}>當時來源</ExternalLink></div>}
    <div className="ops-source-line"><span>{selected.approvedVersion === selected.copyVersion ? `此紀錄已核准 v${selected.approvedVersion}` : '此紀錄尚未核准'}</span><ExternalLink href={selected.canvaEditUrl}>此版設計</ExternalLink><ExternalLink href={selected.publishedUrl}>此版發布證據</ExternalLink></div>
    {post.stage !== 'published' && <ActionButton tone="quiet small" busy={busy} reason={!canOwn(data.actor, post, data.projects, data.people) ? '由承辦人或顧問處理' : ''} onClick={() => openAction({ action: 'post.restore-version', record: post, title: `以 v${selected.copyVersion} 的內容建立新草稿`, description: '取回此版文案、輪播與宣傳需求，保留目前的活動關聯。新草稿需要重新送審，原核准、設計與發布紀錄會保留。', defaults: { historyId: selected.id }, fields: [], button: '建立新草稿' })}>取回此版內容</ActionButton>}
  </details>;
}

function Tasks({ data, busy, openForm, run, openAction }) {
  const currentPerson = actorPerson(data.actor, data.people);
  const [scope, setScope] = useState(currentPerson ? 'mine' : 'all');
  const [selectedPersonId, setSelectedPersonId] = useState(currentPerson?.personId || '');
  const [status, setStatus] = useState('open'); const [query, setQuery] = useState('');
  const selectedPerson = personById(data.people, selectedPersonId);
  const tasks = data.tasks.filter(task => (scope === 'all' || scope === 'mine' && matchesPerson(task, selectedPerson, selectedPersonId ? '' : data.actor.email) || scope === 'unassigned' && !hasAssignee(task)) && (status === 'all' || status === 'open' && !['done', 'cancelled'].includes(task.status) || status === task.status) && `${task.title} ${ownerLabel(task, data.people)} ${personLabel(personById(data.people, task.reviewerPersonId))}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="ops-section-heading"><div><h2>把工作拆成可交付的任務</h2><p className="ops-muted">承辦人交件，驗收人確認；成果與退回原因留在同一筆任務。</p></div><button className="ops-button primary" disabled={busy} onClick={() => openForm('task')}>＋ 新增任務</button></div>
    <div className="ops-task-viewer"><label htmlFor="ops-view-person">查看誰的任務</label><select id="ops-view-person" value={selectedPersonId} onChange={event => { setSelectedPersonId(event.target.value); setScope('mine'); }}><option value="">依登入帳號</option>{personOptions(data.people, selectedPersonId).map(person => <option key={person.value} value={person.value}>{person.label}</option>)}</select><span className="ops-muted">共用登入時可選承辦人檢視；操作仍記錄實際登入帳號。</span></div>
    <div className="ops-filters"><div className="ops-segment" aria-label="任務範圍">{[['mine', selectedPerson ? `${selectedPerson.name}的任務` : '我的任務'], ['all', '全部任務'], ['unassigned', '待指派']].map(([value, label]) => <button key={value} aria-pressed={scope === value} className={scope === value ? 'active' : ''} onClick={() => setScope(value)}>{label}</button>)}</div><label><span className="ops-sr-only">任務狀態</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="open">未完成</option><option value="all">全部進度</option>{Object.entries(TASK_STATES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="ops-search"><span className="ops-sr-only">搜尋任務</span><input placeholder="搜尋任務、姓名或職稱…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    {tasks.length ? <div className="ops-task-list">{tasks.map(task => {
      const dependencies = (task.dependsOn || []).map(id => data.tasks.find(t => t.id === id)).filter(Boolean);
      const reviewer = personById(data.people, task.reviewerPersonId);
      return <article className={`ops-task ${task.status === 'blocked' ? 'blocked' : ''}`} key={task.id}>
        <div className="ops-task-main"><div className="ops-item-line"><h3>{task.title}</h3><Badge value={task.status} type="task" /></div>
          <p className="ops-muted">{data.projects.find(p => p.id === task.projectId)?.title || '獨立任務'}{task.parentId && ` ／ ${data.tasks.find(t => t.id === task.parentId)?.title || '上層任務'}`}{task.requiredForCompletion !== false && task.projectId && <span className="ops-required-task">結案必要</span>}</p>
          <p><span className="ops-meta-label">承辦</span>{ownerLabel(task, data.people)}<span className="ops-meta-label ops-reviewer-label">驗收人</span>{personLabel(reviewer) || '待指定'}</p>
          <p><span className="ops-meta-label">標準</span>{task.acceptanceCriteria || '尚未設定驗收標準'}</p>
          {task.blocker && <p className="ops-task-blocker"><span>卡點</span>{task.blocker}</p>}
          {task.returnReason && <p className="ops-task-blocker"><span>補件</span>{task.returnReason}</p>}
          {dependencies.length > 0 && <div className="ops-dependencies"><span>前置任務</span>{dependencies.map(dependency => <span className={`ops-dependency ${dependency.status === 'done' ? 'done' : ''}`} key={dependency.id}>{dependency.status === 'done' ? '✓ ' : '待完成 · '}{dependency.title}</span>)}</div>}
          <ExternalLink href={task.deliverableUrl}>查看交付成果</ExternalLink>
          {task.reviewEvidenceUrl && <div className="ops-source-line"><ExternalLink href={task.reviewEvidenceUrl}>查看驗收確認證據</ExternalLink></div>}
          {task.reviewIdentityMode === 'recorded_external_review' && <p className="ops-footnote">此筆驗收由管理帳號依外部確認證據代為登錄。</p>}
          {task.deliveryHistory?.length > 0 && <details className="ops-delivery-history"><summary>交付與驗收紀錄（{task.deliveryHistory.length}）</summary>{[...task.deliveryHistory].reverse().map(entry => <div key={entry.id}><strong>{ACTION_LABELS[entry.action] || (entry.action === 'task.delivery-invalidated' ? '資料修改，需重新交件' : entry.action === 'task.before-reopen' ? '重新開啟前的驗收紀錄' : '交付紀錄')}</strong><small>{dateText(entry.createdAt)} · {entry.actorEmail}</small>{entry.reason && <p>{entry.reason}</p>}<div className="ops-source-line"><ExternalLink href={entry.deliverableUrl}>當次成果</ExternalLink><ExternalLink href={entry.reviewEvidenceUrl}>驗收證據</ExternalLink></div></div>)}</details>}
        </div>
        <div className="ops-task-side"><span>期限 <strong>{dateText(task.dueDate)}</strong></span><button className="ops-button quiet small" disabled={busy} onClick={() => openForm('task', task)}>查看／更新</button><TaskActions task={task} data={data} busy={busy} run={run} openAction={openAction} /></div>
      </article>;
    })}</div> : <Empty title="目前沒有符合條件的任務" detail="可切換承辦人或全部任務，也可以為下一項交付建立任務。" />}
  </>;
}

function Reviews({ data, openPost, busy, run, openAction, openForm }) {
  const reviews = data.posts.filter(post => ['unit_review', 'approval', 'design_review', 'sponsor_review'].includes(post.stage));
  const delivered = data.tasks.filter(task => task.status === 'delivered');
  return <><Panel title="等待驗收的成果" kicker="DELIVERY REVIEW">{delivered.length ? <div className="ops-task-list">{delivered.map(task => <article className="ops-task" key={task.id}><div className="ops-task-main"><h3>{task.title}</h3><p className="ops-muted">承辦：{ownerLabel(task, data.people)} · 驗收：{personLabel(personById(data.people, task.reviewerPersonId)) || '待指定'}</p><p>{task.acceptanceCriteria || '驗收標準待補'}</p><ExternalLink href={task.deliverableUrl}>查看交付成果</ExternalLink></div><div className="ops-task-side"><button className="ops-button quiet small" disabled={busy} onClick={() => openForm('task', task)}>查看任務</button><TaskActions task={task} data={data} busy={busy} run={run} openAction={openAction} /></div></article>)}</div> : <p className="ops-note">任務交件後，成果會在這裡等待指定人員驗收。</p>}</Panel><Panel title="等待確認的版本" kicker="REVIEW QUEUE">{reviews.length ? <div className="ops-action-list">{reviews.map(post => <button key={post.id} className="ops-next-item" onClick={() => openPost(post)}><span className="ops-version">v{post.copyVersion}</span><span><span className="ops-item-line"><strong>{post.title}</strong><Badge value={post.stage} /></span><small>{nextStep(post, data)}</small></span><span aria-hidden="true">→</span></button>)}</div> : <Empty title="目前沒有等待審核的文案" detail="文案送出後，會依序進入單位確認、文案終審與設計校對。" />}</Panel><Panel title="操作紀錄" kicker="AUDIT TRAIL"><p className="ops-footnote">記錄操作人、時間與資料版本。新版文案需重新確認，原紀錄會保留。</p>{data.audit.length ? <ol className="ops-timeline">{[...data.audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((entry, index) => <li key={entry.id || `${entry.createdAt}-${index}`}><div className="ops-timeline-dot" /><div><div className="ops-item-line"><strong>{ACTION_LABELS[entry.action] || entry.action}</strong><time>{dateText(entry.createdAt)}</time></div><p>{entry.summary || entry.entityId}</p><small>{entry.actorEmail || '系統工作'}{entry.toVersion ? ` · ${entry.fromVersion ? `v${entry.fromVersion} → ` : ''}v${entry.toVersion}` : ''}</small></div></li>)}</ol> : <p className="ops-note">第一筆操作完成後，紀錄會出現在這裡。</p>}</Panel></>;
}

function downloadTemplate(kind) {
  const samples = {
    events: '標題,講者,日期,時間,地點,對象,費用,報名連結,宣傳重點,負責人信箱,來源網址,來源版本,來源鍵\r\n示範交流工作坊,示範講者,2026-11-30,18:30,示範教室,同學,免費,https://example.org/register,請替換為正式活動重點,,,草稿 v1,event-example-01\r\n',
    posts: '宣傳名稱,活動ID,活動來源鍵,宣傳目的,宣傳對象,宣傳重點,希望採取行動,發布管道,預計發布時間,負責人信箱,來源鍵\r\n工作坊首波宣傳,,,介紹活動並邀請報名,初次參與的同學,帶走一份自己的研究草稿,查看資訊並報名,instagram,2026-11-20T12:00:00+08:00,,post-example-01\r\n',
    tasks: '標題,負責人ID,驗收人ID,結案必要,截止日期,驗收標準,來源網址,來源版本,來源鍵\r\n示範器材測試,,,是,2026-11-28,投影與錄影設備測試完成,,草稿 v1,task-example-01\r\n',
  };
  const names = { events: '活動', posts: '宣傳需求', tasks: '任務' };
  const url = URL.createObjectURL(new Blob(['\uFEFF', samples[kind]], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `ITRC_${names[kind]}匯入範本.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ImportPanel({ data, busy, execute }) {
  const [kind, setKind] = useState('posts'); const [input, setInput] = useState(''); const [defaultEvent, setDefaultEvent] = useState('');
  const [sourceLabel, setSourceLabel] = useState(`貼上試算表（${new Date().toISOString().slice(0, 10)}）`);
  const [sourceId, setSourceId] = useState(data.settings.sources?.[0]?.id || '');
  const [staged, setStaged] = useState(null); const [preview, setPreview] = useState(null); const [error, setError] = useState('');
  const clearPreview = () => { setStaged(null); setPreview(null); setError(''); };
  const change = text => { setInput(text); clearPreview(); };
  const validate = async () => {
    try {
      setError(''); const parsed = parseImportText(input, kind);
      if (defaultEvent && parsed.posts) parsed.posts = parsed.posts.map(post => !post.eventId && !post.eventSourceKey ? { ...post, eventId: defaultEvent } : post);
      for (const name of ['events', 'posts', 'tasks']) if (Array.isArray(parsed[name])) parsed[name] = parsed[name].map(row => !row.sourceUrl && !row.sourceLabel ? { ...row, sourceLabel: sourceLabel.trim() } : row);
      const result = await execute('import.preview', null, parsed); setStaged(parsed); setPreview(result.record || result);
    } catch (issue) { setError(humanError(issue)); }
  };
  const apply = async () => { try { setError(''); await execute('import.apply', null, staged); setInput(''); clearPreview(); } catch (issue) { setError(humanError(issue)); } };
  const readSheet = async () => { try { setError(''); const result = await execute('import.sheet-preview', null, { sourceId }); setStaged(result.staged); setPreview(result.record || result); } catch (issue) { setError(humanError(issue)); } };
  const previewRows = staged ? [...(staged.events || []), ...(staged.posts || []), ...(staged.tasks || [])] : [];
  return <Panel title="從 Excel／試算表帶入資料" kicker="STAGED IMPORT">
    <p className="ops-muted">一列一則宣傳，整學期可以一次整理。下載範本填寫並另存 CSV，或直接貼上試算表的欄列；先預覽，再由顧問確認匯入。</p>
    {data.settings.sources?.length > 0 && <div className="ops-sheet-source"><label htmlFor="ops-sheet-source">已連接的來源表</label><select id="ops-sheet-source" value={sourceId} onChange={e => setSourceId(e.target.value)}>{data.settings.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select><ActionButton tone="quiet small" busy={busy} reason={!isAdviser(data.actor) ? '由顧問讀取來源表' : ''} onClick={readSheet}>讀取並預覽</ActionButton><ExternalLink href={data.settings.sources.find(source => source.id === sourceId)?.url}>開啟來源</ExternalLink></div>}
    <div className="ops-import-controls"><label>資料類型<select value={kind} onChange={e => { setKind(e.target.value); clearPreview(); }}><option value="posts">宣傳需求（一列一則）</option><option value="events">活動資料</option><option value="tasks">任務</option></select></label><button className="ops-button quiet small" onClick={() => downloadTemplate(kind)}>下載 CSV 範本</button><label className="ops-file-label">選擇 CSV／TSV／JSON<input type="file" accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 512000) { setError('請使用 500 KB 以內的檔案，或分批匯入。'); return; } try { change(await file.text()); setSourceLabel(file.name); } catch { setError('檔案無法讀取，請重新選擇。'); } e.target.value = ''; }} /></label></div>
    <div className="ops-import-default"><label htmlFor="ops-import-source-label">來源檔名／資料標記</label><input id="ops-import-source-label" value={sourceLabel} onChange={e => { setSourceLabel(e.target.value); clearPreview(); }} placeholder="例如：115-1 宣傳需求表.csv" /><small>沒有來源網址時，保留原始檔名以便追溯。重複匯入請保留相同來源鍵。</small></div>
    {kind === 'posts' && <div className="ops-import-default"><label htmlFor="ops-import-event">活動欄空白時，使用這個活動</label><select id="ops-import-event" value={defaultEvent} onChange={e => { setDefaultEvent(e.target.value); clearPreview(); }}><option value="">每列自行填活動 ID／活動來源鍵</option>{data.events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select><small>多個活動的學期資料，請在各列填「活動 ID」或「活動來源鍵」。同一活動的多則宣傳可用這裡一次指定。</small></div>}
    <label className="ops-import-label" htmlFor="ops-import-text">貼上含標題列的表格資料</label><textarea id="ops-import-text" className="ops-import-input" rows={6} value={input} onChange={e => change(e.target.value)} placeholder={kind === 'posts' ? '宣傳名稱\t宣傳重點\t希望採取行動\t發布管道\n首波宣傳\t活動重點\t完成報名\tinstagram' : '標題\t講者\t日期\t地點\t宣傳重點\n範例活動\t講者\t2026-11-30\t教室\t活動重點'} />
    <p className="ops-footnote">支援中英文欄名、逗號或 Tab 分隔；每次最多 200 筆。日期用 YYYY-MM-DD；發布時間建議附 +08:00。管道填 instagram、story 或 announcement。原生 .xlsx 請先另存 CSV。原試算表不會被改寫。</p>
    <div className="ops-button-row"><ActionButton tone="quiet" busy={busy} reason={!isAdviser(data.actor) ? '由管理顧問檢查並匯入' : !input.trim() ? '先選擇檔案或貼上表格' : ''} onClick={validate}>檢查與預覽</ActionButton>{staged && <ActionButton busy={busy} reason={!isAdviser(data.actor) ? '由管理顧問確認匯入' : ''} onClick={apply}>確認匯入 {previewRows.length} 筆資料</ActionButton>}</div>
    {error && <p className="ops-inline-error" role="alert">{error}</p>}
    {preview && <div className="ops-import-preview"><div className="ops-item-line"><strong>預覽通過 · {previewRows.length} 筆</strong><span className="ops-badge ops-badge-amber">尚未寫入</span></div><p>活動以待確認資料、宣傳以需求草稿建立；不會跳過審核。相同來源鍵會由伺服器檢查重複。</p><div className="ops-table-scroll"><table><thead><tr><th>標題</th><th>日期／預計發布</th><th>負責人</th><th>關聯活動</th></tr></thead><tbody>{previewRows.slice(0, 10).map((row, i) => <tr key={i}><td>{row.title}</td><td>{row.date || row.dueDate || row.scheduledAt || '待補'}</td><td>{ownerLabel(row, data.people)}</td><td>{data.events.find(event => event.id === row.eventId)?.title || row.eventSourceKey || row.sourceRevision || '—'}</td></tr>)}</tbody></table></div>{previewRows.length > 10 && <p className="ops-footnote">先顯示前 10 筆；確認後會送出完整 {previewRows.length} 筆。</p>}{Array.isArray(preview.warnings) && preview.warnings.length > 0 && <p className="ops-note">{preview.warnings.map(w => typeof w === 'string' ? w : w.message || JSON.stringify(w)).join('；')}</p>}</div>}
  </Panel>;
}

const PEOPLE_FIELDS = { personId: '幹部 ID', name: '姓名', title: '職稱', group: '組別', email: 'MAIL', lineName: 'LINE 名稱', term: '任期', status: '在任狀態', sourceUrl: '名單來源', sourceRevision: '來源版本', contactSourceUrl: '聯絡資料來源' };
const PERSON_CHANGE = { create: '新增', update: '更新', unchanged: '未變更' };
function PeoplePanel({ data, busy, execute, demo }) {
  const [input, setInput] = useState(''); const [sourceRevision, setSourceRevision] = useState('');
  const [preview, setPreview] = useState(null); const [staged, setStaged] = useState(null); const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const clearPreview = () => { setPreview(null); setStaged(null); setConfirmed(false); setError(''); };
  const stage = async () => {
    try {
      setError(''); const parsed = parseImportText(input, 'people');
      if (!Array.isArray(parsed.people) || !parsed.people.length) throw new Error('請貼上含姓名與固定幹部 ID 的名單。');
      const people = parsed.people.map(person => ({ ...person, sourceUrl: person.sourceUrl || 'https://nsysu-itrc.vercel.app/', sourceRevision: person.sourceRevision || sourceRevision.trim() }));
      const result = await execute('people.import-preview', null, { people });
      setStaged(people); setPreview(result.record || result); setConfirmed(false);
    } catch (issue) { setError(humanError(issue)); }
  };
  const apply = async () => {
    try { setError(''); await execute('people.import-apply', null, { people: staged, previewToken: preview.previewToken }); setInput(''); clearPreview(); }
    catch (issue) { setError(humanError(issue)); }
  };
  const formatValue = (field, value) => field === 'status' ? PERSON_STATES[value] || value || '未填' : value || '未填';
  return <Panel title="幹部名單與承辦人" kicker="PEOPLE DIRECTORY">
    <p className="ops-muted">姓名與職稱依官網核對；MAIL、LINE 與任期保留在內部主表。固定幹部 ID 讓改名、換職稱與交接不會切斷舊任務。</p>
    <div className="ops-source-line"><ExternalLink href="https://nsysu-itrc.vercel.app/">官網幹部名單</ExternalLink><ExternalLink href="https://docs.google.com/spreadsheets/d/1K7byAc1JhpcinOHSDnGEGfwy0kzfTnMB4U-neTjKMKg/edit">開啟幹部主表</ExternalLink><span>{data.people.length} 筆人員對照{demo ? ' · 虛構示範' : ''}</span></div>
    {data.people.length ? <div className="ops-table-scroll"><table className="ops-people-table"><caption className="ops-sr-only">內部幹部名單與聯絡資料</caption><thead><tr><th>姓名／固定 ID</th><th>職稱／組別</th><th>MAIL／LINE</th><th>任期／狀態</th></tr></thead><tbody>{data.people.map(person => <tr key={person.personId}><td><strong>{person.name}</strong><small>{person.personId}</small></td><td>{person.title || '職稱待確認'}<small>{person.group || '組別待確認'}</small></td><td>{person.email || 'MAIL 待補'}<small>LINE：{person.lineName || '待補'}</small></td><td>{person.term || '任期待確認'}<small>{PERSON_STATES[person.status] || person.status || '待確認'}</small></td></tr>)}</tbody></table></div> : <p className="ops-note">尚未帶入人員對照。既有活動與任務會保留，新增工作可以先維持待指派。</p>}
    <details className="ops-people-import"><summary>預覽並更新幹部對照</summary>
      <p className="ops-note">先在主表核對官網名單，再貼上包含欄位名稱的資料。此處更新工作台的人員對照，不會授予登入或財務權限，也不會刪除未列入這次更新的人員。</p>
      <label className="ops-import-label" htmlFor="ops-people-revision">這次核對的來源版本</label><input id="ops-people-revision" value={sourceRevision} maxLength={2000} placeholder="例如：115-1 官網名單確認版" onChange={event => { setSourceRevision(event.target.value); clearPreview(); }} />
      <div className="ops-import-controls"><label className="ops-file-label">選擇 CSV／TSV／JSON<input type="file" accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 512000) { setError('請使用 500 KB 以內的名單檔案。'); return; } try { setInput(await file.text()); clearPreview(); } catch { setError('無法讀取檔案，請重新選擇。'); } }} /></label></div>
      <label className="ops-import-label" htmlFor="ops-people-input">貼上主表欄列或人員 JSON</label><textarea className="ops-import-input" id="ops-people-input" rows={5} value={input} onChange={event => { setInput(event.target.value); clearPreview(); }} placeholder="職稱、姓名、EMAIL、LINE名稱、組別、幹部ID、任期、在任狀態" />
      <div className="ops-button-row"><ActionButton tone="quiet" busy={busy} reason={!isAdviser(data.actor) ? '由管理顧問核對與更新' : !input.trim() ? '先貼上或選擇名單' : ''} onClick={stage}>預覽人員差異</ActionButton></div>
      {preview && <div className="ops-import-preview"><strong>核對這次變更 · {preview.people?.length || staged.length} 人</strong>
        {preview.warnings?.length > 0 && <ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <div className="ops-table-scroll"><table><caption className="ops-sr-only">即將套用的人員差異</caption><thead><tr><th>人員</th><th>動作</th><th>變更內容</th></tr></thead><tbody>{(preview.changes || []).map(change => {
          const before = personById(data.people, change.personId) || {}; const after = personById(preview.people || staged, change.personId) || {};
          return <tr key={change.personId}><td>{change.name || after.name}<small>{change.personId}</small></td><td>{PERSON_CHANGE[change.change] || change.change}</td><td>{change.changedFields?.length ? <ul className="ops-person-diff">{change.changedFields.map(field => <li key={field}><strong>{PEOPLE_FIELDS[field] || field}：</strong>{formatValue(field, before[field])} → {formatValue(field, after[field])}</li>)}</ul> : '保留原資料'}</td></tr>;
        })}</tbody></table></div>
        <label className="ops-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />已依官網確認姓名與職稱，並核對此處的人員差異</label>
        <ActionButton busy={busy} reason={!isAdviser(data.actor) ? '由管理顧問確認' : !confirmed ? '請先核對並勾選確認' : !preview.previewToken ? '請重新預覽取得最新差異' : ''} onClick={apply}>套用這次人員更新</ActionButton>
      </div>}
      {error && <p className="ops-inline-error" role="alert">{error}</p>}
    </details>
  </Panel>;
}

function CanvaConnection({ data, demo }) {
  const [status, setStatus] = useState(null); const [error, setError] = useState(''); const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    if (demo) return;
    let active = true;
    api.get('/ops/connections/canva').then(response => { if (active) setStatus(response.data); }).catch(issue => { if (active) setError(humanError(issue)); });
    return () => { active = false; };
  }, [demo]);
  const connect = async () => {
    if (demo) return;
    setConnecting(true); setError('');
    try {
      const { data: result } = await api.post('/ops/connections/canva/start');
      const destination = new URL(result.authorizationUrl);
      if (destination.protocol !== 'https:' || !['www.canva.com', 'canva.com'].includes(destination.hostname)) throw new Error('未取得有效的 Canva 授權網址，請檢查連線設定。');
      window.location.assign(destination.href);
    } catch (issue) { setError(humanError(issue)); setConnecting(false); }
  };
  return <Panel title="連接社團的 Canva 帳號" kicker="ACCOUNT CONNECTION">
    <p className="ops-muted">由管理顧問開始連線，在 Canva 頁面確認授權；完成後回到工作台，再處理等待中的設計工作。</p>
    {demo ? <p className="ops-note">互動展示不會開啟授權或連接外部帳號。</p> : <>
      <div className="ops-button-row" style={{ marginTop: 15 }}><ActionButton busy={connecting} reason={!isAdviser(data.actor) ? '由管理顧問連接社團帳號' : status && !status.configured ? '先完成伺服器的 Canva 應用程式設定' : !status ? '等待取得連線狀態' : ''} onClick={connect}>{connecting ? '前往 Canva…' : status?.connected ? '重新連接 Canva' : '連接 Canva'}</ActionButton><span className={`ops-badge ${status?.connected ? 'ops-badge-green' : 'ops-badge-amber'}`}>{status?.connected ? '帳號已連接' : status?.status === 'needs_reconnect' ? '需要重新授權' : status ? '尚未完成連線' : '檢查連線狀態'}</span></div>
      {status?.missing?.length > 0 && <p className="ops-footnote">尚缺設定：{status.missing.join('、')}</p>}
      {status?.staticTokenConfigured && !status.connected && <p className="ops-note">伺服器已有靜態 Token 設定。OAuth 帳號連線可提供持續更新的授權。</p>}
    </>}
    {error && <p className="ops-inline-error" role="alert">{error}</p>}
  </Panel>;
}

function Settings({ data, demo, busy, run, execute }) {
  const integrations = data.settings.integrations || {};
  const descriptions = { drafting: ['文案草稿', '活動資料、宣傳重點與合作要求 → 貼文與輪播文字。'], canva: ['Canva 分層設計', '核准的文案版本 → 新設計連結 → 行銷微調。'], sheets: ['Google 試算表', '保留原始來源；先預覽資料，再匯入工作流程。'] };
  return <><div className="ops-section-heading"><div><h2>系統連線與資料入口</h2><p className="ops-muted">連線狀態由伺服器回報；缺少設定的工作會停在待處理清單。</p></div></div><div className="ops-integration-grid">{Object.entries(descriptions).map(([key, [title, description]]) => {
    const item = integrations[key] || {}; const configured = item.configured === true || item.status === 'configured';
    return <article className="ops-integration" key={key}><div className="ops-item-line"><h3>{title}</h3><span className={`ops-badge ${configured ? 'ops-badge-blue' : 'ops-badge-amber'}`}>{data.settings.mode === 'demo' ? '展示模式' : configured ? '設定已提供' : '等待設定'}</span></div><p>{description}</p><p className="ops-note">{item.message || (configured ? '實際執行結果會記錄在工作清單。' : key === 'drafting' ? '未設定 AI 時可先使用規則草稿，仍需人工審核。' : '尚未具備完整連線設定。')}</p>{Array.isArray(item.missing) && item.missing.length > 0 && <details><summary>需要完成的設定</summary><ul>{item.missing.map(name => <li key={name}><code>{name}</code></li>)}</ul></details>}</article>;
  })}</div><div className="ops-permission-summary"><div><strong>文案終審</strong><span>{data.settings.approverConfigured === false ? '尚未指定帳號' : data.actor.canApprove ? '此帳號可核准當前版本' : '由指定終審帳號處理'}</span></div><div><strong>設計校對</strong><span>{data.settings.designerConfigured === false ? '尚未指定帳號' : data.actor.canDesign ? '此帳號可校對設計' : '由行銷負責人或顧問處理'}</span></div><div><strong>目前工作區</strong><span>{data.settings.mode === 'demo' ? '虛構資料 · 儲存在此瀏覽器' : '已連接後端 · 上線狀態依部署設定'}</span></div></div>
    <Panel title="自動工作佇列" kicker="BACKGROUND JOBS" action={<ActionButton tone="quiet small" busy={busy} reason={!isAdviser(data.actor) ? '由顧問處理工作' : ''} onClick={() => run('jobs.run', null, { limit: 3 })}>處理待辦工作</ActionButton>}>
      {data.jobs.length ? <div className="ops-jobs-table">{data.jobs.map(job => <div className="ops-job-card" key={job.id}><div><div className="ops-item-line"><strong>{data.posts.find(p => p.id === job.postId)?.title || '自動工作'}</strong><Badge value={job.status} type="job" /></div><p className="ops-muted">{job.type} · 文案 v{job.copyVersion} · 已嘗試 {job.attempts || 0} 次</p>{job.lastError && <p className="ops-job-error">{job.lastError}</p>}{job.status === 'needs_reconciliation' && <p className="ops-note">先到 Canva 核對是否已產生設計；若已有成果，回到該則宣傳登錄連結。避免直接重試造成重複。</p>}</div>{['failed', 'blocked_configuration'].includes(job.status) && <ActionButton tone="quiet small" busy={busy} reason={!isAdviser(data.actor) ? '由顧問重新排程' : ''} onClick={() => run('job.retry', job)}>重新排程</ActionButton>}</div>)}</div> : <p className="ops-note">產生文案或核准設計需求後，工作會顯示在這裡。</p>}
    </Panel><PeoplePanel data={data} demo={demo} busy={busy} execute={execute} /><CanvaConnection data={data} demo={demo} /><ImportPanel data={data} busy={busy} execute={execute} />
  </>;
}

export default function OpsPage({ demo = false }) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false); const [batchProgress, setBatchProgress] = useState(null);
  const [tab, setTab] = useState('overview'); const [notice, setNotice] = useState(null); const [loadError, setLoadError] = useState(''); const [dialog, setDialog] = useState(null); const [selectedPost, setSelectedPost] = useState('');
  const pending = useRef(new Map()); const mainRef = useRef(null); const dataRef = useRef(null); const busyRef = useRef(false);
  const updateData = next => { const normalized = normalize(next); normalized.settings = { ...normalized.settings, mode: demo ? 'demo' : 'live' }; dataRef.current = normalized; setData(normalized); };
  const refresh = useCallback(async () => {
    setLoadError('');
    try { const next = demo ? loadDemo() : (await api.get('/ops/bootstrap')).data; updateData(next); } catch (error) { setLoadError(humanError(error)); } finally { setLoading(false); }
  }, [demo]);
  useEffect(() => { setLoading(true); setData(null); refresh(); }, [refresh]);
  const go = nextTab => { setTab(nextTab); setNotice(null); requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true })); };
  const openPost = post => { setSelectedPost(post.id); go('posts'); };
  const openForm = (kind, record = null, defaults = {}) => setDialog({ type: kind === 'post' ? 'post' : 'record', kind, record, defaults });
  const execute = async (action, record, payload = {}) => {
    if (busyRef.current) throw new Error('上一個操作仍在處理，請稍候。');
    busyRef.current = true; setBusy(true); setNotice(null);
    const signature = JSON.stringify({ action, id: record?.id, expectedVersion: record?.version, payload });
    if (!pending.current.has(signature)) pending.current.set(signature, uuid());
    const command = { action, ...(record ? { id: record.id, expectedVersion: record.version } : {}), payload, idempotencyKey: pending.current.get(signature) };
    try {
      let result;
      if (demo) { const local = performDemoAction(dataRef.current, command); updateData(local.state); result = local.result; }
      else {
        result = (await api.post('/ops/actions', command)).data;
        if (!result.ok) throw new Error('伺服器尚未確認完成這次操作。');
        if (!['import.preview', 'import.sheet-preview', 'people.import-preview'].includes(action)) {
          try { updateData((await api.get('/ops/bootstrap')).data); }
          catch { setNotice({ type: 'warning', text: '伺服器已儲存這次操作，但清單尚未重新載入。請按「重新整理」取得最新版本。' }); pending.current.delete(signature); return result; }
        }
      }
      pending.current.delete(signature);
      if (!['import.preview', 'import.sheet-preview', 'people.import-preview'].includes(action)) {
        const draftPending = action === 'post.generate' && !demo && result.record?.status !== 'succeeded';
        setNotice(draftPending ? { type: 'warning', text: `文案工作已登錄，草稿尚未完成。${result.record?.lastError || '請查看自動工作紀錄。'}` } : { type: 'success', text: `${demo ? '示範資料已更新：' : '已完成：'}${ACTION_LABELS[action] || action}${action === 'post.generate' ? '。請查看草稿與工作結果。' : '。'}` });
      }
      if (action === 'post.create' && result.record?.id) setSelectedPost(result.record.id);
      return result;
    } catch (error) { setNotice({ type: 'error', text: humanError(error) }); throw error; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const run = (action, record, payload) => execute(action, record, payload).catch(noop);
  const batchGenerate = async () => {
    if (busyRef.current || batchRunning) return;
    const state = dataRef.current;
    const queue = state.posts.filter(post => post.stage === 'brief' && !post.caption && canOwn(state.actor, post, state.projects, state.people)).slice(0, 20);
    const progress = { total: queue.length, done: 0, failures: [], running: true };
    setBatchRunning(true); setBatchProgress({ ...progress });
    try {
      for (const original of queue) {
        try {
          const current = dataRef.current.posts.find(post => post.id === original.id);
          if (!current || current.stage !== 'brief') throw new Error('這筆需求已更新，請核對最新版本。');
          const result = await execute('post.generate', current);
          if (['failed', 'blocked_configuration', 'needs_reconciliation', 'obsolete'].includes(result.record?.status)) throw new Error(result.record.lastError || '草稿尚未產生，請查看工作紀錄。');
        } catch (error) { progress.failures.push({ title: original.title, message: humanError(error) }); }
        progress.done += 1; setBatchProgress({ ...progress, failures: [...progress.failures] });
      }
    } finally { setBatchRunning(false); setBatchProgress({ ...progress, running: false }); setNotice(null); }
  };
  const locked = busy || batchRunning;
  const pendingCount = useMemo(() => (data?.posts.filter(post => ['unit_review', 'approval', 'design_review', 'sponsor_review'].includes(post.stage)).length || 0) + (data?.tasks.filter(task => task.status === 'delivered').length || 0), [data]);
  return <div className="ops-root">
    <div className="ops-shell"><header className="ops-header"><div><div className="ops-brand-line"><span className="ops-brand-dot" aria-hidden="true" /><span>ITRC / OPERATIONS</span><span className={`ops-environment ${demo ? 'demo' : ''}`}>{demo ? '互動展示' : '幹部工作區'}</span></div><h1>社務工作台</h1><p>活動、宣傳與跨組交付，在同一個流程推進。</p></div><div className="ops-header-tools">{data?.actor && <div className="ops-identity"><span className="ops-avatar" aria-hidden="true">{data.actor.name?.[0] || '社'}</span><div><strong>{data.actor.name || '已登入幹部'}</strong><small>{data.actor.email}</small></div></div>}<button className="ops-button quiet small" disabled={locked || loading} onClick={refresh}>重新整理</button></div></header>
      {demo && <aside className="ops-demo-banner"><div><strong>這裡是虛構資料的操作展示</strong><p>可試填、送審與交件；資料只留在此瀏覽器，沒有呼叫 AI、Canva 或正式後端。</p></div>{data && <div className="ops-demo-controls"><label>體驗身分<select value={data.actor.email} disabled={locked} onChange={e => { try { updateData(changeDemoActor(data, e.target.value)); setNotice(null); } catch { setNotice({ type: 'error', text: '瀏覽器無法儲存展示資料，請檢查儲存空間設定。' }); } }}>{DEMO_ACTORS.map(actor => <option key={actor.email} value={actor.email}>{actor.name}</option>)}</select></label><button className="ops-text-button" disabled={locked} onClick={() => { if (window.confirm('重設此瀏覽器的虛構展示資料？正式系統不受影響。')) { try { updateData(resetDemo()); setSelectedPost(''); setNotice({ type: 'success', text: '已還原虛構展示資料。' }); } catch { setNotice({ type: 'error', text: '瀏覽器無法儲存展示資料。' }); } } }}>重設展示</button></div>}</aside>}
      <div className="ops-layout"><nav className="ops-sidebar" aria-label="社務工作台導覽"><div className="ops-nav-label">工作空間</div>{TABS.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => go(item.id)}><span className="ops-nav-mark">{item.mark}</span><span>{item.label}</span>{item.id === 'review' && pendingCount > 0 && <span className="ops-nav-count">{pendingCount}</span>}</button>)}<div className="ops-sidebar-note"><span>交接原則</span><p>資料先確認<br />文案逐版核准<br />交件留下證據</p></div></nav>
        <main className="ops-main" ref={mainRef} tabIndex={-1} aria-busy={locked || loading}>
          {notice && <div className={`ops-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button aria-label="關閉提示" onClick={() => setNotice(null)}>×</button></div>}
          {loadError && <div className="ops-load-error" role="alert"><h2>工作區暫時無法載入</h2><p>{loadError}</p><p>已開啟的表單內容會保留。請確認登入狀態與後端服務，再重新整理。</p><button className="ops-button primary" onClick={refresh}>重新載入</button>{!demo && <a className="ops-button quiet" href="/ops-demo">先看互動展示</a>}</div>}
          {loading ? <div className="ops-loading" role="status"><span /><h2>正在取得工作進度…</h2><p>載入活動、文案版本與待辦任務。</p></div> : data ? <>
            {tab === 'overview' && <Overview data={data} busy={locked} go={go} openForm={openForm} openPost={openPost} />}
            {tab === 'projects' && <Projects data={data} busy={locked} openForm={openForm} run={run} openPost={openPost} />}
            {tab === 'posts' && <Posts batchGenerate={batchGenerate} batchProgress={batchProgress} data={data} selectedId={selectedPost} setSelectedId={setSelectedPost} busy={locked} openForm={openForm} run={run} openAction={config => setDialog({ type: 'action', config })} />}
            {tab === 'tasks' && <Tasks data={data} busy={locked} openForm={openForm} run={run} openAction={config => setDialog({ type: 'action', config })} />}
            {tab === 'review' && <Reviews data={data} openPost={openPost} openForm={openForm} busy={locked} run={run} openAction={config => setDialog({ type: 'action', config })} />}
            {tab === 'settings' && <Settings data={data} demo={demo} busy={locked} run={run} execute={execute} />}
          </> : !loadError && <Empty title="工作區尚未準備好" detail="請重新整理或稍後再試。" />}
          <footer className="ops-workspace-footer"><span>ITRC 社務工作台</span><span>{demo ? '虛構展示資料 · 可重設' : '工作流程紀錄與官網內容分開管理'}</span></footer>
        </main>
      </div>
    </div>
    {dialog?.type === 'record' && <RecordForm key={`${dialog.kind}-${dialog.record?.id || 'new'}`} {...dialog} data={data} busy={locked} onClose={() => setDialog(null)} onSubmit={execute} />}
    {dialog?.type === 'post' && <PostForm key={dialog.record?.id || 'new-post'} {...dialog} data={data} busy={locked} onClose={() => setDialog(null)} onSubmit={execute} />}
    {dialog?.type === 'action' && <ActionForm config={dialog.config} busy={locked} onClose={() => setDialog(null)} onSubmit={execute} />}
  </div>;
}
