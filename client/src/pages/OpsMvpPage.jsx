import { useMemo, useState } from 'react';
import './OpsMvpPage.css';

const ACTIVITIES = [
  { id:'A08', name:'深度研究－交易策略組', status:'高風險', priority:'最高', owner:'待定', deadline:'2026-10-03', next:'確認教室與錄影', blocker:'目前兩項皆無明確接手人' },
  { id:'A05', name:'MaiCoin 課程＋交易競賽', status:'重排中', priority:'高', owner:'品言主導', deadline:'待定', next:'確認新日期／形式／規則', blocker:'10/5、10/11、10/17 舊排程不可沿用' },
  { id:'A04', name:'期末／學期競賽', status:'待確認', priority:'高', owner:'嘉瑩＊', deadline:'待定', next:'確認嘉瑩本人是否正式承接', blocker:'執行分工尚未定案' },
  { id:'A03', name:'Ourbit＋模擬交易競賽', status:'待確認', priority:'高', owner:'妤萱＊', deadline:'待定', next:'確認品言／彥綸／妤萱接受與交接', blocker:'9/24 分工仍屬提議／待交接' },
  { id:'A01', name:'週三社課', status:'進行中', priority:'中', owner:'梓芸／嘉瑩＊／妤萱＊', deadline:'每週日發文', next:'補每場接待、開門、飲水、車證與簽到安排', blocker:'整體追蹤與現場細節仍未完整' },
  { id:'A02', name:'週五社課／講座', status:'進行中', priority:'中', owner:'依宸', deadline:'依各場次', next:'逐場確認講師、教室、設備、簽到與發布', blocker:'部分場次細節尚未匯入' },
  { id:'A06', name:'新百王合作活動', status:'規劃中', priority:'中', owner:'梓芸／妤萱／嘉瑩', deadline:'2026-11-04', next:'等合作方流程後補文案、表單、現場分工', blocker:'流程預計 10 月中確認' },
  { id:'A07', name:'深度研究－基本面組', status:'待補分工', priority:'中', owner:'待定', deadline:'待定', next:'確認群組、連結與行政交接', blocker:'後續行政主責未明確' },
  { id:'A09', name:'深度研究－加密組', status:'進行中', priority:'中', owner:'妤萱', deadline:'2026-10-03', next:'補講師接洽、行政與宣傳協作', blocker:'除妤萱外多數角色未補齊' },
];

const PREFLIGHT = [
  { activity:'深度研究－交易策略組', item:'教室／場地確認', due:'2026-09-30', owner:'待定', status:'未分派', blocking:true },
  { activity:'深度研究－交易策略組', item:'錄影人員確認', due:'2026-09-30', owner:'待定', status:'未分派', blocking:true },
  { activity:'深度研究－交易策略組', item:'講師最終確認', due:'2026-10-02', owner:'大恒', status:'進行中', blocking:true },
  { activity:'深度研究－交易策略組', item:'學員地點提醒', due:'2026-10-02', owner:'待定', status:'未分派', blocking:true },
  { activity:'深度研究－加密組', item:'線上連結與講師確認', due:'2026-10-02', owner:'妤萱', status:'進行中', blocking:true },
  { activity:'新百王合作活動', item:'合作流程定案', due:'2026-10-21', owner:'梓芸／公關', status:'已提議', blocking:true },
];

const PEOPLE = ['梓芸','依宸','大恒','品言','妤萱','嘉瑩','羽蓉','彥綸','緯承','至維','浩原','沁彤'];

const REPORT_TYPES = ['進度更新','卡點／需要協助','分工確認','日期／形式異動'];

const RECENT_CHANGES = [
  { date:'9/29', activity:'MaiCoin 課程＋交易競賽', text:'合作方希望延至 10 月底／11 月初，原 10/5、10/11、10/17 排程不再沿用。' },
  { date:'9/29', activity:'期末／學期競賽', text:'嘉瑩是否正式承接仍待本人確認，不能視為已完成交接。' },
  { date:'9/23', activity:'深度研究－交易策略組', text:'10/3 改實體，教室與錄影人員仍需補位。' },
];

