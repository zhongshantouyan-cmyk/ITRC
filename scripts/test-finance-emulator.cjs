// Runs against the local official Firebase Database Emulator only.
// Start v4.11.2 at 127.0.0.1:9900 first. No production host or credentials accepted.
const assert = require('node:assert/strict');
const finance = require('../legacy-tools/itrc-finance.js');
const { buildFinanceRules } = require('./build-finance-rules.cjs');
const namespace = 'demo-itrc-finance';
const baseUrl = 'http://127.0.0.1:9900';
const now = '2026-10-26T02:00:00.000Z';
const applicant = { uid: 'fictional-applicant', name: '測試申請人', email: 'officer@example.invalid' };
const chair = { uid: 'fictional-chair', name: '測試簽核人', email: 'chair@example.invalid' };
const treasury = { uid: 'fictional-treasury', name: '測試財務', email: 'treasury@example.invalid' };
const club = { uid: 'fictional-club', name: '測試社團', email: 'club@example.invalid' };
const outsider = { uid: 'fictional-outsider', name: '測試外部人員', email: 'outsider@example.invalid' };
const fields = { amount: 300, date: '2026-10-26', cat: '測試', item: '虛構核銷', note: '', payMethod: 'cash', account: '', receipt: '' };
let count = 0;
function token(user) {
  const iat = Math.floor(Date.now() / 1000);
  const body = { iss: `https://securetoken.google.com/${namespace}`, aud: namespace, sub: user.uid, user_id: user.uid, iat, exp: iat + 3600, auth_time: iat,
    email: user.email, email_verified: user.emailVerified !== false, name: user.name, firebase: { identities: { email: [user.email] }, sign_in_provider: 'google.com' } };
  return Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.';
}
async function request(method, path, value, user, parameters = {}) {
  const url = new URL(`${path}.json`, baseUrl); url.searchParams.set('ns', namespace);
  for (const [key,value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const headers = { 'content-type': 'application/json' };
  if (user === 'owner') headers.authorization = 'Bearer owner'; else if (user) url.searchParams.set('auth', token(user));
  const response = await fetch(url, { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
async function allow(label, ...args) { const r = await request(...args); assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.body)}`); count++; return r.body; }
async function deny(label, ...args) { const r = await request(...args); assert.ok([401,403].includes(r.status), `${label}: expected denial, got ${r.status}: ${JSON.stringify(r.body)}`); count++; }
async function main() {
  const policy = buildFinanceRules({ members: [applicant.email, chair.email, treasury.email, club.email], financeApprovers: [chair.email], ledgerWriters: [treasury.email], superAdmins: [club.email] });
  await allow('rules compile in official emulator', 'PUT', '/.settings/rules', { rules: { '.read': false, '.write': false, finance: policy } }, 'owner');
  const history = {};
  for (let i=0;i<47;i++) history[String(i)] = { id: `fictional-history-${i}`, date: '2026-01-01', type: i%2 ? 'out' : 'in', cat: '虛構歷史', item: '隔離環境明細', amount: 100+i, note: '', by: '測試資料', ref: '' };
  await allow('load only fictional initial records', 'PUT', '/', { finance: { ledger: history } }, 'owner');
  await allow('officer reads ledger', 'GET', '/finance/ledger', undefined, applicant);
  await deny('anonymous blocked', 'GET', '/finance/ledger', undefined, null);
  await deny('outside account blocked', 'GET', '/finance/ledger', undefined, outsider);
  await deny('unverified email blocked', 'GET', '/finance/ledger', undefined, { ...applicant, emailVerified: false });
  const claim = finance.claim(fields, applicant, 'claim-a', now);
  await allow('own application creation', 'PUT', '/finance/reimbursements/claim-a', claim, applicant);
  await deny('cannot create application for another uid', 'PUT', '/finance/reimbursements/claim-b', { ...claim, id: 'claim-b', byUid: chair.uid }, applicant);
  await deny('cannot preapprove own application', 'PUT', '/finance/reimbursements/claim-b', { ...claim, id: 'claim-b', status: 'approved' }, applicant);
  await deny('officer cannot read entire private claim list', 'GET', '/finance/reimbursements', undefined, applicant);
  await allow('officer reads own claims with enforced query', 'GET', '/finance/reimbursements', undefined, applicant, { orderBy: JSON.stringify('byUid'), equalTo: JSON.stringify(applicant.uid) });
  await deny('officer cannot query someone else', 'GET', '/finance/reimbursements', undefined, applicant, { orderBy: JSON.stringify('byUid'), equalTo: JSON.stringify(chair.uid) });
  await allow('reviewer reads private claims', 'GET', '/finance/reimbursements', undefined, chair);
  await deny('applicant cannot edit submitted amount', 'PUT', '/finance/reimbursements/claim-a', { ...claim, amount: 1 }, applicant);
  const ownChair = finance.claim(fields, chair, 'self-chair', now);
  await allow('reviewer can apply', 'PUT', '/finance/reimbursements/self-chair', ownChair, chair);
  await deny('reviewer cannot approve own request', 'PUT', '/finance/reimbursements/self-chair', { ...ownChair, status: 'approved', approver: chair.name, approverUid: chair.uid, approvedAt: now }, chair);
  const reviewed = finance.review(claim, chair, true, '', now);
  await deny('treasury cannot approve a request', 'PUT', '/finance/reimbursements/claim-a', reviewed, treasury);
  await deny('reviewer cannot alter an amount while approving', 'PUT', '/finance/reimbursements/claim-a', { ...reviewed, amount: 1 }, chair);
  await allow('independent reviewer approves', 'PUT', '/finance/reimbursements/claim-a', reviewed, chair);
  const post = finance.posting(reviewed, [], treasury, now);
  await deny('posting claim alone is forbidden', 'PUT', '/finance/reimbursements/claim-a', post.claim, treasury);
  await deny('posting ledger alone is forbidden', 'PUT', '/finance/ledger/' + post.ledgerKey, post.ledger, treasury);
  await deny('officer cannot post either half', 'PATCH', '/', post.updates, applicant);
  await allow('treasury atomic multipath posting', 'PATCH', '/', post.updates, treasury);
  await deny('posting replay is forbidden', 'PATCH', '/', post.updates, treasury);
  const after = await allow('inspect fictional ledger after posting', 'GET', '/finance/ledger', undefined, treasury);
  assert.equal(Object.keys(after).length, 48); for (const [key,value] of Object.entries(history)) assert.deepEqual(after[key], value);
  count++;
  await deny('delete historical ledger entry forbidden', 'DELETE', '/finance/ledger/0', undefined, treasury);
  await deny('delete posted claim forbidden', 'DELETE', '/finance/reimbursements/claim-a', undefined, treasury);
  await deny('whole finance overwrite forbidden', 'PUT', '/finance', { ledger: {} }, club);
  const manual = finance.manual({ ...fields, type: 'in' }, treasury, 'manual-a', now);
  await allow('treasury appends manual entry', 'PUT', '/finance/ledger/manual-a', manual, treasury);
  await deny('chair cannot write ledger', 'PUT', '/finance/ledger/manual-b', { ...manual, id:'manual-b', byUid:chair.uid }, chair);
  await deny('invalid amount rejected', 'PUT', '/finance/ledger/manual-b', { ...manual, id:'manual-b', amount:0.5 }, treasury);
  const voided = finance.voidEntry(history['0'], treasury, '虛構更正', now);
  await allow('historical manual entry can be voided with evidence', 'PUT', '/finance/ledger/0', voided, treasury);
  await deny('voided entry cannot be changed again', 'PUT', '/finance/ledger/0', { ...voided, amount:1 }, treasury);
  console.log(JSON.stringify({ passed: count, emulator: 'Firebase Database 4.11.2', namespace, productionConnections: 0, historicalFixtureRowsPreserved: 47 }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
