'use strict';

// Offline preparation only. No Firebase, HTTP, database connection or import
// mutation is performed. Use a fresh system backup before the real import.
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync, chmodSync } = require('node:fs');
const { resolve, join, basename } = require('node:path');

const SOURCE_PATH = 'boards/itrc';
const SOURCE_URL = new URL('ITRC管理組-任務看板.html', 'https://itrc-tools.vercel.app/').href;
const STATUS = Object.freeze({ '待辦': 'todo', '進行中': 'doing', '卡關': 'doing', '完成': 'done' });
const PERSON_ID = /^ITRC-P\d{4,8}$/;
const fail = message => { throw new Error(message); };

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function asText(value, label, max = 2000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) fail(`Invalid ${label}.`);
  return value;
}

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function taipeiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function recordsFromBackup(bundle) {
  const table = bundle.database?.tables?.find(item => item.name === 'ops_records');
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) fail('Backup has no operations records.');
  const names = table.columns.map(column => column.name);
  if (!['kind', 'id', 'data'].every(name => names.includes(name))) fail('Invalid operations table shape.');
  const records = [];
  for (const row of table.rows) {
    if (!Array.isArray(row) || row.length !== names.length) fail('Invalid operations row shape.');
    const record = Object.fromEntries(names.map((name, index) => [name, row[index]]));
    if (!['people', 'tasks'].includes(record.kind)) continue;
    if (typeof record.data !== 'string') fail('Operations data is not JSON text.');
    const data = JSON.parse(record.data);
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Invalid operations record.');
    records.push({ kind: record.kind, ...data });
  }
  return records;
}

function resolveOwner(who, people) {
  const name = who.trim();
  if (!name) return { ownerPersonId: '', reason: 'empty' };
  // No nickname, title, group, substring, pinyin or fuzzy matching.
  const matches = people.filter(person => person.name === name);
  if (matches.length > 1) return { ownerPersonId: '', reason: 'ambiguous_name' };
  if (!matches.length) return { ownerPersonId: '', reason: 'not_in_people' };
  const person = matches[0];
  if (person.status !== 'active' || person.active === false || person.disabled === true) {
    return { ownerPersonId: '', reason: person.status === 'retired' ? 'retired' : 'not_active' };
  }
  if (!PERSON_ID.test(person.personId || '')) return { ownerPersonId: '', reason: 'invalid_person_id' };
  return { ownerPersonId: person.personId, reason: 'unique_exact_current_name' };
}