const NAV = [
  ['home','⌂','總覽'],
  ['report','＋','回報'],
  ['mine','◎','我的任務'],
  ['check','✓','活動檢查'],
  ['queue','≡','待審核'],
];

function readQueue() {
  try { return JSON.parse(localStorage.getItem('itrc_ops_mvp_queue') || '[]'); }
  catch { return []; }
}

function readName() {
  try { return localStorage.getItem('itrc_ops_name') || ''; }
  catch { return ''; }
}

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
}

function priorityClass(priority) {
  if (priority === '最高') return 'is-critical';
  if (priority === '高') return 'is-warning';
  return '';
}

function statusClass(status) {
  if (status === '完成') return 'is-success';
  if (status === '未分派' || status === '高風險') return 'is-critical';
  if (status === '待確認' || status === '重排中' || status === '已提議') return 'is-warning';
  return '';
}

function ActivityItem({ activity, onReport, onBlocked, onCopy, actionMode = 'normal' }) {
  return (
    <article className="ops-card ops-focus-item">
      <div className="ops-focus-top">
        <div className="ops-focus-title">{activity.name}</div>
        <span className={'ops-chip ' + priorityClass(activity.priority)}>{activity.status}</span>
      </div>
      <div className="ops-next"><strong>下一步</strong><br />{activity.next}</div>
      <div className="ops-chip-row">
        <span className="ops-chip">負責 {activity.owner}</span>
        <span className="ops-chip">期限 {activity.deadline}</span>
      </div>
      {activity.blocker && <div className="ops-blocker">卡點：{activity.blocker}</div>}
      {(onReport || onCopy) && (
        <div className="ops-card-actions">
          {onReport && <button className="ops-action-chip ops-action-chip--accent" onClick={() => onReport(activity)}><span>↗</span>{actionMode === 'mine' ? '回報進度' : '回報'}</button>}
          {actionMode === 'mine' && onBlocked && <button className="ops-action-chip ops-action-chip--danger" onClick={() => onBlocked(activity)}><span>!</span>我卡住了</button>}
          {onCopy && <button className="ops-action-chip ops-action-chip--quiet" onClick={() => onCopy(activity)}><span>⌘</span>給 AI</button>}
        </div>
      )}
    </article>
  );
}

function PreflightItem({ task }) {
  return (
    <article className="ops-card ops-task-item">
      <div className="ops-task-top">
        <div className="ops-task-title">{task.item}</div>
        <div className="ops-chip-row" style={{ marginTop: 0 }}>
          <span className={'ops-chip ' + statusClass(task.status)}>{task.status}</span>
          {task.blocking && <span className="ops-chip is-critical">會阻塞活動</span>}
        </div>
      </div>
      <div className="ops-muted" style={{ marginTop: 9 }}>{task.activity}</div>
      <div className="ops-chip-row">
        <span className="ops-chip">負責 {task.owner}</span>
        <span className="ops-chip">建議完成 {task.due}</span>
      </div>
    </article>
  );
}

