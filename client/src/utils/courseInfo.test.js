import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCourseInfo } from './courseInfo.js';

test('old API payload cannot render internal roster or spreadsheet links', () => {
    assert.deepEqual(publicCourseInfo(JSON.stringify({ time: '週五', members: 'https://docs.google.com/spreadsheets/d/private/edit',
        email: 'https://docs.google.com/spreadsheets/d/private/edit', LINE: 'private' })), { time: '週五' });
    assert.deepEqual(publicCourseInfo('invalid'), {});
});

test('registration link must be a Google Forms fill URL', () => {
    const valid = 'https://docs.google.com/forms/d/e/example/viewform?usp=dialog';
    assert.deepEqual(publicCourseInfo({ registrationFormUrl: valid }), { registrationFormUrl: valid });
    assert.deepEqual(publicCourseInfo({ '入社報名': valid }), { registrationFormUrl: valid });
    for (const url of ['javascript:alert(1)', 'https://docs.google.com/forms/d/example/edit', 'https://docs.google.com.evil.invalid/forms/d/example/viewform']) {
        assert.deepEqual(publicCourseInfo({ registrationFormUrl: url }), {});
    }
});


test('replaces only the old professor value returned by CMS', () => {
    assert.deepEqual(publicCourseInfo({ professor: '王昭文 教授', time: '每週五' }),
        { professor: '封之遠 副教授', time: '每週五' });
    assert.deepEqual(publicCourseInfo({ professor: '王昭文教授' }), { professor: '封之遠 副教授' });
    assert.deepEqual(publicCourseInfo({ professor: '其他教授' }), { professor: '其他教授' });
});
