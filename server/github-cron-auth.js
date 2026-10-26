'use strict';
const { createPublicKey } = require('node:crypto');
const jwt = require('jsonwebtoken');

// Public identifiers of this deployment's own repository. No caller can select them.
const POLICY = Object.freeze({
    issuer: 'https://token.actions.githubusercontent.com',
    jwksUrl: 'https://token.actions.githubusercontent.com/.well-known/jwks',
    audience: 'https://itrc-eight.vercel.app/api/ops/jobs/tick',
    repository: 'zhongshantouyan-cmyk/ITRC', repositoryId: '1285692408', ownerId: '298517106',
    ref: 'refs/heads/main',
    workflowRef: 'zhongshantouyan-cmyk/ITRC/.github/workflows/ops-queue.yml@refs/heads/main',
});

function createGitHubCronVerifier({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    let keys = [];
    let refreshedAt = 0;
    let pending;
    async function refresh() {
        if (!pending) pending = (async () => {
            const response = await fetchImpl(POLICY.jwksUrl, { redirect: 'error', signal: AbortSignal.timeout(8000) });
            if (!response.ok || !/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('OIDC keys unavailable');
            const text = await response.text();
            if (Buffer.byteLength(text) > 128 * 1024) throw new Error('OIDC keys invalid');
            const data = JSON.parse(text);
            if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 30) throw new Error('OIDC keys invalid');
            keys = data.keys.filter(key => key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig');
            refreshedAt = now();
        })().finally(() => { pending = undefined; });
        return pending;
    }
    return async token => {
        if (typeof token !== 'string' || token.length > 16384 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error('Invalid scheduler identity');
        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || decoded.header.alg !== 'RS256' || decoded.header.typ !== 'JWT' ||
            typeof decoded.header.kid !== 'string' || decoded.header.kid.length > 256) throw new Error('Invalid scheduler identity');
        if (!refreshedAt || now() - refreshedAt > 3600_000) await refresh();
        let key = keys.find(item => item.kid === decoded.header.kid);
        if (!key && now() - refreshedAt > 30_000) { await refresh(); key = keys.find(item => item.kid === decoded.header.kid); }
        if (!key) throw new Error('Unknown scheduler signing key');
        const claims = jwt.verify(token, createPublicKey({ key, format: 'jwk' }), {
            algorithms: ['RS256'], issuer: POLICY.issuer, audience: POLICY.audience,
            clockTimestamp: Math.floor(now() / 1000), clockTolerance: 10, maxAge: '6m',
        });
        const subjects = [`repo:${POLICY.repository}:ref:${POLICY.ref}`,
            `repo:zhongshantouyan-cmyk@${POLICY.ownerId}/ITRC@${POLICY.repositoryId}:ref:${POLICY.ref}`];
        if (claims.aud !== POLICY.audience || !subjects.includes(claims.sub) ||
            claims.repository !== POLICY.repository || claims.repository_id !== POLICY.repositoryId ||
            claims.repository_owner_id !== POLICY.ownerId || claims.ref !== POLICY.ref ||
            claims.workflow_ref !== POLICY.workflowRef || claims.runner_environment !== 'github-hosted' ||
            !['schedule', 'workflow_dispatch'].includes(claims.event_name) ||
            !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || !Number.isInteger(claims.nbf) ||
            claims.exp - claims.iat > 600 || claims.iat > Math.floor(now() / 1000) + 10 ||
            typeof claims.jti !== 'string' || !claims.jti || typeof claims.run_id !== 'string') {
            throw new Error('Scheduler identity is outside the permitted workflow');
        }
        return { runId: claims.run_id, tokenId: claims.jti };
    };
}

module.exports = { POLICY, createGitHubCronVerifier };