export default function OpsMvpPage() {
  const initialName = readName();
  const [tab, setTab] = useState('home');
  const [name, setName] = useState(initialName);
  const [checkActivity, setCheckActivity] = useState('');
  const [blockingOnly, setBlockingOnly] = useState(false);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [form, setForm] = useState({ type:'進度更新', activity:'', reporter:initialName, update:'', date:todayLocal(), source:'' });
  const [queue, setQueue] = useState(readQueue);

  const focus = useMemo(() => ACTIVITIES.filter(a => ['最高','高'].includes(a.priority)), []);
  const blockingCount = useMemo(() => PREFLIGHT.filter(x => x.blocking && x.status !== '完成').length, []);
  const myActivities = useMemo(() => name ? ACTIVITIES.filter(a => (a.owner || '').includes(name)) : [], [name]);
  const myPreflight = useMemo(() => name ? PREFLIGHT.filter(x => (x.owner || '').includes(name)) : [], [name]);
  const checks = useMemo(
    () => PREFLIGHT.filter(x => (!checkActivity || x.activity === checkActivity) && (!blockingOnly || x.blocking)),
    [checkActivity, blockingOnly]
  );
  const checkActivities = useMemo(() => [...new Set(PREFLIGHT.map(x => x.activity))], []);

  function goto(next) {
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setProfileName(nextName) {
    setName(nextName);
    setForm(v => ({ ...v, reporter: nextName || v.reporter }));
    try {
      if (nextName) localStorage.setItem('itrc_ops_name', nextName);
      else localStorage.removeItem('itrc_ops_name');
    } catch {}
  }

  function removeQueueItem(id) {
    const next = queue.filter(item => item.id !== id);
    setQueue(next);
    localStorage.setItem('itrc_ops_mvp_queue', JSON.stringify(next));
  }

  function startReport(activity, type = '進度更新', preset = '') {
    setSubmitted(false);
    setForm(v => ({
      ...v,
      type,
      activity: activity?.name || v.activity,
      reporter: name || v.reporter,
      update: preset,
      date: todayLocal(),
    }));
    goto('report');
  }

  async function copyText(text, message = '已複製，可直接貼給你的 AI') {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(message);
      setTimeout(() => setCopyMessage(''), 2200);
    } catch {
      window.prompt('複製下面這段文字：', text);
    }
  }

  function activityContext(activity) {
    return [
      '# ITRC 活動脈絡',
      `活動：${activity.name}`,
      `狀態：${activity.status}`,
      `負責人：${activity.owner}`,
      `期限：${activity.deadline}`,
      `下一步：${activity.next}`,
      activity.blocker ? `卡點：${activity.blocker}` : '',
      '',
      '請以這些資料為準協助我，不要自行假設未確認事項已完成。',
    ].filter(Boolean).join('\n');
  }

  function myContext() {
    return [
      `# ITRC｜${name || '幹部'}的工作脈絡`,
      '',
      '## 參與活動',
      ...myActivities.map(a => `- ${a.name}｜${a.status}｜下一步：${a.next}｜期限：${a.deadline}`),
      '',
      '## 活動前任務',
      ...myPreflight.map(t => `- ${t.activity}｜${t.item}｜${t.status}｜建議完成：${t.due}`),
      '',
      '＊ 表示尚未正式確認承接。請不要把提議或待交接視為已確認。',
    ].join('\n');
  }

  function submit(e) {
    e.preventDefault();
    setSubmitted(false);
    if (!form.activity || !form.reporter.trim() || !form.update.trim() || !form.date) {
      alert('還有必填欄位沒完成');
      return;
    }
    const next = [{ ...form, id: Date.now(), status:'待審核' }, ...queue];
    setQueue(next);
    localStorage.setItem('itrc_ops_mvp_queue', JSON.stringify(next));
    if (form.reporter.trim()) {
      try { localStorage.setItem('itrc_ops_name', form.reporter.trim()); } catch {}
      setName(form.reporter.trim());
    }
    setForm(v => ({ ...v, type:'進度更新', update:'', source:'' }));
    setSubmitted(true);
  }

  return (
    <div className="ops-app">
      <header className="ops-header">
        <div className="ops-shell">
          <div className="ops-header-row">
            <div className="ops-brand">
              <div className="ops-brand-mark">I</div>
              <div>
                <h1 className="ops-title">ITRC 活動管理中心</h1>
                <div className="ops-kicker">幹部日常工作入口</div>
              </div>
            </div>
            <div className="ops-header-tools">
              {name && <button className="ops-profile-chip" onClick={() => goto('mine')}>◎ {name}</button>}
              <div className="ops-snapshot">資料更新至 9/29</div>
            </div>
          </div>
          <nav className="ops-desktop-nav" aria-label="活動管理導覽">
            {NAV.map(([key,,label]) => (
              <button key={key} className={'ops-nav-btn ' + (tab === key ? 'is-active' : '')} onClick={() => goto(key)}>
                {label}{key === 'queue' && queue.length > 0 ? ` · ${queue.length}` : ''}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {copyMessage && <div className="ops-toast" role="status">{copyMessage}</div>}
      <main className="ops-main">
        <div className="ops-shell">
          {tab === 'home' && (
            <>
              <section className="ops-hero-panel">
                <div className="ops-card ops-priority-panel">
                  <div className="ops-eyebrow">先處理這些</div>
                  <h2>{focus.length} 個高優先活動需要注意</h2>
                  <div className="ops-priority-copy">
                    {name ? `${name}，你目前參與 ${myActivities.length} 個活動、${myPreflight.length} 個活動前任務。` : '不用先理解整套系統。先設定「我是誰」，就只看跟你有關的事情。'}
                  </div>
                  <div className="ops-quick-actions">
                    <button className="ops-primary-btn" onClick={() => goto('report')}>回報最新進度</button>
                    <button className="ops-secondary-btn" onClick={() => goto('mine')}>{name ? '看我的任務' : '設定我是誰'}</button>
                  </div>
                </div>
                <div className="ops-mini-metrics" aria-label="狀態摘要">
                  <div className="ops-card ops-metric"><div className="ops-metric-label">活動</div><div className="ops-metric-value">{ACTIVITIES.length}</div><div className="ops-metric-note">目前納管</div></div>
                  <div className="ops-card ops-metric"><div className="ops-metric-label">高優先</div><div className="ops-metric-value">{focus.length}</div><div className="ops-metric-note">先處理</div></div>
                  <div className="ops-card ops-metric"><div className="ops-metric-label">阻塞事項</div><div className="ops-metric-value">{blockingCount}</div><div className="ops-metric-note">活動前必要</div></div>
                  <div className="ops-card ops-metric"><div className="ops-metric-label">待審核</div><div className="ops-metric-value">{queue.length}</div><div className="ops-metric-note">你送出的回報</div></div>
                </div>
              </section>

              <section>
                <div className="ops-section-head">
                  <div><h2 className="ops-section-title">現在最需要注意</h2><div className="ops-section-subtitle">只列高優先／最高，不把所有活動一次塞給你。</div></div>
                  <div className="ops-head-actions">
                    <button className="ops-secondary-btn" onClick={() => setShowAllActivities(v => !v)}>{showAllActivities ? '收起全部活動' : '查看全部活動'}</button>
                    <button className="ops-secondary-btn" onClick={() => goto('check')}>看活動前檢查</button>
                  </div>
                </div>
                <div className="ops-focus-list">{focus.map(a => (
                  <ActivityItem
                    key={a.id}
                    activity={a}
                    onReport={(activity) => startReport(activity)}
                    onCopy={(activity) => copyText(activityContext(activity))}
                  />
                ))}</div>
                {showAllActivities && (
                  <div className="ops-all-activities">
                    <div className="ops-section-subtitle">其他活動</div>
                    <div className="ops-focus-list">
                      {ACTIVITIES.filter(a => !['最高','高'].includes(a.priority)).map(a => (
                        <ActivityItem
                          key={a.id}
                          activity={a}
                          onReport={(activity) => startReport(activity)}
                          onCopy={(activity) => copyText(activityContext(activity))}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="ops-recent-section">
                <div className="ops-section-head">
                  <div><h2 className="ops-section-title">最近有什麼改變</h2><div className="ops-section-subtitle">把被取代的舊安排直接標出來，避免大家拿舊資訊繼續做。</div></div>
                </div>
                <div className="ops-card ops-change-list">
                  {RECENT_CHANGES.map((item, i) => (
                    <div className="ops-change-item" key={i}>
                      <div className="ops-change-date">{item.date}</div>
                      <div><strong>{item.activity}</strong><div>{item.text}</div></div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {tab === 'report' && (
            <section className="ops-form-wrap">
              <form className="ops-card ops-form" onSubmit={submit}>
                <div className="ops-form-intro">
                  <h2>回報這週進度</h2>
                  <p>只要把你知道的事實寫下來。送出後先進待審核，不會直接改正式分工。</p>
                </div>

                <div className="ops-field">
                  <label className="ops-field-label">這次要回報什麼？</label>
                  <div className="ops-report-types">
                    {REPORT_TYPES.map(type => (
                      <button type="button" key={type} className={form.type === type ? 'is-active' : ''} onClick={() => setForm({ ...form, type })}>{type}</button>
                    ))}
                  </div>
                </div>

                <div className="ops-field">
                  <label className="ops-field-label ops-required"><span className="ops-step">1</span>活動</label>
                  <select className="ops-select" required value={form.activity} onChange={e => setForm({ ...form, activity:e.target.value })}>
                    <option value="">請選活動</option>
                    {ACTIVITIES.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                  </select>
                </div>

                <div className="ops-form-grid">
                  <div className="ops-field">
                    <label className="ops-field-label ops-required"><span className="ops-step">2</span>你的名字</label>
                    <select className="ops-select" required value={form.reporter} onChange={e => setForm({ ...form, reporter:e.target.value })}>
                      <option value="">請選名字</option>
                      {PEOPLE.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="ops-field">
                    <label className="ops-field-label ops-required"><span className="ops-step">3</span>消息日期</label>
                    <input className="ops-input" required type="date" value={form.date} onChange={e => setForm({ ...form, date:e.target.value })} />
                  </div>
                </div>

                <div className="ops-field">
                  <label className="ops-field-label ops-required"><span className="ops-step">4</span>這週發生什麼？</label>
                  <textarea className="ops-textarea" required value={form.update} onChange={e => setForm({ ...form, update:e.target.value })} placeholder="白話寫就好，例如：教室確定 CM203，品言會幫忙錄影。" />
                  <div className="ops-form-help">照你知道的事實寫就好，不用自己判斷要改哪個欄位。</div>
                </div>

                <div className="ops-field">
                  <label className="ops-field-label">在哪裡看到？</label>
                  <input className="ops-input" list="ops-source-list" value={form.source} onChange={e => setForm({ ...form, source:e.target.value })} placeholder="例如：活動組 LINE（可空白）" />
                  <datalist id="ops-source-list">
                    <option value="活動組 LINE" />
                    <option value="社長部 LINE" />
                    <option value="行銷群組 LINE" />
                    <option value="講師私訊" />
                    <option value="Email" />
                    <option value="會議" />
                  </datalist>
                </div>

                <button className="ops-primary-btn ops-submit" type="submit">送到待審核</button>
                {submitted && (
                  <div className="ops-confirmation">
                    <span>已加入待審核。正式資料還沒有被修改。</span>
                    <button type="button" onClick={() => goto('queue')}>查看</button>
                  </div>
                )}
              </form>
            </section>
          )}

          {tab === 'mine' && (
            <>
              <section className="ops-card ops-person-picker">
                <h2>我的任務</h2>
                <div className="ops-muted">先選名字，只看跟你有關的內容。</div>
                <div className="ops-field">
                  <select className="ops-select" value={name} onChange={e => setProfileName(e.target.value)}>
                    <option value="">請選你的名字</option>
                    {PEOPLE.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                {name && (
                  <div className="ops-person-summary">
                    <span className="ops-chip">{myActivities.length} 個活動</span>
                    <span className="ops-chip">{myPreflight.length} 個活動前任務</span>
                    <button className="ops-inline-ai" onClick={() => copyText(myContext(), '你的工作脈絡已複製')}>複製我的工作給 AI</button>
                  </div>
                )}
              </section>

              {!name ? <div className="ops-card ops-empty" style={{ marginTop: 14 }}>選名字後，這裡才會顯示你的事情。</div> : (
                <>
                  <section style={{ marginTop: 22 }}>
                    <div className="ops-section-head"><div><h2 className="ops-section-title">你參與的活動</h2><div className="ops-section-subtitle">＊ 表示還沒正式確認承接。</div></div></div>
                    <div className="ops-stack">{myActivities.length ? myActivities.map(a => (
                      <ActivityItem
                        key={a.id}
                        activity={a}
                        actionMode="mine"
                        onReport={(activity) => startReport(activity)}
                        onBlocked={(activity) => startReport(activity, '卡點／需要協助', '目前卡住：')}
                        onCopy={(activity) => copyText(activityContext(activity))}
                      />
                    )) : <div className="ops-card ops-empty">目前沒有找到你的活動。</div>}</div>
                  </section>
                  <section style={{ marginTop: 22 }}>
                    <div className="ops-section-head"><div><h2 className="ops-section-title">你的活動前任務</h2><div className="ops-section-subtitle">只列有指派到你的檢查項目。</div></div></div>
                    <div className="ops-stack">{myPreflight.length ? myPreflight.map((x,i) => <PreflightItem key={i} task={x} />) : <div className="ops-card ops-empty">目前沒有找到你的活動前任務。</div>}</div>
                  </section>
                </>
              )}
            </>
          )}

          {tab === 'check' && (
            <>
              <div className="ops-section-head">
                <div><h2 className="ops-section-title">活動前檢查</h2><div className="ops-section-subtitle">先看會不會卡住活動，不把所有 checklist 當成同等重要。</div></div>
              </div>
              <div className="ops-filter-row" aria-label="活動篩選">
                <button className={'ops-filter ' + (!checkActivity ? 'is-active' : '')} onClick={() => setCheckActivity('')}>全部</button>
                {checkActivities.map(a => <button key={a} className={'ops-filter ' + (checkActivity === a ? 'is-active' : '')} onClick={() => setCheckActivity(a)}>{a.replace('深度研究－','')}</button>)}
                <button className={'ops-filter ops-filter-alert ' + (blockingOnly ? 'is-active' : '')} onClick={() => setBlockingOnly(v => !v)}>只看阻塞</button>
              </div>
              <div className="ops-stack" style={{ marginTop: 14 }}>{checks.map((x,i) => <PreflightItem key={i} task={x} />)}</div>
            </>
          )}

          {tab === 'queue' && (
            <>
              <div className="ops-queue-banner">
                <div>ⓘ</div>
                <div><strong>目前是測試版</strong><span>這些回報暫時只存在這台裝置，還沒有送進正式社團資料。</span></div>
              </div>
              <div className="ops-section-head">
                <div><h2 className="ops-section-title">待審核更新</h2><div className="ops-section-subtitle">正式資料不會因為有人回報就直接被改掉。</div></div>
                {queue.length > 0 && <span className="ops-chip is-warning">{queue.length} 筆</span>}
              </div>
              <div className="ops-stack">
                {queue.length ? queue.map(q => (
                  <article className="ops-card ops-task-item" key={q.id}>
                    <div className="ops-task-top"><div className="ops-task-title">{q.activity}</div><div className="ops-chip-row" style={{ marginTop: 0 }}><span className="ops-chip">{q.type || '進度更新'}</span><span className="ops-chip is-warning">{q.status}</span></div></div>
                    <div className="ops-next">{q.update}</div>
                    <div className="ops-queue-meta">
                      <div className="ops-chip-row"><span className="ops-chip">{q.reporter}</span><span className="ops-chip">{q.date}</span>{q.source && <span className="ops-chip">{q.source}</span>}</div>
                      <button className="ops-text-btn" onClick={() => removeQueueItem(q.id)}>撤回這筆</button>
                    </div>
                  </article>
                )) : <div className="ops-card ops-empty">目前沒有待審核更新。</div>}
              </div>
            </>
          )}

          <div className="ops-safe-note">測試版不會直接修改正式分工或活動狀態。</div>
        </div>
      </main>

      <nav className="ops-mobile-nav" aria-label="手機導覽">
        {NAV.map(([key,icon,label]) => (
          <button key={key} className={tab === key ? 'is-active' : ''} onClick={() => goto(key)}>
            <span aria-hidden="true">{icon}</span>{label}{key === 'queue' && queue.length > 0 ? ` ${queue.length}` : ''}
          </button>
        ))}
      </nav>
    </div>
  );
}
