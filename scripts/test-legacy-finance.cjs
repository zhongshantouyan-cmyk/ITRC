// Fictional records and rule snapshots only. No Firebase connection or production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const finance = require('../legacy-tools/itrc-finance.js');
const roster = require('../legacy-tools/itrc-roster.js');
const { buildFinanceRules, mergeFinanceRules } = require('./build-finance-rules.cjs');
const now = '2026-10-26T02:00:00.000Z';
const applicant = { uid: 'fictional-applicant', name: '測試申請人', email: 'officer@example.invalid' };
const chair = { uid: 'fictional-chair', name: '測試審核人', email: 'chair@example.invalid' };
const treasurer = { uid: 'fictional-treasurer', name: '測試財務', email: 'treasurer@example.invalid' };
const club = { uid: 'fictional-club', name: '測試社團', email: 'club@example.invalid' };
const input = { members: [applicant.email, chair.email, treasurer.email, club.email], superAdmins: [club.email], financeApprovers: [chair.email], ledgerWriters: [treasurer.email] };
const rules = buildFinanceRules(input);
const fields = { amount: 300, date: '2026-10-26', cat: '測試', item: '隔離測試資料', note: '', payMethod: 'cash', account: '', receipt: '' };
const claim = () => finance.claim(fields, applicant, 'fictional-claim', now);
const clone = value => JSON.parse(JSON.stringify(value));
const auth = person => ({ uid: person.uid, token: { email: person.email, email_verified: true } });

class Snapshot {
  constructor(root, at = []) { this.root = root; this.at = at; }
  val() { let value = this.root; for (const key of this.at) value = value?.[key]; return value ?? null; }
  child(key) { return new Snapshot(this.root, [...this.at, ...String(key).split('/').filter(Boolean)]); }
  parent() { return new Snapshot(this.root, this.at.slice(0, -1)); }
  exists() { return this.val() !== null; }
  isNumber() { return typeof this.val() === 'number'; }
  isString() { return typeof this.val() === 'string'; }
}
function predicate(expression, old, next, pathname, person, query = {}) {
  if (typeof expression === 'boolean') return expression;
  expression = expression.replace(/(\$claim|\$entry)\.matches\((\/[^\n]+?\/)\)/g, '$2.test($1)');
  const at = pathname.split('/'), key = at.at(-1);
  try { return new Function('auth','root','data','newData','query','$claim','$entry', `return (${expression});`)(person, new Snapshot(old), new Snapshot(old, at), new Snapshot(next, at), query, key, key) === true; }
  catch { return false; }
}
function allowed(collection, old, next, key, person) {
  const node = rules[collection][collection === 'ledger' ? '$entry' : '$claim'];
  return predicate(node['.write'], old, next, `finance/${collection}/${key}`, auth(person)) && predicate(node['.validate'], old, next, `finance/${collection}/${key}`, auth(person));
}
function base(row = claim()) { return { finance: { ledger: { '0': { id: 'historic-0', amount: 1000, type: 'in', date: '2026-01-01', item: '虛構歷史明細', cat: '', note: '', by: '測試', ref: '' } }, reimbursements: { 'fictional-claim': row } } }; }

