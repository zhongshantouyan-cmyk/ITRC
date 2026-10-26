import { useEffect, useState } from 'react';
import { opsApi as api } from '../api';
import { isAdviser, parseImportText } from './model';
import { PERSON_STATES, isInactivePerson, ownerLabel, personById } from './people';
import { ActionButton, Badge, ExternalLink, Panel, humanError } from './ui';
function downloadTemplate(kind) {
  const samples = {
    events: '標題,講者,日期,時間,地點,對象,費用,報名連結,宣傳重點,負責人信箱,來源網址,來源版本,來源鍵\r\n示範交流工作坊,示範講者,2026-11-30,18:30,示範教室,同學,免費,https://example.org/register,請替換為正式活動重點,,,草稿 v1,event-example-01\r\n',
    posts: '宣傳名稱,活動ID,活動來源鍵,宣傳目的,宣傳對象,宣傳重點,希望採取行動,發布管道,預計發布時間,負責人信箱,來源鍵\r\n工作坊首波宣傳,,,介紹活動並邀請報名,初次參與的同學,帶走一份自己的研究草稿,查看資訊並報名,instagram,2026-11-20T12:00:00+08:00,,post-example-01\r\n',
    tasks: '標題,負責人ID,截止日期,備註,來源網址,來源鍵\r\n示範器材測試,,2026-11-28,確認投影與錄影設備可用,,task-example-01\r\n',
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
    <p className="ops-muted">一列一則宣傳，整學期可以一次整理。下載範本填寫並另存 CSV，或直接貼上試算表的欄列；先看一下預覽，再匯入。</p>
    {data.settings.sources?.length > 0 && <div className="ops-sheet-source"><label htmlFor="ops-sheet-source">已連接的來源表</label><select id="ops-sheet-source" value={sourceId} onChange={e => setSourceId(e.target.value)}>{data.settings.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select><ActionButton tone="quiet small" busy={busy} reason={!isAdviser(data.actor) ? '由顧問讀取來源表' : ''} onClick={readSheet}>讀取並預覽</ActionButton><ExternalLink href={data.settings.sources.find(source => source.id === sourceId)?.url}>開啟來源</ExternalLink></div>}
    <div className="ops-import-controls"><label>資料類型<select value={kind} onChange={e => { setKind(e.target.value); clearPreview(); }}><option value="posts">宣傳需求（一列一則）</option><option value="events">活動資料</option><option value="tasks">任務</option></select></label><button className="ops-button quiet small" onClick={() => downloadTemplate(kind)}>下載 CSV 範本</button><label className="ops-file-label">選擇 CSV／TSV／JSON<input type="file" accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 512000) { setError('請使用 500 KB 以內的檔案，或分批匯入。'); return; } try { change(await file.text()); setSourceLabel(file.name); } catch { setError('檔案無法讀取，請重新選擇。'); } e.target.value = ''; }} /></label></div>
    <div className="ops-import-default"><label htmlFor="ops-import-source-label">來源檔名／資料標記</label><input id="ops-import-source-label" value={sourceLabel} onChange={e => { setSourceLabel(e.target.value); clearPreview(); }} placeholder="例如：115-1 宣傳需求表.csv" /><small>沒有來源網址時，保留原始檔名以便追溯。重複匯入請保留相同來源鍵。</small></div>
    {kind === 'posts' && <div className="ops-import-default"><label htmlFor="ops-import-event">活動欄空白時，使用這個活動</label><select id="ops-import-event" value={defaultEvent} onChange={e => { setDefaultEvent(e.target.value); clearPreview(); }}><option value="">每列自行填活動 ID／活動來源鍵</option>{data.events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select><small>多個活動的學期資料，請在各列填「活動 ID」或「活動來源鍵」。同一活動的多則宣傳可用這裡一次指定。</small></div>}
    <label className="ops-import-label" htmlFor="ops-import-text">貼上含標題列的表格資料</label><textarea id="ops-import-text" className="ops-import-input" rows={6} value={input} onChange={e => change(e.target.value)} placeholder={kind === 'posts' ? '宣傳名稱\t宣傳重點\t希望採取行動\t發布管道\n首波宣傳\t活動重點\t完成報名\tinstagram' : '標題\t講者\t日期\t地點\t宣傳重點\n範例活動\t講者\t2026-11-30\t教室\t活動重點'} />
    <p className="ops-footnote">支援中英文欄名、逗號或 Tab 分隔；每次最多 200 筆。日期用 YYYY-MM-DD；發布時間建議附 +08:00。管道填 instagram、story 或 announcement。原生 .xlsx 請先另存 CSV。原試算表不會被改寫。</p>
    <div className="ops-button-row"><ActionButton tone="quiet" busy={busy} reason={!isAdviser(data.actor) ? '由管理顧問檢查並匯入' : !input.trim() ? '先選擇檔案或貼上表格' : ''} onClick={validate}>檢查與預覽</ActionButton>{staged && <ActionButton busy={busy} reason={!isAdviser(data.actor) ? '由管理顧問確認匯入' : ''} onClick={apply}>確認匯入 {previewRows.length} 筆資料</ActionButton>}</div>
    {error && <p className="ops-inline-error" role="alert">{error}</p>}
    {preview && <div className="ops-import-preview"><div className="ops-item-line"><strong>預覽通過 · {previewRows.length} 筆</strong><span className="ops-badge ops-badge-amber">尚未寫入</span></div><p>活動與宣傳會先建立為草稿，原資料不會改寫。相同來源鍵會由伺服器檢查重複。</p><div className="ops-table-scroll"><table><thead><tr><th>標題</th><th>日期／預計發布</th><th>負責人</th><th>關聯活動</th></tr></thead><tbody>{previewRows.slice(0, 10).map((row, i) => <tr key={i}><td>{row.title}</td><td>{row.date || row.dueDate || row.scheduledAt || '待補'}</td><td>{ownerLabel(row, data.people)}</td><td>{data.events.find(event => event.id === row.eventId)?.title || row.eventSourceKey || row.sourceRevision || '—'}</td></tr>)}</tbody></table></div>{previewRows.length > 10 && <p className="ops-footnote">先顯示前 10 筆；確認後會送出完整 {previewRows.length} 筆。</p>}{Array.isArray(preview.warnings) && preview.warnings.length > 0 && <p className="ops-note">{preview.warnings.map(w => typeof w === 'string' ? w : w.message || JSON.stringify(w)).join('；')}</p>}</div>}
  </Panel>;
}

