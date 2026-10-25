const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFingerprint, maintenanceCheck } = require('./maintenance-check');

test('preview needs a different verified database connection identity', () => {
    const production = 'libsql://production.example.invalid';
    const hash = databaseFingerprint(production);
    assert.equal(databaseFingerprint('https://production.example.invalid/'), hash);
    assert.equal(maintenanceCheck({ VERCEL_ENV: 'preview', TURSO_DATABASE_URL: production }).previewWritesReadyForReview, false);
    assert.equal(maintenanceCheck({ VERCEL_ENV: 'preview', TURSO_DATABASE_URL: production, ITRC_PRODUCTION_DB_FINGERPRINT: hash }).isolationStatus, 'same_database_as_production');
    assert.equal(maintenanceCheck({ VERCEL_ENV: 'preview', TURSO_DATABASE_URL: 'libsql://test.example.invalid', ITRC_PRODUCTION_DB_FINGERPRINT: hash }).previewWritesReadyForReview, true);
});

test('maintenance report does not reveal database URL credentials or auth token', () => {
    const result = JSON.stringify(maintenanceCheck({ VERCEL_ENV: 'preview',
        TURSO_DATABASE_URL: 'https://private-user:private-password@database.example.invalid?token=private-query',
        TURSO_AUTH_TOKEN: 'private-token' }));
    for (const value of ['private-user', 'private-password', 'private-query', 'private-token', 'database.example.invalid']) assert.equal(result.includes(value), false);
});
