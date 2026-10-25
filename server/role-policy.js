'use strict';

const ROLES = new Set(['advisor', 'chair', 'treasurer', 'officer']);
const RETIRED = new Set(['inactive', 'retired', 'disabled', '已卸任', '非當期名單', '暫停']);

function roleFromRecords(records, email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return '';
    const matches = Object.values(records || {}).filter(record =>
        record && String(record.email || '').trim().toLowerCase() === normalized);
    // Conflicting or disabled records fail closed. Titles never grant capabilities.
    if (!matches.length || matches.some(record => record.disabled === true || record.active === false ||
        RETIRED.has(String(record.status || '').trim().toLowerCase()))) return '';
    const roles = new Set(matches.map(record => record.role || ''));
    return roles.size === 1 && ROLES.has(matches[0].role) ? matches[0].role : '';
}

module.exports = { roleFromRecords };
