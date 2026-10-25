/* Generate finance-only RTDB rules from already approved private allowlists.
   Never deploys, connects to Firebase, or prints private addresses.
   CLI: node scripts/build-finance-rules.cjs INPUT.json OUTPUT.json
   INPUT: { existingRules: {rules:{...}}, members:[], superAdmins:[], financeApprovers:[], ledgerWriters:[] }
*/
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

function normalized(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an explicit array`);
  return [...new Set(values.map(v => String(v).trim().toLowerCase()))].sort().map(v => {
    if (!/^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(v)) throw new Error(`${label} contains an invalid address`);
    return v;
  });
}
function buildFinanceRules(input) {
  const members = normalized(input.members, 'members');
  const superAdmins = normalized(input.superAdmins, 'superAdmins');
  const approvers = [...new Set([...normalized(input.financeApprovers, 'financeApprovers'), ...superAdmins])];
  const writers = [...new Set([...normalized(input.ledgerWriters, 'ledgerWriters'), ...superAdmins])];
  if (!members.length || !approvers.length || !writers.length) throw new Error('Explicit member, approver, and treasury lists are required');
  if ([...superAdmins, ...approvers, ...writers].some(email => !members.includes(email))) throw new Error('Finance capabilities cannot add accounts outside the approved member allowlist');
  const auth = "auth != null && auth.token.email != null && auth.token.email_verified === true";
  const condition = values => `(${auth} && (${values.map(v => `auth.token.email.toLowerCase() === '${v}'`).join(' || ')}))`;
  const member = condition(members), review = condition(approvers), treasury = condition(writers);
  return buildFinanceRuleExpressions({ member, review, treasury });
}
function buildFinanceRuleExpressions({ member, review, treasury }) {
  const eq = name => `newData.child('${name}').val() === data.child('${name}').val()`;
  const same = fields => fields.map(eq).join(' && ');
  const applicationFields = ['id','created','date','byUid','byName','byEmail','amount','cat','item','note','payMethod','account','receipt'];
  const reviewFields = ['approver','approverUid','approvedAt','rejectReason'];
  const postingFields = ['postedAt','postedByUid','ledgerKey'];
  const ledgerFields = ['id','date','type','cat','item','amount','note','by','byUid','createdAt','ref','claimKey'];
  const amount = "newData.child('amount').isNumber() && newData.child('amount').val() > 0 && newData.child('amount').val() <= 1000000000 && newData.child('amount').val() % 1 === 0";
  const futureLedger = "newData.parent().parent().child('ledger').child('reimb_' + $claim)";
  const oldClaim = "root.child('finance').child('reimbursements').child(newData.child('claimKey').val())";
  const futureClaim = "newData.parent().parent().child('reimbursements').child(newData.child('claimKey').val())";
  const createClaim = [
    '!data.exists()', "$claim.matches(/^[A-Za-z0-9_-]+$/)", "newData.child('id').val() === $claim", "newData.child('byUid').val() === auth.uid",
    "newData.child('byEmail').val() === auth.token.email.toLowerCase()", "newData.child('status').val() === 'submitted'",
    ...[...reviewFields, ...postingFields].map(k => `newData.child('${k}').val() === ''`),
    "newData.child('byName').isString() && newData.child('byName').val().length > 0",
    "newData.child('created').isString() && newData.child('created').val().length >= 20",
    "newData.child('date').isString() && newData.child('date').val().length === 10",
    "newData.child('cat').isString() && newData.child('cat').val().length <= 200",
    "newData.child('note').isString() && newData.child('note').val().length <= 2000",
    "newData.child('receipt').isString() && newData.child('receipt').val().length <= 2500000",
    "((newData.child('payMethod').val() === 'cash' && newData.child('account').val() === '') || (newData.child('payMethod').val() === 'transfer' && newData.child('account').isString() && newData.child('account').val().length > 0 && newData.child('account').val().length <= 500))",
  ].join(' && ');
  const reviewClaim = [
    'data.exists()', review, same(applicationFields), same(postingFields),
    "data.child('status').val() === 'submitted'", "data.child('byUid').val() !== auth.uid",
    "newData.child('approverUid').val() === auth.uid", "newData.child('approver').isString() && newData.child('approver').val().length > 0",
    "newData.child('approvedAt').isString() && newData.child('approvedAt').val().length >= 20",
    "((newData.child('status').val() === 'approved' && newData.child('rejectReason').val() === '') || (newData.child('status').val() === 'rejected' && newData.child('rejectReason').isString() && newData.child('rejectReason').val().length > 0))",
  ].join(' && ');
  const postClaim = [
    'data.exists()', treasury, same(applicationFields), same(reviewFields),
    "data.child('status').val() === 'approved'", "newData.child('status').val() === 'posted'",
    "newData.child('postedByUid').val() === auth.uid", "newData.child('postedAt').isString() && newData.child('postedAt').val().length >= 20",
    "newData.child('ledgerKey').val() === 'reimb_' + $claim", `${futureLedger}.exists()`,
    `${futureLedger}.child('claimKey').val() === $claim`, `${futureLedger}.child('ref').val() === data.child('id').val()`,
    `${futureLedger}.child('amount').val() === data.child('amount').val()`, `${futureLedger}.child('byUid').val() === auth.uid`,
    `${futureLedger}.child('type').val() === 'out'`,
  ].join(' && ');
  const linkedEntry = [
    "newData.child('claimKey').isString() && newData.child('claimKey').val().length > 0",
    "$entry === 'reimb_' + newData.child('claimKey').val()", "newData.child('type').val() === 'out'",
    `${oldClaim}.child('status').val() === 'approved'`, `${futureClaim}.child('status').val() === 'posted'`,
    `${futureClaim}.child('ledgerKey').val() === $entry`, `${futureClaim}.child('postedByUid').val() === auth.uid`,
    `${oldClaim}.child('id').val() === newData.child('ref').val()`,
    ...['amount','date','item'].map(k => `${oldClaim}.child('${k}').val() === newData.child('${k}').val()`),
  ].join(' && ');
  const newEntry = [
    '!data.exists()', "$entry.matches(/^[A-Za-z0-9_-]+$/)", "newData.child('id').val() === $entry", "newData.child('byUid').val() === auth.uid",
    "!newData.child('voidedAt').exists()", "!newData.child('voidReason').exists()",
    "newData.child('createdAt').isString() && newData.child('createdAt').val().length >= 20",
    `((newData.child('ref').val() === '' && newData.child('claimKey').val() === '') || (${linkedEntry}))`,
  ].join(' && ');
  const voidEntry = [
    'data.exists()', '!data.child(\'voidedAt\').exists()',
    "(!data.child('ref').exists() || data.child('ref').val() === '')", same(ledgerFields),
    "newData.child('voidedByUid').val() === auth.uid", "newData.child('voidedBy').isString()",
    "newData.child('voidedAt').isString() && newData.child('voidedAt').val().length >= 20",
    "newData.child('voidReason').isString() && newData.child('voidReason').val().length > 0",
  ].join(' && ');
  return {
    '.read': false, '.write': false,
    ledger: {
      '.read': member, '.write': false,
      '$entry': {
        '.write': `${treasury} && newData.exists() && ((${newEntry}) || (${voidEntry}))`,
        '.validate': `${amount} && newData.child('item').isString() && newData.child('item').val().length > 0 && (newData.child('type').val() === 'in' || newData.child('type').val() === 'out')`,
      },
    },
    reimbursements: {
      '.read': `${member} && (${review} || ${treasury} || (query.orderByChild === 'byUid' && query.equalTo === auth.uid))`,
      '.write': false, '.indexOn': ['byUid'],
      '$claim': {
        '.read': `${member} && (${review} || ${treasury} || data.child('byUid').val() === auth.uid)`,
        '.write': `${member} && newData.exists() && ((${createClaim}) || (${reviewClaim}) || (${postClaim}))`,
        '.validate': `${amount} && newData.child('byUid').isString() && newData.child('id').isString() && newData.child('item').isString() && newData.child('item').val().length > 0 && newData.child('item').val().length <= 500`,
      },
    },
  };
}
function mergeFinanceRules(input) {
  const existing = JSON.parse(JSON.stringify(input.existingRules));
  if (!existing || !existing.rules || existing.rules['.read'] !== false || existing.rules['.write'] !== false) throw new Error('Refusing to modify rules with a root-level grant');
  existing.rules.finance = buildFinanceRules(input);
  return existing;
}
function buildFinanceRuleTemplate() { return buildFinanceRuleExpressions({ member: '__ITRC_MEMBER__', review: '__ITRC_REVIEW__', treasury: '__ITRC_TREASURY__' }); }
module.exports = { buildFinanceRules, mergeFinanceRules, buildFinanceRuleTemplate };
if (require.main === module) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Usage: node scripts/build-finance-rules.cjs INPUT.json OUTPUT.json');
  const result = JSON.stringify(mergeFinanceRules(JSON.parse(fs.readFileSync(inputPath, 'utf8'))), null, 2) + '\n';
  fs.writeFileSync(outputPath, result, { mode: 0o600 }); fs.chmodSync(outputPath, 0o600);
  process.stdout.write(JSON.stringify({ written: true, bytes: Buffer.byteLength(result), sha256: crypto.createHash('sha256').update(result).digest('hex') }) + '\n');
}
