const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildRules } = require('../scripts/build-rtdb-containment-rules.cjs');
const policy = {
    members: ['club@example.invalid', 'chair@example.invalid', 'treasurer@example.invalid', 'officer@example.invalid'],
    superAdmins: ['club@example.invalid'], rosterManagers: ['chair@example.invalid'], ledgerWriters: ['treasurer@example.invalid'],
};
const rules = buildRules(policy).rules;
const allowed = (expression, email, verified = true) => vm.runInNewContext(expression,
    { auth: email === null ? null : { token: { email, email_verified: verified } } });

test('containment denies root access and unknown or unverified accounts at known paths', () => {
    assert.equal(rules['.read'], false);
    assert.equal(rules['.write'], false);
    for (const email of [null, 'outsider@example.invalid']) assert.equal(allowed(rules.roles['.read'], email), false);
    assert.equal(allowed(rules.roles['.read'], 'club@example.invalid', false), false);
    assert.equal(allowed(rules.roles['.read'], 'club@example.invalid'), true);
    assert.equal(allowed(rules.roles['.read'], 'Club@Example.Invalid'), true);
    assert.equal(allowed(rules.roles['.read'], undefined), false);
    assert.equal(buildRules({ ...policy, members: policy.members.map(email => email.toUpperCase()) }).rules.roles['.read'], rules.roles['.read']);
});

test('containment keeps existing management and treasury boundaries without changing array formats', () => {
    assert.equal(allowed(rules.roles['.write'], 'officer@example.invalid'), false);
    assert.equal(allowed(rules.roles['.write'], 'chair@example.invalid'), true);
    assert.equal(allowed(rules.finance.ledger['.write'], 'chair@example.invalid'), false);
    assert.equal(allowed(rules.finance.ledger['.write'], 'treasurer@example.invalid'), true);
    assert.equal(allowed(rules.finance.ledger['.write'], 'club@example.invalid'), true);
    assert.equal(allowed(rules.finance.reimbursements['.write'], 'officer@example.invalid'), true);
});