function convertBackup(bundle) {
  if (bundle?.format !== 'itrc-system-data-backup' || bundle.version !== 1) fail('Unsupported system backup.');
  const { checksum, ...unsigned } = bundle;
  if (checksum?.algorithm !== 'sha256' || checksum.value !== digest(unsigned)) fail('Backup checksum mismatch.');
  if (!Number.isFinite(Date.parse(bundle.createdAt))) fail('Invalid backup capture time.');
  const entry = bundle.firebase?.paths?.find(item => item.path === SOURCE_PATH);
  if (!entry?.exists || entry.sha256 !== digest(entry.value)) fail('Legacy board is absent or its checksum differs.');
  const board = entry.value;
  if (!board || !Array.isArray(board.events || []) || !Array.isArray(board.lists) || !Number.isSafeInteger(board.v) || board.v < 0) fail('Unsupported legacy board shape.');
  const records = recordsFromBackup(bundle);
  const people = records.filter(record => record.kind === 'people');
  if (!people.length) fail('No people snapshot; owner matching would be unsafe.');
  const existingKeys = new Set(records.filter(record => record.kind === 'tasks').map(record => record.sourceKey).filter(Boolean));
  const sourceDate = taipeiDate(bundle.createdAt);
  const sourceRevision = `firebase:${SOURCE_PATH};v=${board.v};sha256=${entry.sha256};capturedAt=${bundle.createdAt}`;
  const tasks = [], mapping = [], cardIds = new Set();
  const reasonText = { unique_exact_current_name: '現任姓名唯一精確匹配', retired: '原負責人已離任，保持未指派', not_in_people: '原負責人不在目前幹部對照，保持未指派', empty: '原負責人空白，保持未指派', ambiguous_name: '姓名有多筆對照，保持未指派', not_active: '原負責人不是現任，保持未指派', invalid_person_id: '缺少有效固定幹部 ID，保持未指派' };
  for (const list of board.lists) {
    if (!list || !Array.isArray(list.cards || [])) fail('Invalid legacy list.');
    const cards = list.cards || []; // RTDB omits empty arrays.
    const listTitle = asText(list.title, 'list title');
    const status = STATUS[listTitle];
    if (cards.length && !status) fail(`Unmapped list status: ${listTitle}`);
    const listId = asText(list.id, 'list id');
    for (const card of cards) {
      if (!card || typeof card !== 'object' || Array.isArray(card)) fail('Invalid legacy card.');
      const id = asText(card.id, 'card id');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || cardIds.has(id)) fail('Missing, unsafe or duplicated card id.');
      cardIds.add(id);
      const title = asText(card.title, `card ${id} title`);
      if (!title.trim()) fail(`Empty title on card ${id}.`);
      const dueDate = asText(card.due, `card ${id} due`);
      if (!validDate(dueDate)) fail(`Invalid due date on card ${id}; original date was not guessed.`);
      const note = asText(card.note, `card ${id} note`, 12000);
      const who = asText(card.who, `card ${id} owner`);
      const group = asText(card.group, `card ${id} group`);
      const legacyEventId = asText(card.wid, `card ${id} old event`);
      const owner = resolveOwner(who, people);
      const sourceKey = `firebase:${SOURCE_PATH}:card:${id}`;
      const provenance = [
        '── 原看板紀錄 ──',
        `原卡片 ID：${id}`,
        `原欄位：${listTitle}（${listId}）`,
        `原負責人：${who || '（空白）'}`,
        `原組別：${group || '（空白）'}`,
        `指派比對：${reasonText[owner.reason]}`,
        ...(legacyEventId ? [`原活動參照：${legacyEventId}（僅保留出處，未建立目前活動關聯）`] : []),
        `來源擷取時間：${bundle.createdAt}（備份時間，不代表卡片更新時間）`,
        `來源版本：${board.v}`,
      ];
      const notes = (note ? `${note}\n\n` : '') + provenance.join('\n');
      if (notes.length > 12000) fail(`Card ${id} notes exceed the import limit; original note was not truncated.`);
      const task = { title, dueDate, status, notes, ownerPersonId: owner.ownerPersonId, ownerEmail: '', requiredForCompletion: false,
        sourceUrl: SOURCE_URL, sourceLabel: '原社團任務看板（Firebase boards/itrc）', sourceDate, sourceRevision, sourceKey };
      if (listTitle === '卡關') task.blocker = note || '原看板標示卡關，原因未填。';
      tasks.push(task);
      mapping.push({ cardId: id, title, originalListId: listId, originalListTitle: listTitle, originalWho: who, originalGroup: group,
        originalDueDate: dueDate, originalEventId: legacyEventId, status, ownerPersonId: owner.ownerPersonId,
        ownerResolution: owner.reason, sourceKey, alreadyInOperations: existingKeys.has(sourceKey), dueBeforeCaptureDate: !!dueDate && dueDate < sourceDate });
    }
  }
  if (!tasks.length || tasks.length > 200) fail('Import requires 1–200 cards; no partial batch was produced.');
  const countBy = field => Object.fromEntries([...new Set(mapping.map(row => row[field]))].map(value => [value, mapping.filter(row => row[field] === value).length]));
  const report = {
    format: 'itrc-legacy-board-import-preview', version: 1, offlineOnly: true, applied: false,
    source: { path: SOURCE_PATH, url: SOURCE_URL, capturedAt: bundle.createdAt, captureDateTaipei: sourceDate, boardVersion: board.v,
      boardSha256: entry.sha256, backupChecksum: checksum.value, eventCount: (board.events || []).length, listCount: board.lists.length },
    counts: { cards: tasks.length, byStatus: countBy('status'), assigned: mapping.filter(row => row.ownerPersonId).length,
      unassigned: mapping.filter(row => !row.ownerPersonId).length, ownerResolution: countBy('ownerResolution'),
      dueBeforeCaptureDate: mapping.filter(row => row.dueBeforeCaptureDate).length,
      duplicateSourceKeysAlreadyInOperations: mapping.filter(row => row.alreadyInOperations).length,
      proposedNew: mapping.filter(row => !row.alreadyInOperations).length },
    mapping,
    notes: [
      '僅準備本機匯入預覽；未寫入正式系統，也未修改原看板。',
      '原欄位進度直接映射為 todo/doing/done；沒有由期限、姓名、文字或勾選推論完成。',
      '不建立活動、專案、貼文關聯；原 wid 僅留在任務備註。',
      '原有期限原樣保留；過期不等於本學期待辦，也不等於已完成。',
      '現任姓名需唯一精確匹配；離任、未對上或有歧義者維持未指派。',
      '固定 sourceKey 可供正式匯入去重；重跑不代表應覆寫已匯入任務的新狀態。',
      '正式匯入前仍須核對最新 boards/itrc 與現任 people，並核對匯入預覽維持原進度。',
    ],
  };
  return { payload: { events: [], posts: [], tasks }, report };
}

function main(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--backup', '--out-dir'].includes(argv[index]) || !argv[index + 1]) fail('Usage: node scripts/prepare-legacy-board-import.cjs --backup FILE --out-dir DIRECTORY');
    args[argv[index]] = argv[index + 1];
  }
  if (!args['--backup'] || !args['--out-dir']) fail('Both --backup and --out-dir are required.');
  const input = resolve(args['--backup']), outDir = resolve(args['--out-dir']);
  const bytes = readFileSync(input);
  const result = convertBackup(JSON.parse(bytes.toString('utf8')));
  result.report.source.backupFile = basename(input);
  result.report.source.backupFileSha256 = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const [name, data] of [['legacy-board-import.json', result.payload], ['legacy-board-import-report.json', result.report]]) {
    const target = join(outDir, name);
    if (target === input) fail('Refusing to overwrite the source backup.');
    writeFileSync(target, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    chmodSync(target, 0o600);
  }
  console.log(JSON.stringify({ offlineOnly: true, applied: false, ...result.report.counts, outDir }));
}

module.exports = { convertBackup, resolveOwner, digest, SOURCE_URL };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
