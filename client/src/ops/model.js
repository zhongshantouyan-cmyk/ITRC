export const STAGES = {
  brief: ['資料準備', 'neutral'], draft: ['文案草稿', 'blue'], unit_review: ['單位確認', 'amber'],
  approval: ['等待終審', 'amber'], approved: ['文案通過', 'green'], design_pending: ['等待設計', 'blue'],
  design_review: ['設計校對', 'amber'], sponsor_review: ['贊助方確認', 'amber'], ready: ['可以發布', 'green'],
  published: ['已發布', 'green'], needs_revision: ['需要修訂', 'red'],
};
export const TASK_STATES = { unassigned: '未指派', accepted: '已接單', todo: '待開始', doing: '進行中', blocked: '遇到阻礙', delivered: '待驗收', done: '已完成', cancelled: '已取消' };
export const EVENT_STATES = { draft: '資料待確認', confirmed: '資料已確認', changed: '異動待確認', cancelled: '已取消' };
export const JOB_STATES = { queued: '排隊中', running: '執行中', succeeded: '已完成', blocked_configuration: '等待設定', failed: '執行失敗', needs_reconciliation: '需核對外部結果', obsolete: '版本已失效' };
export const CHANNELS = { instagram: 'Instagram 貼文', story: '限時動態', announcement: '公告' };
export const GROUPS = ['管理組', '財務組', '公關組', '行銷組', '活動組', '資訊組'];
export const TABS = [
  { id: 'overview', label: '工作總覽', mark: '01' }, { id: 'projects', label: '活動與專案', mark: '02' },
  { id: 'posts', label: '宣傳製作', mark: '03' }, { id: 'tasks', label: '我的任務', mark: '04' },
  { id: 'review', label: '審核與紀錄', mark: '05' }, { id: 'settings', label: '系統連線', mark: '06' },
];
export const ACTION_LABELS = {
  'project.create': '建立專案', 'project.update': '更新專案', 'event.create': '建立活動', 'event.update': '更新活動資料', 'event.confirm': '確認活動資料',
  'obligation.create': '新增交付要求', 'obligation.update': '更新交付要求', 'task.create': '建立任務', 'task.update': '更新任務',
  'task.deliver': '提交成果待驗收', 'task.accept-delivery': '驗收通過', 'task.return-delivery': '退回補件', 'task.reopen': '重新開啟任務',
  'people.import-preview': '預覽幹部名單', 'people.import-apply': '更新幹部對照',
  'people.import-create': '新增幹部對照', 'people.import-update': '更新幹部對照',
  'post.restore-version': '以歷史內容建立新草稿',
  'post.snapshot': '保存原內容', 'post.before-update': '修改前內容', 'event.before-update': '活動異動前內容', 'post.before-restore': '回復前內容',
  'post.create': '建立宣傳需求', 'post.update': '儲存文案版本', 'post.generate': '產生文案草稿', 'post.submit': '送交單位確認',
  'post.unit-review': '單位確認通過', 'post.approve': '文案終審通過', 'post.reject': '退回修訂', 'post.request-design': '建立設計工作',
  'post.attach-design': '登錄 Canva 設計', 'post.design-review': '設計校對通過', 'post.sponsor-review': '記錄贊助方確認',
  'post.publish': '登錄發布紀錄', 'job.retry': '重新排程工作', 'jobs.run': '處理待辦工作', 'import.preview': '預覽匯入', 'import.apply': '確認匯入',
};
export const isAdviser = actor => ['advisor', 'chair'].includes(actor?.role);
export const canOwn = (actor, record, projects = [], people = [], tasks = []) => {
  const project = projects.find(p => p.id === record?.projectId);
  const parent = tasks.find(task => task.id === record?.parentId);
  const email = actor?.email?.trim().toLowerCase();
  const matchesRole = (item, role) => {
    if (!item || !email) return false;
    const personId = item[`${role}PersonId`];
    if (personId) return people.some(person => person.personId === personId && person.status !== 'inactive' && person.email?.trim().toLowerCase() === email);
    return item[`${role}Email`]?.trim().toLowerCase() === email;
  };
  const unassignedCreator = !!email && !record?.ownerPersonId && !record?.ownerEmail && record?.createdByEmail?.trim().toLowerCase() === email;
  return isAdviser(actor) || unassignedCreator || matchesRole(record, 'owner') || matchesRole(record, 'adviser') || matchesRole(project, 'owner') || matchesRole(project, 'adviser') || matchesRole(parent, 'owner');
};
export const dateText = value => {
  if (!value) return '尚未設定';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll('-', '/');
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' }).format(date);
};
export const safeLink = value => {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
};
export function nextStep(post, state) {
  const event = state.events.find(e => e.id === post.eventId);
  const job = state.jobs.find(j => j.postId === post.id && j.copyVersion === post.copyVersion && ['blocked_configuration', 'failed', 'needs_reconciliation'].includes(j.status));
  if (post.stage === 'published') return '已保留發布連結與時間';
  if (event?.confirmationStatus !== 'confirmed') return '活動組先確認日期、講者與地點';
  if (job?.status === 'needs_reconciliation') return '先核對 Canva 是否已建立，避免重複產生';
  if (job?.status === 'blocked_configuration') return '完成系統連線，或登錄人工建立的 Canva 設計';
  return ({ brief: '補齊需求後產生草稿', draft: '檢查文案後送交單位確認', needs_revision: '修改文案後重新送審', unit_review: '活動負責人確認內容事實', approval: '指定終審者核准這個版本', approved: '建立分層設計工作', design_pending: '等待 Canva 設計或補上設計連結', design_review: '行銷負責人微調並校對', sponsor_review: '公關登錄贊助方確認證據', ready: '完成發布後登錄正式網址' })[post.stage] || '查看目前紀錄';
}

