const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyAuthPolicy } = require('./legacy-auth-policy');

test('missing or publicly documented JWT keys never enable legacy login', () => {
    for (const secret of [undefined, '', '   ', 'itrc-secret-key-change-in-production']) {
        assert.equal(legacyAuthPolicy({ JWT_SECRET: secret }).enabled, false);
        assert.equal(legacyAuthPolicy({ JWT_SECRET: secret, ALLOW_LEGACY_JWT: 'true' }).enabled, false);
    }
});

test('configured legacy keys preserve compatibility and explicit disable wins', () => {
    const secret = 'fictional-test-only-key-not-used-by-a-deployment';
    assert.deepEqual(legacyAuthPolicy({ JWT_SECRET: secret }), { secret, enabled: true });
    assert.equal(legacyAuthPolicy({ JWT_SECRET: secret, ALLOW_LEGACY_JWT: ' FALSE ' }).enabled, false);
});
