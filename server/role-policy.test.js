const test = require('node:test');
const assert = require('node:assert/strict');
const { roleFromRecords } = require('./role-policy');

test('role resolution preserves existing roles and blocks every departure representation', () => {
    const person = { email: 'Person@example.invalid', role: 'officer', title: '社長' };
    assert.equal(roleFromRecords({ one: person }, 'person@EXAMPLE.invalid'), 'officer');
    for (const patch of [{ role: '' }, { role: 'admin' }, { active: false }, { disabled: true },
        { status: 'retired' }, { status: 'inactive' }, { status: '已卸任' }, { status: '非當期名單' }]) {
        assert.equal(roleFromRecords({ one: { ...person, ...patch } }, person.email), '');
    }
    assert.equal(roleFromRecords({ one: person, two: { ...person, role: 'chair' } }, person.email), '');
    assert.equal(roleFromRecords({ one: person, two: { ...person, status: 'retired' } }, person.email), '');
});