// CSV/TSV parser supports quoted commas, line breaks and escaped double quotes.
export function parseImportText(input, kind = 'events') {
  const text = input.replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('請先貼上資料或選擇檔案。');
  if (text.startsWith('{') || text.startsWith('[')) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? kind === 'people' ? { people: parsed } : { events: kind === 'events' ? parsed : [], posts: kind === 'posts' ? parsed : [], tasks: kind === 'tasks' ? parsed : [] } : parsed;
  }
  const delimiter = text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',';
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === delimiter) { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('有未結束的雙引號，請檢查 CSV 格式。');
  row.push(cell); rows.push(row);
  const aliases = { '標題': 'title', '活動名稱': 'title', '任務名稱': 'title', '宣傳名稱': 'title', '講者': 'speaker', '日期': 'date', '時間': 'time', '地點': 'venue', '對象': 'audience', '費用': 'fee', '報名連結': 'registrationUrl', '宣傳重點': 'highlights', '負責人信箱': 'ownerEmail', '專案ID': 'projectId', '活動ID': 'eventId', '活動來源鍵': 'eventSourceKey', '來源網址': 'sourceUrl', '來源檔名': 'sourceLabel', '來源日期': 'sourceDate', '來源版本': 'sourceRevision', '來源鍵': 'sourceKey', '截止日期': 'dueDate', '驗收標準': 'acceptanceCriteria', '交付連結': 'deliverableUrl', '宣傳目的': 'purpose', '宣傳對象': 'audience', '希望採取行動': 'cta', '發布管道': 'channel', '預計發布時間': 'scheduledAt', '文案': 'caption' };
  Object.assign(aliases, { '負責人ID': 'ownerPersonId', '驗收人ID': 'reviewerPersonId', '結案必要': 'requiredForCompletion' });
  if (kind === 'people') Object.assign(aliases, { '姓名': 'name', '職稱': 'title', 'MAIL': 'email', 'EMAIL': 'email', 'Email': 'email', '信箱': 'email', 'LINE名稱': 'lineName', 'LINE 名稱': 'lineName', 'LINE顯示名稱': 'lineName', '組別': 'group', '幹部ID': 'personId', '幹部 ID': 'personId', '任期': 'term', '在任狀態': 'status' });
  const headers = rows.shift().map(x => aliases[x.trim()] || x.trim());
  if (kind === 'people' ? !headers.includes('name') || !headers.includes('personId') : !headers.includes('title')) throw new Error(kind === 'people' ? '第一列需要「姓名」和「幹部ID」欄。請沿用主表的固定 ID。' : '第一列需要「標題」欄，或英文 title。');
  if (new Set(headers).size !== headers.length) throw new Error('欄位名稱不能重複。');
  const records = rows.filter(r => r.some(v => v.trim())).map((values, index) => {
    if (values.length > headers.length) throw new Error(`第 ${index + 2} 列的欄位比標題列多。`);
    return Object.fromEntries(headers.map((key, i) => [key, (values[i] || '').trim()]));
  });
  if (records.length > 200) throw new Error('每次最多匯入 200 筆，請分批處理。');
  if (kind === 'people') return { people: records.map(person => ({ ...person, ...(person.status ? { status: ({ '在任': 'active', '現任': 'active', '離任': 'inactive', '非現任': 'inactive', '非當期名單': 'inactive', '已卸任': 'inactive', '暫停': 'inactive', '待確認': 'pending' })[person.status] || person.status } : 'status' in person ? { status: 'pending' } : {}) })) };
  for (const record of records) if ('requiredForCompletion' in record) {
    const value = record.requiredForCompletion.toLowerCase();
    if (!['true', 'false', '是', '否', '1', '0', ''].includes(value)) throw new Error('「結案必要」請填是／否或 true／false。');
    record.requiredForCompletion = ['true', '是', '1', ''].includes(value);
  }
  return { events: kind === 'events' ? records : [], posts: kind === 'posts' ? records : [], tasks: kind === 'tasks' ? records : [] };
}

