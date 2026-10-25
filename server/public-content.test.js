const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanCourseInfo, isRegistrationFormUrl, publicSection, publicSectionSearchRows,
    validateSectionContent, PUBLIC_MEMBER_COLUMNS } = require('./public-content');

test('course info exposes only approved public fields and fill-form URLs', () => {
    const form = 'https://docs.google.com/forms/d/e/example/viewform?usp=dialog';
    assert.deepEqual(cleanCourseInfo({ time: '週五', registrationFormUrl: form,
        members: 'https://docs.google.com/spreadsheets/d/private/edit', lineName: 'private',
        coordinators: 'https://docs.google.com/spreadsheets/d/private/edit' }), { time: '週五', registrationFormUrl: form });
    for (const url of ['javascript:alert(1)', 'https://docs.google.com/forms/d/example/edit',
        'https://docs.google.com.evil.invalid/forms/d/example/viewform', 'https://user@docs.google.com/forms/d/example/viewform']) {
        assert.equal(isRegistrationFormUrl(url), false);
        assert.throws(() => validateSectionContent('course_info', JSON.stringify({ registrationFormUrl: url })));
    }
    assert.equal(isRegistrationFormUrl(form), true);
    assert.deepEqual(cleanCourseInfo({ '入社報名': form }), { registrationFormUrl: form });
    assert.equal(isRegistrationFormUrl('https://forms.gle/example'), true);
    assert.throws(() => validateSectionContent('course_info', '{invalid'));
    assert.throws(() => validateSectionContent('course_info', JSON.stringify({ email: ['private'] })));
});

test('legacy response sheet cannot leak through section reads or search snippets', () => {
    const id = '1V-wopC1i-6GFNLFsWs2jSKiBggqvZQ0HiK9bORPIRBE';
    const content = JSON.stringify({ time: '週五', members: `https://docs.google.com/spreadsheets/d/${id}/edit` });
    const rows = [{ type: 'section', id: 'course_info', title: '課程資訊', snippet: content }];
    assert.equal(publicSection({ key: 'course_info', content }).content.includes(id), false);
    assert.deepEqual(publicSectionSearchRows(rows, id), []);
    assert.equal(publicSectionSearchRows(rows, '週五').length, 1);
    assert.equal(publicSectionSearchRows(rows, '週五')[0].snippet.includes('members'), false);
    assert.equal(publicSection({ key: 'notice', content: `報名 https://docs.google.com/spreadsheets/d/${id}/edit` }).content, '報名 ');
    assert.throws(() => validateSectionContent('notice', id));
});

test('public member schema does not grow when internal contact fields are introduced', () => {
    for (const field of ['email', 'EMAIL', 'lineName', 'lineUserId', 'permissions', 'personId']) {
        assert.equal(PUBLIC_MEMBER_COLUMNS.includes(field), false);
    }
    assert.ok(PUBLIC_MEMBER_COLUMNS.includes('department'));
    assert.ok(PUBLIC_MEMBER_COLUMNS.includes('role'));
});
