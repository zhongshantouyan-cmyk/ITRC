const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFingerprint } = require('./maintenance-check');
const { previewWritePolicy, createPreviewWriteGuard } = require('./preview-policy');

test('preview writes require both an explicit isolated-database flag and a different identity', () => {
    const env = { VERCEL_ENV: 'preview', TURSO_DATABASE_URL: 'https://preview.example.invalid' };
    assert.equal(previewWritePolicy(env).allowed, false);
    env.ITRC_ALLOW_ISOLATED_PREVIEW_WRITES = 'true';
    assert.equal(previewWritePolicy(env).allowed, false);
    env.ITRC_PRODUCTION_DB_FINGERPRINT = databaseFingerprint(env.TURSO_DATABASE_URL);
    assert.equal(previewWritePolicy(env).allowed, false);
    env.ITRC_PRODUCTION_DB_FINGERPRINT = databaseFingerprint('https://production.example.invalid');
    assert.equal(previewWritePolicy(env).allowed, true);
    assert.equal(previewWritePolicy({ VERCEL_ENV: 'production' }).allowed, true);
});

test('preview guard blocks writes and side-effect GET endpoints, and allows reads', () => {
    const guard = createPreviewWriteGuard({ VERCEL_ENV: 'preview' });
    for (const [method, path] of [['POST', '/api/ops/actions'], ['DELETE', '/api/members/3'],
        ['GET', '/api/ops/jobs/tick'], ['GET', '/api/ops/connections/canva/callback'],
        ['GET', '/api/ops/jobs/TICK/'], ['HEAD', '/api/ops/connections/canva/CALLBACK/']]) {
        let status;
        const res = { status(n) { status = n; return this; }, json(value) { return value; } };
        assert.equal(guard({ method, path }, res, () => { throw new Error('mutation allowed'); }).code, 'PREVIEW_READ_ONLY');
        assert.equal(status, 503);
    }
    let called = false;
    guard({ method: 'GET', path: '/api/ops/bootstrap' }, {}, () => { called = true; });
    assert.equal(called, true);
});