// Explicit export allowlist: never serialize the full state or integration configuration.
export function exportPostsCsv({ posts = [], events = [], people = [] }) {
  const peopleMap = new Map(people.map(person => [person.personId, person]));
  const slideCount = Math.min(10, Math.max(3, ...posts.map(post => post.slides?.length || 0)));
  const columns = [
    ['宣傳ID', post => post.id], ['活動ID', post => post.eventId], ['專案ID', post => post.projectId],
    ['活動標題', (_post, event) => event.title], ['活動日期', (_post, event) => event.date],
    ['宣傳名稱', post => post.title], ['宣傳目的', post => post.purpose], ['宣傳對象', post => post.audience],
    ['宣傳重點', post => post.highlights], ['希望採取行動', post => post.cta], ['發布管道', post => post.channel],
    ['預計發布時間', post => post.scheduledAt], ['文案', post => post.caption],
    ...Array.from({ length: slideCount }, (_, i) => [
      [`輪播${i + 1}標題`, post => post.slides?.[i]?.heading], [`輪播${i + 1}內文`, post => post.slides?.[i]?.body],
    ]).flat(),
    ['流程階段', post => STAGES[post.stage]?.[0] || post.stage], ['流程代碼', post => post.stage],
    ['資料版本', post => post.version], ['文案版本', post => post.copyVersion], ['核准版本', post => post.approvedVersion],
    ['核准人', post => post.approvedBy], ['核准時間', post => post.approvedAt], ['設計文案版本', post => post.designCopyVersion],
    ['Canva編輯連結', post => post.canvaEditUrl], ['發布連結', post => post.publishedUrl], ['發布時間', post => post.publishedAt],
    ['負責人ID', post => post.ownerPersonId], ['負責人姓名', post => peopleMap.get(post.ownerPersonId)?.name],
    ['負責人職稱', post => peopleMap.get(post.ownerPersonId)?.title], ['負責人組別', post => peopleMap.get(post.ownerPersonId)?.group],
    ['負責人信箱', post => post.ownerEmail], ['來源網址', post => post.sourceUrl], ['來源檔名', post => post.sourceLabel],
    ['來源日期', post => post.sourceDate], ['來源版本', post => post.sourceRevision], ['來源鍵', post => post.sourceKey],
    ['活動來源網址', (_post, event) => event.sourceUrl], ['活動來源檔名', (_post, event) => event.sourceLabel],
    ['活動來源版本', (_post, event) => event.sourceRevision], ['活動資料版本', post => post.sourceEventVersion],
  ];
  const cell = value => {
    let text = value == null ? '' : String(value);
    // Quoting alone does not stop spreadsheet formulas. Prefix text that could be interpreted as one.
    if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const eventMap = new Map(events.map(event => [event.id, event]));
  return '\uFEFF' + [columns.map(([label]) => cell(label)).join(','), ...posts.map(post => {
    const event = eventMap.get(post.eventId) || {};
    return columns.map(([, read]) => cell(read(post, event))).join(',');
  })].join('\r\n') + '\r\n';
}
