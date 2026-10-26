import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { opsApi as api } from '../api';
import { useAuth } from '../context/AuthContext';
import { ACTION_LABELS, CHANNELS, dateText, exportPostsCsv, isAdviser, taskProgress } from '../ops/model';
import { changeDemoActor, DEMO_ACTORS, loadDemo, performDemoAction, resetDemo } from '../ops/demo';
import { assignmentFormValue, assignmentOptions, assignmentPayload, isInactivePerson, ownerLabel } from '../ops/people';
import { ActionButton, Dialog, Empty, ExternalLink, Field, Panel, humanError } from '../ops/ui';
import WorkspaceSettings, { PeoplePanel, ImportPanel } from '../ops/WorkspaceSettings';
import ToolFrame, { CLUB_TOOLS, ToolDirectory } from '../ops/ClubTools';
import SourceChanges from '../ops/SourceChanges';
import './ops.css';

const uuid = () => globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2);
const noop = () => {};
const initialCollections = { projects: [], events: [], posts: [], tasks: [], obligations: [], jobs: [], audit: [], people: [], sourceChanges: [] };
const normalize = state => ({ ...initialCollections, ...state, settings: state.settings || { integrations: {} } });
const taskState = item => taskProgress(item) === 'cancelled' ? 'todo' : taskProgress(item);
const legacyTask = item => String(item.sourceKey || '').startsWith('firebase:boards/itrc:card:');
const postDone = post => ['completed', 'published'].includes(post.stage);
const postConfirmed = post => !!post.caption?.trim() && post.approvedVersion === post.copyVersion;
const postState = post => postDone(post) ? '已完成' : postConfirmed(post) ? '文案已確認' : '草稿';
const stateNames = { todo: '待辦', doing: '進行中', done: '完成' };
const stateOptions = Object.entries(stateNames).map(([value, label]) => ({ value, label }));
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
const fullName = (record, people) => ownerLabel(record, people).replace('待指派', '還沒分配');
const localDateTime = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const eventMissing = event => event.missingFacts || [!event.date && '日期', !event.venue && '地點', event.eventType !== 'activity' && !event.speaker && '講者'].filter(Boolean);