test('claim requires integral positive amounts and a raster receipt, leaves source data unchanged', () => {
  assert.throws(() => finance.claim({ ...fields, amount: 0.4 }, applicant, 'id', now), /正整數/);
  assert.throws(() => finance.claim({ ...fields, receipt: 'data:image/svg+xml,<svg/>' }, applicant, 'id', now), /PNG/);
  assert.throws(() => finance.claim({ ...fields, payMethod: 'transfer' }, applicant, 'id', now), /收款帳戶/);
  assert.equal(claim().byUid, applicant.uid);
  assert.equal(claim().status, 'submitted');
});
test('review forbids self-approval, requires rejection reason, and preserves the original application', () => {
  const row = claim();
  assert.throws(() => finance.review(row, applicant, true, '', now), /不能核准/);
  assert.throws(() => finance.review(row, chair, false, '', now), /原因/);
  assert.equal(finance.review(row, chair, true, '', now).approverUid, chair.uid);
  assert.equal(row.status, 'submitted');
});
test('atomic posting retains legacy numeric keys, uses deterministic ledger key, and cannot duplicate a claim', () => {
  const row = { ...finance.review(claim(), chair, true, '', now), _key: '0' };
  const out = finance.posting(row, [], treasurer, now);
  assert.deepEqual(Object.keys(out.updates), ['finance/ledger/reimb_0', 'finance/reimbursements/0']);
  assert.equal(out.ledgerKey, 'reimb_0');
  assert.equal(out.claim.ledgerKey, 'reimb_0');
  assert.equal(out.ledger.ref, row.id);
  assert.equal(out.ledger.claimKey, '0');
  assert.ok(!('_key' in out.claim));
  assert.throws(() => finance.posting(row, [out.ledger], treasurer, now), /重複入帳/);
});
test('manual void preserves historical amount, affects totals, and cannot erase reimbursement posting evidence', () => {
  const entry = finance.manual({ ...fields, type: 'in' }, treasurer, 'entry', now);
  const voided = finance.voidEntry(entry, treasurer, '測試更正', now);
  assert.equal(voided.amount, 300);
  assert.deepEqual(finance.totals([entry, { type: 'out', amount: 50 }, voided]), { income: 300, expense: 50 });
  assert.throws(() => finance.voidEntry({ ...entry, ref: 'claim' }, treasurer, '更正', now), /調整分錄/);
});
test('rules refuse root grants and capability lists that expand approved membership', () => {
  assert.throws(() => buildFinanceRules({ ...input, ledgerWriters: ['outsider@example.invalid'] }), /outside/);
  assert.throws(() => mergeFinanceRules({ ...input, existingRules: { rules: { '.read': true, '.write': false } } }), /root/);
  const merged = mergeFinanceRules({ ...input, existingRules: { rules: { '.read': false, '.write': false, roles: { '.read': 'unchanged' } } } });
  assert.equal(merged.rules.roles['.read'], 'unchanged');
  assert.equal(merged.rules.finance['.write'], false);
  assert.equal(merged.rules.finance.reimbursements['.write'], false);
  assert.equal(merged.rules.finance.ledger['.write'], false);
});
test('data rules allow only an authenticated member to create their own submitted application', () => {
  const old = { finance: { reimbursements: {} } }, next = base();
  assert.ok(allowed('reimbursements', old, next, 'fictional-claim', applicant));
  assert.equal(allowed('reimbursements', old, next, 'fictional-claim', chair), false);
  const elevated = clone(next); elevated.finance.reimbursements['fictional-claim'].status = 'approved';
  assert.equal(allowed('reimbursements', old, elevated, 'fictional-claim', applicant), false);
  const invalid = auth(applicant); invalid.token.email_verified = false;
  assert.equal(predicate(rules.reimbursements.$claim['.write'], old, next, 'finance/reimbursements/fictional-claim', invalid), false);
  assert.equal(predicate(rules.reimbursements.$claim['.write'], old, next, 'finance/reimbursements/fictional-claim', null), false);
});
test('data rules enforce reviewer identity, disallow self-review, and forbid changes to application amount', () => {
  const old = base(), next = base(finance.review(claim(), chair, true, '', now));
  assert.ok(allowed('reimbursements', old, next, 'fictional-claim', chair));
  assert.equal(allowed('reimbursements', old, next, 'fictional-claim', applicant), false);
  assert.equal(allowed('reimbursements', old, next, 'fictional-claim', treasurer), false);
  const changed = clone(next); changed.finance.reimbursements['fictional-claim'].amount++;
  assert.equal(allowed('reimbursements', old, changed, 'fictional-claim', chair), false);
  const self = base(finance.claim(fields, club, 'fictional-claim', now)), attempt = clone(self);
  Object.assign(attempt.finance.reimbursements['fictional-claim'], { status: 'approved', approver: club.name, approverUid: club.uid, approvedAt: now });
  assert.equal(allowed('reimbursements', self, attempt, 'fictional-claim', club), false);
});
test('data rules require both halves of an atomic posting, preserve historical entries, and reject replay', () => {
  const reviewed = finance.review(claim(), chair, true, '', now), old = base(reviewed);
  const out = finance.posting(reviewed, [], treasurer, now), next = clone(old);
  next.finance.ledger[out.ledgerKey] = out.ledger; next.finance.reimbursements[out.claimKey] = out.claim;
  assert.ok(allowed('ledger', old, next, out.ledgerKey, treasurer));
  assert.ok(allowed('reimbursements', old, next, out.claimKey, treasurer));
  assert.deepEqual(next.finance.ledger['0'], old.finance.ledger['0']);
  const ledgerOnly = clone(old); ledgerOnly.finance.ledger[out.ledgerKey] = out.ledger;
  assert.equal(allowed('ledger', old, ledgerOnly, out.ledgerKey, treasurer), false);
  const claimOnly = clone(old); claimOnly.finance.reimbursements[out.claimKey] = out.claim;
  assert.equal(allowed('reimbursements', old, claimOnly, out.claimKey, treasurer), false);
  assert.equal(allowed('ledger', next, next, out.ledgerKey, treasurer), false);
  assert.equal(allowed('reimbursements', next, next, out.claimKey, treasurer), false);
});
test('data rules restrict ledger writes, forbid deletion, and retain immutable fields on void', () => {
  const old = base(), next = clone(old), entry = finance.manual({ ...fields, type: 'in' }, treasurer, 'new-entry', now);
  next.finance.ledger['new-entry'] = entry;
  assert.ok(allowed('ledger', old, next, 'new-entry', treasurer));
  assert.equal(allowed('ledger', old, next, 'new-entry', chair), false);
  assert.equal(allowed('ledger', old, next, 'new-entry', applicant), false);
  const removed = clone(old); delete removed.finance.ledger['0'];
  assert.equal(allowed('ledger', old, removed, '0', treasurer), false);
  const voided = clone(old); voided.finance.ledger['0'] = finance.voidEntry(old.finance.ledger['0'], treasurer, '更正', now);
  assert.ok(allowed('ledger', old, voided, '0', treasurer));
  voided.finance.ledger['0'].amount = 1;
  assert.equal(allowed('ledger', old, voided, '0', treasurer), false);
});
test('data rules restrict bank-account/receipt list reads to own query or financial processors', () => {
  const old = base(), expression = rules.reimbursements['.read'];
  assert.equal(predicate(expression, old, old, 'finance/reimbursements', auth(applicant)), false);
  assert.ok(predicate(expression, old, old, 'finance/reimbursements', auth(applicant), { orderByChild: 'byUid', equalTo: applicant.uid }));
  assert.equal(predicate(expression, old, old, 'finance/reimbursements', auth(applicant), { orderByChild: 'byUid', equalTo: chair.uid }), false);
  assert.ok(predicate(expression, old, old, 'finance/reimbursements', auth(chair)));
  assert.ok(predicate(expression, old, old, 'finance/reimbursements', auth(treasurer)));
});
test('roster merge preserves IDs, absent contacts, unlisted records, and never grants a role from a title', () => {
  const old = [{ id: 'old-id', name: '甲', email: 'a@example.invalid', role: 'officer' }, { id: 'stay', name: '乙', email: 'b@example.invalid', role: 'chair' }];
  const result = roster.merge(old, [{ name: '甲', email: 'a@example.invalid', personId: 'ITRC-P0001', title: '財務長' }, { name: '丙', personId: 'ITRC-P0003', email: '' }], club, now, () => 'new-id');
  assert.equal(result.length, 3); assert.equal(result[0].id, 'old-id'); assert.equal(result[0].role, 'officer'); assert.equal(result[1].id, 'stay'); assert.equal(result[2].role, '');
  const again = roster.merge(result, [{ name: '丙', personId: 'ITRC-P0003' }], club, now, () => 'unwanted-id');
  assert.equal(again.length, 3); assert.equal(again[2].id, 'new-id');
});
test('departure clears access while retaining identity/history, and normal import cannot reactivate it', () => {
  const row = { id: 'old-id', name: '甲', personId: 'ITRC-P0001', email: 'a@example.invalid', role: 'officer', arbitraryHistory: 'preserve' };
  const retired = roster.merge([row], [{ name: '甲', personId: row.personId, status: '已卸任' }], club, now, () => 'nope')[0];
  assert.equal(retired.role, ''); assert.equal(retired.status, 'retired'); assert.equal(retired.id, row.id); assert.equal(retired.arbitraryHistory, 'preserve'); assert.equal(retired.previousRole, 'officer');
  const reimported = roster.merge([retired], [{ name: '甲', personId: row.personId, status: '在任', role: 'chair' }], club, now, () => 'nope')[0];
  assert.equal(reimported.role, ''); assert.ok(roster.inactive(reimported));
});
test('conflicting identity and duplicate mail in roster imports are blocked', () => {
  const rows = [{ id: 'a', name: '甲', personId: 'P1', email: 'a@example.invalid', role: '' }, { id: 'b', name: '乙', personId: 'P2', email: 'b@example.invalid', role: '' }];
  assert.throws(() => roster.merge(rows, [{ name: '甲', personId: 'P1', email: 'b@example.invalid' }], club, now, () => 'new'), /不同的人/);
  assert.throws(() => roster.merge(rows, [{ name: '甲', personId: 'P1' }, { name: '甲重複', email: 'a@example.invalid' }], club, now, () => 'new'), /重複/);
});

