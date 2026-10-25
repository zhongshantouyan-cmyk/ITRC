#!/usr/bin/env node
// Offline containment-rule generator. Private input/output files must stay outside Git.
// This does not deploy rules or access Firebase. It intentionally preserves existing
// whole-array reimbursement writes; full financial authorization remains a separate migration.
const fs = require('node:fs');
const crypto = require('node:crypto');

function list(value, key) {
    if (!Array.isArray(value) || !value.length) throw new Error(`${key}: a non-empty verified account list is required`);
    const values = [...new Set(value.map(email => String(email).trim().toLowerCase()))];
    if (values.some(email => !/^[^\s@"'\\]+@[^\s@"'\\]+\.[^\s@"'\\]+$/.test(email))) throw new Error(`${key}: invalid account format`);
    return values;
}

function buildRules(policy) {
    const members = list(policy.members, 'members');
    const superAdmins = list(policy.superAdmins, 'superAdmins');
    const rosterManagers = list(policy.rosterManagers, 'rosterManagers');
    const ledgerWriters = list(policy.ledgerWriters, 'ledgerWriters');
    for (const group of [superAdmins, rosterManagers, ledgerWriters]) {
        if (group.some(email => !members.includes(email))) throw new Error('Privileged accounts must also be present in members');
    }
    const condition = values => `auth != null && auth.token.email != null && auth.token.email_verified === true && (${[...new Set(values)].map(email => `auth.token.email.toLowerCase() === ${JSON.stringify(email)}`).join(' || ')})`;
    const member = condition(members);
    const manager = condition([...rosterManagers, ...superAdmins]);
    const treasury = condition([...ledgerWriters, ...superAdmins]);
    const memberAccess = () => ({ '.read': member, '.write': member });
    return { rules: {
        '.read': false, '.write': false,
        roles: { '.read': member, '.write': manager },
        roles_archive: { '.read': manager, '.write': manager },
        boards: { itrc: memberAccess() },
        finance: {
            ledger: { '.read': member, '.write': treasury },
            reimbursements: memberAccess(),
        },
        sponsors: { records: memberAccess(), pipeline: memberAccess(), cands: memberAccess() },
        activities: { state: memberAccess() },
        certs: { positions: memberAccess(), template: memberAccess() },
    } };
}

if (require.main === module) {
    const [, , source, output] = process.argv;
    if (!source || !output) throw new Error('Usage: node scripts/build-rtdb-containment-rules.cjs PRIVATE_POLICY.json PRIVATE_RULES.json');
    const rules = buildRules(JSON.parse(fs.readFileSync(source, 'utf8')));
    const data = JSON.stringify(rules, null, 2) + '\n';
    fs.writeFileSync(output, data, { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ generated: true, deployed: false,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
        warning: 'Reimbursements remain shared whole-array writes. Validate Firebase Rules Playground cases before publication.' }) + '\n');
}
module.exports = { buildRules };