const PEOPLE_FIELDS = { personId: '幹部 ID', name: '姓名', title: '職稱', group: '組別', email: 'MAIL', lineName: 'LINE 名稱', term: '任期', status: '在任狀態', sourceUrl: '名單來源', sourceRevision: '來源版本', contactSourceUrl: '聯絡資料來源' };
const PERSON_CHANGE = { create: '新增', update: '更新', unchanged: '未變更' };
function PeoplePanel({ data, busy, execute, demo }) {
  const [showArchived, setShowArchived] = useState(false);
  const visiblePeople = data.people.filter(person => showArchived || !isInactivePerson(person));
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
    <div className="ops-source-line"><ExternalLink href="https://nsysu-itrc.vercel.app/">官網幹部名單</ExternalLink><ExternalLink href="https://docs.google.com/spreadsheets/d/1K7byAc1JhpcinOHSDnGEGfwy0kzfTnMB4U-neTjKMKg/edit">開啟幹部主表</ExternalLink><span>{data.people.filter(person => person.status === 'active').length} 位在任 · {data.people.filter(isInactivePerson).length} 筆歷史對照{demo ? ' · 虛構示範' : ''}</span></div>
    <label className="ops-checkbox"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />顯示已卸任／非當期的歷史人員</label>
    {data.people.length ? <div className="ops-table-scroll"><table className="ops-people-table"><caption className="ops-sr-only">內部幹部名單與聯絡資料</caption><thead><tr><th>姓名／固定 ID</th><th>職稱／組別</th><th>MAIL／LINE</th><th>任期／狀態</th></tr></thead><tbody>{visiblePeople.map(person => <tr key={person.personId}><td><strong>{person.name}</strong><small>{person.personId}</small></td><td>{person.title || '職稱待確認'}<small>{person.group || '組別待確認'}</small></td><td>{person.email || 'MAIL 待補'}<small>LINE：{person.lineName || '待補'}</small></td><td>{person.term || '任期待確認'}<small>{PERSON_STATES[person.status] || person.status || '待確認'}</small></td></tr>)}</tbody></table></div> : <p className="ops-note">尚未帶入人員對照。既有活動與任務會保留，新增工作可以先維持待指派。</p>}
    <details className="ops-people-import"><summary>預覽並更新幹部對照</summary>
      <p className="ops-note">先在主表核對官網名單，再貼上包含欄位名稱的資料。此處更新工作台的人員對照，不會授予新的登入或財務權限。已卸任／非當期帳號會停用工作台存取，歷史紀錄仍保留；其他平台角色需另行撤銷。</p>
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
  const descriptions = { drafting: ['文案草稿', '活動資料、宣傳重點與合作要求 → 貼文與輪播文字。'], canva: ['Canva 分層設計', '文案確認後產生可編輯設計，再由行銷微調。'], sheets: ['Google 試算表', '保留原始來源；先預覽資料，再匯入工作流程。'] };
  return <><div className="ops-section-heading"><div><h2>系統連線與資料入口</h2><p className="ops-muted">連線狀態由伺服器回報；缺少設定的工作會停在待處理清單。</p></div></div><div className="ops-integration-grid">{Object.entries(descriptions).map(([key, [title, description]]) => {
    const item = integrations[key] || {}; const configured = item.configured === true || item.status === 'configured';
    return <article className="ops-integration" key={key}><div className="ops-item-line"><h3>{title}</h3><span className={`ops-badge ${configured ? 'ops-badge-blue' : 'ops-badge-amber'}`}>{data.settings.mode === 'demo' ? '展示模式' : configured ? '設定已提供' : '等待設定'}</span></div><p>{description}</p><p className="ops-note">{item.message || (configured ? '實際執行結果會記錄在工作清單。' : key === 'drafting' ? '可先整理基本草稿，或用你已連接的 AI 協助寫文案。' : '尚未具備完整連線設定。')}</p>{Array.isArray(item.missing) && item.missing.length > 0 && <details><summary>需要完成的設定</summary><ul>{item.missing.map(name => <li key={name}><code>{name}</code></li>)}</ul></details>}</article>;
  })}</div>
    <Panel title="自動工作佇列" kicker="BACKGROUND JOBS" action={<ActionButton tone="quiet small" busy={busy} reason={!isAdviser(data.actor) ? '由顧問處理工作' : ''} onClick={() => run('jobs.run', null, { limit: 3 })}>處理待辦工作</ActionButton>}>
      <p className="ops-note">{data.settings.githubSchedulerConfigured ? '正式環境已設定每 15 分鐘檢查已排入的工作。實際觸發可能延遲；缺少服務設定的項目會停止，排程不代替任何人工核准。' : '可由管理者處理已排入的工作；背景排程狀態依正式環境設定。'}</p>
      {data.jobs.length ? <div className="ops-jobs-table">{data.jobs.map(job => <div className="ops-job-card" key={job.id}><div><div className="ops-item-line"><strong>{data.posts.find(p => p.id === job.postId)?.title || '自動工作'}</strong><Badge value={job.status} type="job" /></div><p className="ops-muted">{job.type} · 文案 v{job.copyVersion} · 已嘗試 {job.attempts || 0} 次</p>{job.lastError && <p className="ops-job-error">{job.lastError}</p>}{job.status === 'needs_reconciliation' && <p className="ops-note">先到 Canva 核對是否已產生設計；若已有成果，回到該則宣傳登錄連結。避免直接重試造成重複。</p>}</div>{['failed', 'blocked_configuration'].includes(job.status) && <ActionButton tone="quiet small" busy={busy} reason={!isAdviser(data.actor) ? '由顧問重新排程' : ''} onClick={() => run('job.retry', job)}>重新排程</ActionButton>}</div>)}</div> : <p className="ops-note">產生文案或核准設計需求後，工作會顯示在這裡。</p>}
    </Panel><CanvaConnection data={data} demo={demo} /><ImportPanel data={data} busy={busy} execute={execute} />
  </>;
}


export { PeoplePanel, ImportPanel };
export default Settings;
