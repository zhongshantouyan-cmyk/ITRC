const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { POLICY, createGitHubCronVerifier } = require('./github-cron-auth');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = Math.floor(Date.now() / 1000);
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const base = { iss: POLICY.issuer, aud: POLICY.audience,
    sub: `repo:${POLICY.repository}:ref:${POLICY.ref}`, repository: POLICY.repository,
    repository_id: POLICY.repositoryId, repository_owner_id: POLICY.ownerId,
    ref: POLICY.ref, workflow_ref: POLICY.workflowRef, runner_environment: 'github-hosted',
    event_name: 'schedule', iat: now, nbf: now - 1, exp: now + 300, jti: 'test-jti', run_id: '42' };
const sign = patch => jwt.sign(Object.fromEntries(Object.entries({ ...base, ...patch }).filter(([, value]) => value !== undefined)), privateKey, { algorithm: 'RS256', keyid: 'test-key' });
const fixture = () => createGitHubCronVerifier({ now: () => now * 1000,
    fetchImpl: async url => {
        assert.equal(url, POLICY.jwksUrl);
        return new Response(JSON.stringify({ keys: [key] }), { headers: { 'Content-Type': 'application/json' } });
    } });

test('scheduler accepts only the signed identity of the exact main workflow', async () => {
    const verify = fixture();
    assert.deepEqual(await verify(sign({})), { runId: '42', tokenId: 'test-jti' });
    await verify(sign({ event_name: 'workflow_dispatch',
        sub: `repo:zhongshantouyan-cmyk@${POLICY.ownerId}/ITRC@${POLICY.repositoryId}:ref:${POLICY.ref}` }));
});

test('scheduler rejects forks, other workflows, previews, pull requests and untrusted claims', async () => {
    const verify = fixture();
    for (const patch of [
        { repository: 'attacker/ITRC' }, { repository_id: '1' }, { repository_owner_id: '1' },
        { ref: 'refs/heads/feature/test' }, { workflow_ref: POLICY.workflowRef.replace('ops-queue', 'other') },
        { event_name: 'pull_request' }, { event_name: 'push' }, { runner_environment: 'self-hosted' },
        { sub: 'repo:attacker/ITRC:ref:refs/heads/main' }, { aud: 'different-service' },
        { iss: 'https://attacker.example.invalid' }, { jti: '' }, { nbf: undefined },
    ]) await assert.rejects(verify(sign(patch)));
});

test('scheduler rejects expired, future, long-lived, unsigned and modified tokens', async () => {
    const verify = fixture();
    for (const patch of [{ exp: now - 30 }, { iat: now - 900, nbf: now - 900, exp: now + 30 },
        { iat: now + 60 }, { nbf: now + 60 }, { exp: now + 3600 }]) await assert.rejects(verify(sign(patch)));
    await assert.rejects(verify(jwt.sign(base, '', { algorithm: 'none' })));
    const token = sign({});
    await assert.rejects(verify(token.slice(0, -16) + 'tampered_value'));
    await assert.rejects(verify('x'.repeat(17000)));
});

test('scheduler key lookup failures deny access', async () => {
    const verify = createGitHubCronVerifier({ fetchImpl: async () => new Response('not keys', { status: 503 }) });
    await assert.rejects(verify(sign({})));
});