function SaveBar({ busy, close, label = '儲存' }) {
  return <div className="ops-dialog-actions"><button type="button" className="ops-button quiet" onClick={close} disabled={busy}>取消</button><button className="ops-button primary" disabled={busy}>{busy ? '儲存中…' : label}</button></div>;
}
function SimpleForm({ kind, record, defaults = {}, data, execute, busy, close }) {
  const [form, setForm] = useState(() => ({ title: '', status: kind === 'project' ? 'active' : 'todo', eventType: 'lecture', notes: '', ...defaults, ...record, ownerPersonId: assignmentFormValue(record || defaults), ...(kind === 'task' ? { status: taskState(record || defaults), notes: record?.notes || record?.blocker || record?.acceptanceCriteria || defaults.notes || '' } : {}) }));
  const [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const owners = [{ value: '', label: '還沒分配' }, ...assignmentOptions(data.people, record)];
  const fields = kind === 'task' ? ['title', 'dueDate', 'status', 'notes', 'deliverableUrl', 'eventId', 'projectId'] : kind === 'event' ? ['title', 'eventType', 'date', 'time', 'venue', 'speaker', 'highlights', 'registrationUrl', 'audience', 'fee', 'projectId'] : ['title', 'objective', 'dueDate', 'status'];
  const save = async e => {
    e.preventDefault(); setError('');
    const payload = Object.fromEntries(fields.map(key => [key, form[key] || '']));
    Object.assign(payload, assignmentPayload(form.ownerPersonId, record));
    try { await execute(kind + '.' + (record ? 'update' : 'create'), record, payload); close(); } catch (issue) { setError(humanError(issue)); }
  };
  return <Dialog title={(record ? '編輯' : '新增') + ({ task: '任務', event: '活動', project: '專案分組' }[kind])} onClose={busy ? noop : close} wide>
    <form onSubmit={save}><div className="ops-form-grid">
      <Field label={kind === 'task' ? '要做什麼？' : '名稱'} value={form.title} onChange={v => set('title', v)} required wide placeholder={kind === 'task' ? '例如：借教室、確認講師時間' : ''} />
      <Field label="誰負責" type="select" value={form.ownerPersonId} onChange={v => set('ownerPersonId', v)} options={owners} />
      {kind === 'task' ? <>
        <Field label="期限" type="date" value={form.dueDate} onChange={v => set('dueDate', v)} />
        <Field label="進度" type="select" value={form.status} onChange={v => set('status', v)} options={stateOptions} />
        <Field label="相關活動" type="select" value={form.eventId} onChange={v => set('eventId', v)} options={[{ value: '', label: '一般社務' }, ...data.events.map(item => ({ value: item.id, label: item.title }))]} />
        <Field label="備註" type="textarea" value={form.notes} onChange={v => set('notes', v)} wide placeholder="有需要再寫，完成後直接打勾即可。" />
        <Field label="成果或文件連結（選填）" type="url" value={form.deliverableUrl} onChange={v => set('deliverableUrl', v)} wide placeholder="https://" />
      </> : kind === 'event' ? <>
        <Field label="活動類型" type="select" value={form.eventType} onChange={v => set('eventType', v)} options={[{ value: 'lecture', label: '社課／講座' }, { value: 'activity', label: '競賽／參訪／其他活動' }]} />
        <Field label="日期" type="date" value={form.date} onChange={v => set('date', v)} />
        <Field label="時間" value={form.time} onChange={v => set('time', v)} placeholder="例如：16:10–18:10" />
        <Field label="地點" value={form.venue} onChange={v => set('venue', v)} />
        <Field label={form.eventType === 'activity' ? '帶領者（選填）' : '講者（可晚點補）'} value={form.speaker} onChange={v => set('speaker', v)} />
        <Field label="活動內容／宣傳重點" type="textarea" rows={4} value={form.highlights} onChange={v => set('highlights', v)} wide />
        <Field label="報名連結（選填）" type="url" value={form.registrationUrl} onChange={v => set('registrationUrl', v)} wide />
        <details className="ops-form-extra wide"><summary>其他資訊</summary><div className="ops-form-grid"><Field label="對象" value={form.audience} onChange={v => set('audience', v)} /><Field label="費用說明" value={form.fee} onChange={v => set('fee', v)} /></div></details>
      </> : <><Field label="說明" type="textarea" value={form.objective} onChange={v => set('objective', v)} wide /><Field label="期限" type="date" value={form.dueDate} onChange={v => set('dueDate', v)} /><Field label="狀態" type="select" value={form.status || 'active'} onChange={v => set('status', v)} options={[{ value: 'active', label: '進行中' }, { value: 'completed', label: '已完成' }]} /></>}
    </div>{error && <p className="ops-inline-error" role="alert">{error}</p>}<SaveBar busy={busy} close={close} /></form>
  </Dialog>;
}
function PostEditor({ post, event, data, execute, busy, close }) {
  const [form, setForm] = useState(() => ({ title: event.title + ' 宣傳', channel: 'instagram', purpose: '', audience: '', highlights: '', cta: '', caption: '', scheduledAt: '', slides: [], ...post, ownerPersonId: assignmentFormValue(post || {}) }));
  const [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async e => {
    e.preventDefault(); setError('');
    const payload = { title: form.title, eventId: event.id, channel: form.channel, purpose: form.purpose, audience: form.audience, highlights: form.highlights, cta: form.cta, caption: form.caption, slides: form.slides, scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : '', ...assignmentPayload(form.ownerPersonId, post) };
    try { await execute('post.' + (post ? 'update' : 'create'), post, payload); close(); } catch (issue) { setError(humanError(issue)); }
  };
  return <Dialog title={post ? '編輯文案' : '新增宣傳'} onClose={busy ? noop : close} wide><form onSubmit={save}>
    <div className="ops-form-grid"><Field label="這則宣傳的名稱" value={form.title} onChange={v => set('title', v)} required wide /><Field label="誰負責" type="select" value={form.ownerPersonId} onChange={v => set('ownerPersonId', v)} options={[{ value: '', label: '還沒分配' }, ...assignmentOptions(data.people, post)]} /><Field label="預計發文時間（選填）" type="datetime-local" value={localDateTime(form.scheduledAt)} onChange={v => set('scheduledAt', v)} /><Field label="宣傳重點" type="textarea" value={form.highlights} onChange={v => set('highlights', v)} wide /><Field label="文案" type="textarea" rows={9} value={form.caption} onChange={v => set('caption', v)} wide placeholder="可以直接寫，或建立後請 AI 協助。" /></div>
    <details className="ops-form-extra" open={form.slides.length > 0}><summary>輪播圖文字與其他資訊</summary><div className="ops-form-grid"><Field label="管道" type="select" value={form.channel} onChange={v => set('channel', v)} options={Object.entries(CHANNELS).map(([value, label]) => ({ value, label }))} /><Field label="希望讀者做什麼" value={form.cta} onChange={v => set('cta', v)} /></div><div className="ops-slide-editor">{form.slides.map((slide, index) => <div className="ops-simple-slide" key={index}><strong>第 {index + 1} 張</strong><Field label={'第 ' + (index + 1) + ' 張標題'} value={slide.heading} onChange={v => set('slides', form.slides.map((item, i) => i === index ? { ...item, heading: v } : item))} /><Field label={'第 ' + (index + 1) + ' 張內文'} type="textarea" value={slide.body} onChange={v => set('slides', form.slides.map((item, i) => i === index ? { ...item, body: v } : item))} /><button type="button" className="ops-text-button" onClick={() => set('slides', form.slides.filter((_, i) => i !== index))}>移除此頁</button></div>)}<button type="button" className="ops-button quiet small" disabled={form.slides.length >= 10} onClick={() => set('slides', [...form.slides, { heading: '', body: '' }])}>＋ 加一張輪播圖</button></div></details>
    {postConfirmed(post || {}) && <p className="ops-muted">改稿後會取消原本的文案確認，避免設計用到舊稿。</p>}{error && <p className="ops-inline-error" role="alert">{error}</p>}<SaveBar busy={busy} close={close} /></form></Dialog>;
}
function ActionForm({ config, busy, close, execute }) {
  const [form, setForm] = useState(config.defaults || {}); const [error, setError] = useState('');
  return <Dialog title={config.title} onClose={busy ? noop : close} wide>{config.description && <p className="ops-muted">{config.description}</p>}<form onSubmit={async e => { e.preventDefault(); setError(''); try { await execute(config.action, config.record, form); close(); } catch (issue) { setError(humanError(issue)); } }}><div className="ops-form-grid">{config.fields.map(field => <Field key={field.key} {...field} label={field.label} value={form[field.key]} onChange={v => setForm(old => ({ ...old, [field.key]: v }))} />)}</div>{error && <p className="ops-inline-error" role="alert">{error}</p>}<SaveBar busy={busy} close={close} label={config.submitLabel || config.button || '儲存'} /></form></Dialog>;
}
function AiHelper({ post, event, execute, busy, close }) {
  const [result, setResult] = useState(''); const [copied, setCopied] = useState(false); const [error, setError] = useState('');
  const publicFacts = { title: event.title, eventType: event.eventType || 'lecture', date: event.date || '待確認', time: event.time || '待確認', venue: event.venue || '待確認', speaker: event.speaker || (event.eventType === 'activity' ? '本活動未提供帶領者' : '待確認'), audience: event.audience || '', fee: event.fee || '待確認', registrationUrl: event.registrationUrl || '', highlights: event.highlights || '' };
  const prompt = ['請幫中山大學投資交易研究社寫繁體中文宣傳文案，口吻自然，適合學生。', '依下方資料撰寫。未確認的日期、時間、地點、講者、費用與報名連結必須保留「待確認」，不要自行補值。一般活動沒有講者不必提講者。', '只回傳 JSON：{"caption":"完整貼文","slides":[{"heading":"圖卡標題","body":"圖卡內文"}]}。輪播共三張，標題每張最多20字，內文每張最多100字。', '活動資料：' + JSON.stringify(publicFacts, null, 2), '這則宣傳：' + JSON.stringify({ title: post.title, purpose: post.purpose, highlights: post.highlights, audience: post.audience, cta: post.cta, channel: post.channel }, null, 2)].join('\n\n');
  const save = async e => {
    e.preventDefault(); setError('');
    try {
      let text = result.trim(); if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const draft = JSON.parse(text);
      if (typeof draft.caption !== 'string' || !draft.caption.trim() || draft.caption.length > 12000 || !Array.isArray(draft.slides) || draft.slides.length > 10 || draft.slides.some(slide => !slide || typeof slide.heading !== 'string' || typeof slide.body !== 'string' || slide.heading.length > 200 || slide.body.length > 2000)) throw new Error('請貼上含 caption 和 slides 的完整 JSON；也可以關閉後直接編輯文案。');
      await execute('post.update', post, { caption: draft.caption, slides: draft.slides.map(slide => ({ heading: slide.heading, body: slide.body })) }); close();
    } catch (issue) { setError(humanError(issue)); }
  };
  return <Dialog title="用你平常的 AI 寫文案" onClose={busy ? noop : close} wide><p className="ops-muted">把活動資料帶到你已連接的 AI，寫好貼回來就能繼續用。只包含這場活動與宣傳資料。</p><textarea className="ops-import-input" aria-label="給 AI 的活動資料" value={prompt} readOnly rows={6} /><button type="button" className="ops-button quiet" onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { setError('請直接選取上方文字複製。'); } }}>{copied ? '已複製' : '複製給 AI'}</button><form onSubmit={save}><Field label="貼回 AI 的 JSON 文案" type="textarea" rows={7} value={result} onChange={setResult} placeholder='{"caption":"…","slides":[…]}' wide />{error && <p className="ops-inline-error" role="alert">{error}</p>}<SaveBar busy={busy} close={close} label="存成文案草稿" /></form></Dialog>;
}
function TaskRow({ task, data, busy, run, edit, compact = false }) {
  const status = taskState(task); const overdue = status !== 'done' && task.dueDate && task.dueDate < today();
  return <article className={'club-task-row ' + (status === 'done' ? 'is-done' : '')}>
    <label className="club-task-check"><input type="checkbox" checked={status === 'done'} disabled={busy} onChange={() => run('task.set-status', task, { status: status === 'done' ? 'todo' : 'done' })} aria-label={(status === 'done' ? '取消完成：' : '完成：') + task.title} /><span aria-hidden="true">✓</span></label>
    <div className="club-task-content"><button className="club-task-title" onClick={() => edit('task', task)}>{task.title}</button><div className="club-task-meta"><span>{fullName(task, data.people)}</span>{task.dueDate && <span className={overdue ? 'club-overdue' : ''}>{dateText(task.dueDate)}{overdue ? ' · 已到期' : ''}</span>}{task.eventId && <span>{data.events.find(event => event.id === task.eventId)?.title}</span>}</div>{!compact && (task.notes || task.blocker || task.acceptanceCriteria) && <p className="ops-pre-line club-task-note">{task.notes || task.blocker || task.acceptanceCriteria}</p>}{!compact && <ExternalLink href={task.deliverableUrl}>成果／文件</ExternalLink>}</div>
    <select aria-label={task.title + '的進度'} className={'club-status-select ' + status} value={status} disabled={busy} onChange={e => run('task.set-status', task, { status: e.target.value })}>{stateOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
  </article>;
}
function Overview({ data, busy, run, edit, go, openEvent }) {
  const active = data.tasks.filter(task => task.status !== 'cancelled' && !legacyTask(task));
  const due = active.filter(task => taskState(task) !== 'done').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const events = data.events.filter(event => event.status !== 'done' && event.confirmationStatus !== 'cancelled').sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const drafts = data.posts.filter(post => !postDone(post));
  return <>
    <div className="club-page-heading"><div><h2>社團的事，一起做完。</h2><p>今天要做什麼、誰在處理，這裡就看得到。</p></div><button className="ops-button primary" disabled={busy} onClick={() => edit('task')}>＋ 新增任務</button></div>
    <div className="club-summary">{stateOptions.map(({ value, label }) => <button key={value} onClick={() => go('tasks')} className={'club-summary-card ' + value}><span>{label}</span><strong>{active.filter(task => taskState(task) === value).length}</strong><small>項任務</small></button>)}</div>
    <div className="club-home-columns"><Panel title="接下來要做" action={<button className="ops-text-button" onClick={() => go('tasks')}>全部任務 →</button>}>
      {due.length ? due.slice(0, 6).map(task => <TaskRow key={task.id} task={task} data={data} busy={busy} run={run} edit={edit} compact />) : <Empty title="目前沒有待辦" detail="想到什麼事，隨手加進來就好。" />}
    </Panel><Panel title="活動與宣傳" action={<button className="ops-text-button" onClick={() => go('activities')}>全部活動 →</button>}>
      {events.length ? events.slice(0, 5).map(event => <button className="club-upcoming" key={event.id} onClick={() => openEvent(event.id)}><span className="club-date-chip">{event.date ? event.date.slice(5).replace('-', '/') : '待定'}</span><span><strong>{event.title}</strong><small>{fullName(event, data.people)} · {data.posts.filter(post => post.eventId === event.id && !postDone(post)).length} 則宣傳處理中</small></span><span>→</span></button>) : <Empty title="還沒有活動" detail="新增活動後，文案和 Canva 連結會放在同一張卡。" />}
      {drafts.length > 0 && <p className="club-soft-note">還有 {drafts.length} 則宣傳可接著處理。</p>}
    </Panel></div>
    <div className="club-shortcuts"><button onClick={() => go('finance')}><span>＄</span><strong>核銷與財務</strong><small>申請、簽核、帳本</small></button><button onClick={() => go('tools')}><span>↗</span><strong>各組工具</strong><small>公關、講師、證書都在這裡</small></button><button onClick={() => go('people')}><span>☷</span><strong>幹部名單</strong><small>{data.people.filter(person => person.status === 'active').length} 位現任幹部</small></button></div>
  </>;
}
function Tasks({ data, busy, run, edit, source, setSource }) {
  const [query, setQuery] = useState(''); const [owner, setOwner] = useState(''); const [filter, setFilter] = useState('open'); const [eventId, setEventId] = useState('');
  const list = data.tasks.filter(task => task.status !== 'cancelled' && (source === 'all' || (source === 'legacy' ? legacyTask(task) : !legacyTask(task))) && (!query || (task.title + ' ' + (task.notes || '')).toLowerCase().includes(query.toLowerCase())) && (!owner || task.ownerPersonId === owner) && (!eventId || task.eventId === eventId) && (filter === 'all' || (filter === 'done' ? taskState(task) === 'done' : taskState(task) !== 'done'))).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  return <><div className="club-page-heading"><div><h2>任務</h2><p>填誰負責、什麼時候做，做完打勾。</p></div><button className="ops-button primary" disabled={busy} onClick={() => edit('task')}>＋ 新增任務</button></div><div className="club-filters"><select aria-label="任務來源" value={source} onChange={e => setSource(e.target.value)}><option value="current">目前任務</option><option value="legacy">舊看板任務</option><option value="all">所有任務</option></select><input aria-label="搜尋任務" placeholder="找任務…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="依負責人篩選" value={owner} onChange={e => setOwner(e.target.value)}><option value="">所有人</option>{data.people.filter(person => !isInactivePerson(person)).map(person => <option value={person.personId} key={person.personId}>{person.name}</option>)}</select><select aria-label="依活動篩選" value={eventId} onChange={e => setEventId(e.target.value)}><option value="">所有活動</option>{data.events.map(event => <option value={event.id} key={event.id}>{event.title}</option>)}</select><div className="ops-segment">{[['open', '待處理'], ['done', '已完成'], ['all', '全部']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div></div><section className="club-task-board">{list.length ? list.map(task => <TaskRow key={task.id} task={task} data={data} busy={busy} run={run} edit={edit} />) : <Empty title="這裡目前沒有任務" detail="換個篩選條件，或新增一件事。" />}</section></>;
}
function PostCard({ post, event, data, busy, run, execute, editor, ai, complete }) {
  const [url, setUrl] = useState(post.canvaEditUrl || ''); const [localError, setLocalError] = useState('');
  useEffect(() => setUrl(post.canvaEditUrl || ''), [post.canvaEditUrl]);
  const confirmed = postConfirmed(post); const done = postDone(post);
  const canvaAvailable = data.settings.integrations?.canva?.configured === true;
  return <article className={'club-post ' + (done ? 'is-done' : '')}><div className="ops-item-line"><div><span className="ops-kicker">{CHANNELS[post.channel] || '宣傳'}</span><h3>{post.title}</h3></div><span className={'ops-badge ops-badge-' + (done || confirmed ? 'green' : 'neutral')}>{postState(post)}</span></div>
    <div className="club-post-meta"><span>{fullName(post, data.people)}</span>{post.scheduledAt && <span>預計 {dateText(post.scheduledAt)}</span>}</div>
    {post.caption ? <p className="club-caption">{post.caption}</p> : <p className="club-caption-placeholder">還沒有文案。可以直接寫，或請 AI 協助整理。</p>}
    {post.slides?.length > 0 && <details className="club-slide-details"><summary>輪播圖文字 · {post.slides.length} 張</summary><div className="ops-slide-preview"><div>{post.slides.map((slide, index) => <article key={index}><span className="ops-slide-number">{index + 1}</span><h4>{slide.heading}</h4><p>{slide.body}</p></article>)}</div></div></details>}
    <div className="club-post-buttons">{!done && <><button className="ops-button quiet small" onClick={() => editor(post, event)} disabled={busy}>編輯文案</button><button className="ops-button quiet small" onClick={() => ai(post, event)} disabled={busy}>用我的 AI</button>{!post.caption && <button className="ops-text-button" disabled={busy} onClick={() => run('post.generate', post)}>先整理基本草稿</button>}{post.caption && <button className={'ops-button small ' + (confirmed ? 'quiet' : 'primary')} disabled={busy} onClick={() => run(confirmed ? 'post.unconfirm' : 'post.confirm', post)}>{confirmed ? '取消文案確認' : '文案 OK'}</button>}</>}{done && post.stage !== 'published' && <button className="ops-button quiet small" disabled={busy} onClick={() => run('post.unconfirm', post)}>繼續修改</button>}</div>
    <div className="club-canva-area"><div className="ops-item-line"><strong>Canva 設計</strong>{post.canvaEditUrl && <ExternalLink href={post.canvaEditUrl}>開啟編輯</ExternalLink>}</div>{!done && <form className="club-link-form" onSubmit={async e => { e.preventDefault(); setLocalError(''); try { await execute('post.attach-design', post, { canvaEditUrl: url.trim() }); } catch (issue) { setLocalError(humanError(issue)); } }}><input aria-label={post.title + '的 Canva 編輯連結'} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="貼上 Canva 編輯連結" required /><button className="ops-button quiet small" disabled={busy}>儲存連結</button></form>}{!done && canvaAvailable && <button className="ops-button quiet small" disabled={busy || !confirmed} onClick={() => run('post.request-design', post)}>用已確認文案產生設計</button>}{localError && <p className="ops-inline-error">{localError}</p>}</div>
    <div className="club-post-finish">{post.publishedUrl ? <ExternalLink href={post.publishedUrl}>查看已發布內容</ExternalLink> : <span className="ops-muted">{done ? '已記錄完成。' : '文案和設計弄好後，按完成即可。'}</span>}{!done && <button className="ops-button primary small" disabled={busy || !post.caption?.trim()} onClick={() => complete(post)}>確認完成 ✓</button>}</div>
    {(data.jobs || []).filter(job => job.postId === post.id && job.copyVersion === post.copyVersion && ['failed', 'blocked_configuration', 'needs_reconciliation'].includes(job.status)).map(job => <p key={job.id} className="ops-note">{job.lastError || '這次自動處理還沒完成，可先直接編輯或貼上設計連結。'}</p>)}
  </article>;
}
function Activities({ data, busy, run, execute, edit, selectedId, select, editor, ai, complete, showImport }) {
  const [query, setQuery] = useState('');
  const events = [...data.events].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')).filter(event => !query || event.title.toLowerCase().includes(query.toLowerCase()));
  const selected = events.find(event => event.id === selectedId) || events[0];
  return <><div className="club-page-heading"><div><h2>活動與宣傳</h2><p>活動資料、文案、Canva，放在同一張卡。</p></div><div className="ops-button-row"><button className="ops-button quiet" onClick={showImport}>匯入學期表</button><button className="ops-button primary" disabled={busy} onClick={() => edit('event')}>＋ 新增活動</button></div></div>
    {!data.events.length ? <Empty title="先加第一場活動" detail="名稱先填就好，其他資訊可以慢慢補。"><button className="ops-button primary" onClick={() => edit('event')}>新增活動</button></Empty> : <div className="club-activity-layout"><aside className="club-activity-list"><input aria-label="搜尋活動" placeholder="找活動…" value={query} onChange={e => setQuery(e.target.value)} />{events.map(event => <button key={event.id} className={'club-activity-choice ' + (selected?.id === event.id ? 'active' : '')} onClick={() => select(event.id)}><span>{event.date ? dateText(event.date) : '日期待定'}{event.status === 'done' ? ' · 已完成' : ''}</span><strong>{event.title}</strong><small>{fullName(event, data.people)}</small></button>)}</aside><div className="club-activity-detail">{selected ? <>
      <section className="club-event-card"><div className="ops-item-line"><span className="ops-kicker">{selected.eventType === 'activity' ? '活動' : '社課／講座'}</span><button className="ops-button quiet small" disabled={busy} onClick={() => edit('event', selected)}>編輯活動</button></div><h2>{selected.title}</h2><div className="club-event-facts"><span>日期 <strong>{selected.date ? dateText(selected.date) : '待補'}</strong></span><span>時間 <strong>{selected.time || '待補'}</strong></span><span>地點 <strong>{selected.venue || '待補'}</strong></span>{(selected.speaker || selected.eventType !== 'activity') && <span>講者 <strong>{selected.speaker || '待補'}</strong></span>}<span>負責 <strong>{fullName(selected, data.people)}</strong></span></div>{selected.highlights && <p className="ops-pre-line club-event-description">{selected.highlights}</p>}<ExternalLink href={selected.registrationUrl}>報名連結</ExternalLink>{eventMissing(selected).length > 0 && <p className="club-soft-note">還可補上：{eventMissing(selected).join('、')}。現在也能先安排任務、寫文案。</p>}<div className="club-event-bottom"><ExternalLink href={selected.sourceUrl}>原始資料</ExternalLink><button className={'ops-button small ' + (selected.status === 'done' ? 'quiet' : 'primary')} disabled={busy} onClick={() => run('event.set-status', selected, { status: selected.status === 'done' ? 'todo' : 'done' })}>{selected.status === 'done' ? '已完成 ✓ · 改回待辦' : '活動已完成 ✓'}</button></div></section>
      <div className="club-subheading"><h3>宣傳</h3><button className="ops-button quiet small" disabled={busy} onClick={() => editor(null, selected)}>＋ 加一則宣傳</button></div>{data.posts.filter(post => post.eventId === selected.id).map(post => <PostCard key={post.id} post={post} event={selected} data={data} busy={busy} run={run} execute={execute} editor={editor} ai={ai} complete={complete} />)}{!data.posts.some(post => post.eventId === selected.id) && <Empty title="這場活動還沒有宣傳" detail="新增一則，把文案和 Canva 連結放在一起。" />}
      <Panel title="這場活動的任務" action={<button className="ops-text-button" onClick={() => edit('task', null, { eventId: selected.id, projectId: selected.projectId || '' })}>＋ 加一件事</button>}>{data.tasks.filter(task => task.eventId === selected.id && task.status !== 'cancelled').map(task => <TaskRow key={task.id} task={task} data={data} busy={busy} run={run} edit={edit} compact />)}{!data.tasks.some(task => task.eventId === selected.id && task.status !== 'cancelled') && <p className="ops-muted">需要分工時再加，沒有也可以。</p>}</Panel>
    </> : <Empty title="找不到這個活動" detail="試試其他關鍵字。" />}</div></div>}
  </>;
}

export default function OpsPage({ demo = false }) {
  const auth = useAuth(); const [params, setParams] = useSearchParams();
  const toolId = params.get('tool'); const view = toolId ? toolId : params.get('view') || 'overview';
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null); const [loadError, setLoadError] = useState(''); const [dialog, setDialog] = useState(null);
  const dataRef = useRef(null); const busyRef = useRef(false); const pending = useRef(new Map()); const mainRef = useRef(null);
  const updateData = next => { const value = normalize(next); value.settings = { ...value.settings, mode: demo ? 'demo' : 'live' }; dataRef.current = value; setData(value); };
  const refresh = useCallback(async () => { setLoadError(''); try { updateData(demo ? loadDemo() : (await api.get('/ops/bootstrap')).data); } catch (error) { setLoadError(humanError(error)); } finally { setLoading(false); } }, [demo]);
  useEffect(() => { setLoading(true); setData(null); refresh(); }, [refresh]);
  const go = next => { setNotice(null); setParams(next === 'overview' ? {} : CLUB_TOOLS.some(tool => tool.id === next) ? { tool: next } : { view: next }); requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true })); };
  const openEvent = id => { setParams({ view: 'activities', event: id }); setNotice(null); };
  const edit = (kind, record = null, defaults = {}) => setDialog({ type: 'record', kind, record, defaults });
  const execute = async (action, record, payload = {}) => {
    if (busyRef.current) throw new Error('正在儲存上一個操作，請稍候。');
    busyRef.current = true; setBusy(true); setNotice(null);
    const signature = JSON.stringify({ action, id: record?.id, version: record?.version, payload });
    if (!pending.current.has(signature)) pending.current.set(signature, uuid());
    const command = { action, ...(record ? { id: record.id, expectedVersion: record.version } : {}), payload, idempotencyKey: pending.current.get(signature) };
    try {
      let result; let refreshed = true;
      if (demo) { const local = performDemoAction(dataRef.current, command); updateData(local.state); result = local.result; }
      else { result = (await api.post('/ops/actions', command)).data; if (!result.ok) throw new Error('還沒收到儲存成功的確認，請稍後再試。'); if (!action.endsWith('preview') && action !== 'event.preview-checklist') { try { updateData((await api.get('/ops/bootstrap')).data); } catch { refreshed = false; setNotice({ type: 'warning', text: '已儲存，清單暫時無法更新。請按重新整理。' }); } } }
      pending.current.delete(signature);
      if (refreshed && !action.endsWith('preview') && action !== 'event.preview-checklist') setNotice({ type: 'success', text: (demo ? '練習資料已更新。' : '已儲存。') });
      if (action === 'event.create' && result.record?.id) openEvent(result.record.id);
      return result;
    } catch (error) { setNotice({ type: 'error', text: humanError(error) }); throw error; } finally { busyRef.current = false; setBusy(false); }
  };
  const run = (action, record, payload) => execute(action, record, payload).catch(noop);
  const completePost = async post => {
    try { let current = dataRef.current.posts.find(item => item.id === post.id); if (!postConfirmed(current)) { const result = await execute('post.confirm', current); current = result.record || dataRef.current.posts.find(item => item.id === post.id); } await execute('post.complete', current); } catch { /* The action banner retains the failure. */ }
  };
  const navigation = [{ id: 'overview', icon: '⌂', label: '總覽' }, { id: 'activities', icon: '▦', label: '活動與宣傳' }, { id: 'tasks', icon: '✓', label: '任務' }, { id: 'finance', icon: '＄', label: '核銷與財務' }, { id: 'tools', icon: '↗', label: '各組工具' }, { id: 'people', icon: '☷', label: '幹部名單' }];
  const management = data && isAdviser(data.actor);
  return <div className="ops-root club-workspace"><div className="ops-shell"><header className="club-header"><a href="/" className="club-brand"><span>ITRC</span><div><strong>社團工作台</strong><small>中山大學投資交易研究社</small></div></a><div className="club-header-right">{demo ? <span className="ops-badge ops-badge-amber">練習版</span> : data?.actor && <span>{data.actor.name || '已登入幹部'}</span>}<button className="ops-button quiet small" disabled={busy || loading} onClick={refresh}>重新整理</button>{!demo && <button className="ops-text-button" onClick={auth.logout}>登出</button>}</div></header>
    {demo && <aside className="ops-demo-banner"><div><strong>這裡可以放心練習</strong><p>使用虛構資料，不會改到正式活動、帳目或外部服務。</p></div>{data && <div className="ops-demo-controls"><select aria-label="練習身分" value={data.actor.email} disabled={busy} onChange={e => { try { updateData(changeDemoActor(data, e.target.value)); } catch { setNotice({ type: 'error', text: '瀏覽器無法儲存練習資料。' }); } }}>{DEMO_ACTORS.map(actor => <option key={actor.email} value={actor.email}>{actor.name}</option>)}</select><button className="ops-text-button" disabled={busy} onClick={() => { if (window.confirm('重設這裡的虛構練習資料？')) { updateData(resetDemo()); setDialog(null); go('overview'); } }}>重新練習</button></div>}</aside>}
    <div className="ops-layout"><nav className="ops-sidebar club-sidebar" aria-label="社團工作台導覽">{navigation.map(item => <button key={item.id} className={view === item.id || (item.id === 'tools' && toolId && toolId !== 'finance') ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => go(item.id)}><span className="club-nav-icon" aria-hidden="true">{item.icon}</span>{item.label}</button>)}{management && <button className={'club-settings-link ' + (view === 'settings' ? 'active' : '')} onClick={() => go('settings')}><span className="club-nav-icon" aria-hidden="true">⚙</span>管理與設定</button>}<div className="club-sidebar-footer"><a href="/">回官網 ↗</a><a href={demo ? '/ops' : '/ops-demo'}>{demo ? '正式工作台' : '操作練習'}</a></div></nav>
      <main className="ops-main" ref={mainRef} tabIndex={-1} aria-busy={busy || loading}>{notice && <div className={'ops-notice ' + notice.type} role={notice.type === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button aria-label="關閉提示" onClick={() => setNotice(null)}>×</button></div>}{loadError && <div className="ops-load-error" role="alert"><h2>暫時載入不了</h2><p>{loadError}</p><button className="ops-button primary" onClick={refresh}>重新載入</button></div>}{loading ? <div className="ops-loading" role="status"><span /><h2>正在載入社團進度…</h2></div> : data && <>
        {view === 'overview' && <Overview data={data} busy={busy} run={run} edit={edit} go={go} openEvent={openEvent} />}
        {view === 'tasks' && <Tasks data={data} busy={busy} run={run} edit={edit} source={['all', 'legacy'].includes(params.get('source')) ? params.get('source') : 'current'} setSource={source => setParams({ view: 'tasks', source })} />}
        {view === 'activities' && <Activities data={data} busy={busy} run={run} execute={execute} edit={edit} selectedId={params.get('event')} select={openEvent} editor={(post, event) => setDialog({ type: 'post', post, event })} ai={(post, event) => setDialog({ type: 'ai', post, event })} complete={completePost} showImport={() => setDialog({ type: 'import' })} />}
        {view === 'tools' && <><div className="club-page-heading"><div><h2>各組工具</h2><p>都在同一個網站，開了就能接著做。</p></div></div><ToolDirectory onOpen={go} demo={demo} /></>}
        {CLUB_TOOLS.some(tool => tool.id === view) && <ToolFrame toolId={view} demo={demo} onOpen={go} />}
        {view === 'people' && <><div className="club-page-heading"><div><h2>幹部名單</h2><p>找人、看分工，聯絡資料沿用原主表。</p></div>{management && <button className="ops-button quiet" onClick={() => go('permissions')}>管理登入權限</button>}</div><PeoplePanel data={data} busy={busy} execute={execute} demo={demo} /></>}
        {view === 'settings' && management && <><WorkspaceSettings data={data} demo={demo} busy={busy} run={run} execute={execute} /><details className="club-management-details"><summary>原始資料更新與紀錄</summary><SourceChanges data={data} busy={busy} execute={execute} openAction={config => setDialog({ type: 'action', config })} /></details><details className="club-management-details"><summary>操作紀錄與資料匯出</summary><button className="ops-button quiet small" onClick={() => exportPostsCsv(data)}>匯出宣傳資料</button><div className="club-audit-list">{data.audit.slice(-30).reverse().map((item, i) => <p key={item.id || i}><time>{dateText(item.createdAt || item.at)}</time> {ACTION_LABELS[item.action] || item.action} {item.actorName || ''}</p>)}</div></details></>}
        {view === 'settings' && !management && <Empty title="管理者設定" detail="日常任務與活動可以直接從左邊開始。" />}
      </>}<footer className="ops-workspace-footer"><span>ITRC 社團工作台</span><span>{demo ? '虛構練習資料' : '有事加進來，做完打勾。'}</span></footer></main>
    </div></div>
    {dialog?.type === 'record' && <SimpleForm key={dialog.kind + '-' + (dialog.record?.id || 'new')} {...dialog} data={data} execute={execute} busy={busy} close={() => setDialog(null)} />}
    {dialog?.type === 'post' && <PostEditor key={dialog.post?.id || 'new-post'} {...dialog} data={data} execute={execute} busy={busy} close={() => setDialog(null)} />}
    {dialog?.type === 'ai' && <AiHelper {...dialog} execute={execute} busy={busy} close={() => setDialog(null)} />}
    {dialog?.type === 'action' && <ActionForm config={dialog.config} execute={execute} busy={busy} close={() => setDialog(null)} />}
    {dialog?.type === 'import' && <Dialog title="帶入學期表" onClose={busy ? noop : () => setDialog(null)} wide><ImportPanel data={data} busy={busy} execute={execute} /></Dialog>}
  </div>;
}