function inlinePage(filename, extra = {}) {
  const nodes = new Map();
  const doc = { addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', textContent: '', style: {}, classList: { toggle() {} }, focus() {}, addEventListener() {}, setAttribute() {}, getAttribute() {}, appendChild() {} });
    return nodes.get(id);
  } };
  const messages = [], alerts = [], storage = new Map();
  const context = { window: { addEventListener() {}, itrcToast: text => messages.push(text) }, document: doc,
    ITRCAuth: { user: { ...applicant, role: 'officer' }, init() {}, can: () => true, isDev: () => false, ROLE_LABEL: {} },
    ITRCFinance: finance, ITRCRoster: roster, alert: text => alerts.push(text), confirm: () => true, prompt: () => '測試',
    localStorage: { getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value) },
    setTimeout() {}, ...extra,
  };
  const html = fs.readFileSync(path.join(__dirname, '../legacy-tools', filename), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (match[1].trim()) vm.runInNewContext(match[1], context);
  return { context, nodes, messages, alerts, doc };
}
test('financial UI never reports success before acknowledgement and preserves the form after rejection', async () => {
  const f = inlinePage('ITRC財務站.html'), c = f.context;
  Object.assign(c, { financeConnected: true, financeLoaded: { ledger: true, reimb: true } });
  let settle, attempts = 0;
  c.fbReimb = { push: () => ({ key: 'fixture-key' }), child: () => ({ set: () => { attempts++; return new Promise((_resolve,reject) => { settle = reject; }); } }) };
  for (const [id, value] of Object.entries({ ap_amount: '300', ap_item: '測試用途', ap_cat: '測試', ap_date: '2026-10-26', ap_pay: 'cash', ap_acct: '', ap_note: '' })) f.doc.getElementById(id).value = value;
  const pending = c.submitReimb(); await Promise.resolve();
  assert.equal(attempts, 1); assert.equal(f.messages.length, 0); assert.equal(c.REIMB.length, 0);
  settle(new Error('PERMISSION_DENIED')); await pending;
  assert.equal(f.doc.getElementById('ap_item').value, '測試用途'); assert.equal(f.messages.length, 0); assert.match(f.alerts.at(-1), /尚未儲存/);
});
test('revoked finance reads clear sensitive in-memory records and cannot be restored by late events', () => {
  const { context: c } = inlinePage('ITRC財務站.html');
  let receive, reject, detached=0;
  const ref={on(_event,callback,error){receive=callback;reject=error;},off(){detached++;}};
  c.financeWatch(ref,()=>{c.LEDGER=[{id:'should-not-return'}];});
  c.LEDGER=[{id:'fixture'}];c.REIMB=[{account:'fictional-account'}];c.financeConnected=true;c.financeLoaded={ledger:true,reimb:true};
  reject(new Error('PERMISSION_DENIED'));
  assert.equal(c.LEDGER.length,0);assert.equal(c.REIMB.length,0);assert.equal(detached,1);assert.equal(c.financeReady(),false);
  receive({val:()=>true});assert.equal(c.LEDGER.length,0);
});
test('roster UI maps canonical columns and retains both existing people when importing one departure', () => {
  const f = inlinePage('ITRC管理組-幹部與權限.html'), c = f.context;
  c.DATA = [{ id: 'old-a', name: '甲', email: 'a@example.invalid', title: '幹部', role: 'officer' }, { id: 'old-b', name: '乙', email: 'b@example.invalid', title: '社長', role: 'chair' }];
  f.doc.getElementById('imp_text').value = '職稱\t姓名\tEMAIL\tLINE 名稱\t組別\t幹部 ID\t任期\t在任狀態\n行銷\t甲\ta@example.invalid\t測試LINE\t行銷\tITRC-P0001\t115-1\t已卸任';
  c.parseImport();
  assert.equal(c.IMPORT_ROWS.length, 2); assert.equal(c.IMPORT_ROWS[0].personId, 'ITRC-P0001'); assert.equal(c.IMPORT_ROWS[0].lineName, '測試LINE');
  assert.equal(c.IMPORT_ROWS[0].role, ''); assert.equal(c.IMPORT_ROWS[1].role, 'chair'); assert.equal(c.DATA[0].role, 'officer');
});
test('live role revocation removes an already signed-in user and detaches listener at sign-out', () => {
  let authChanged, roleChanged, off = 0;
  const ref = { on(_event,callback) { roleChanged = callback; }, off() { off++; } };
  const context = { window: {}, document: {}, location: { hostname: 'tools.example.invalid', protocol: 'https:' },
    firebase: { apps: [{}], auth: () => ({ onAuthStateChanged(fn) { authChanged = fn; } }), database: () => ({ ref: () => ref }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../legacy-tools/itrc-auth.js'), 'utf8'), context);
  const a = context.window.ITRCAuth; a.init({ onChange() {} }); authChanged({ uid: applicant.uid, email: applicant.email, emailVerified: true });
  roleChanged({ val: () => [{ email: applicant.email, role: 'officer' }] }); assert.equal(a.user.role, 'officer');
  roleChanged({ val: () => [{ email: applicant.email, role: 'officer', status: 'retired', disabled: true }] }); assert.equal(a.user.role, null);
  authChanged(null); assert.equal(off, 1); assert.equal(a.user, null);
});
test('legacy record IDs cannot inject code through inline event handlers', () => {
  for (const page of ['ITRC財務站.html','ITRC管理組-幹部與權限.html']) {
    const { context } = inlinePage(page);
    const malicious = "x');throw new Error('injected');('";
    const escaped = context.eventId(malicious).replace(/&quot;/g,'"').replace(/&amp;/g,'&');
    const value = new Function(`return '${escaped}';`)();
    assert.equal(value, malicious);
  }
});
