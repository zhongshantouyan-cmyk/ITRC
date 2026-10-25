import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpsProxy, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from './ops-proxy.mjs';

const FIREBASE = 'firebase_header.firebase_payload.firebase_signature';
const OIDC = 'server_header.server_payload.server_signature';
const AUTHORIZATION = `Bearer ${FIREBASE}`;
const ORIGIN = 'https://itrc-fixture-preview.vercel.app';
const START_URL = 'https://www.canva.com/api/oauth/authorize?state=fixture&code_challenge=fixture';
const COMMAND = { action: 'import.preview', idempotencyKey: 'fixture-request-01', payload: { events: [], posts: [], tasks: [] } };

function request(values = {}) {
  return { method: 'GET', url: '/api/ops/bootstrap', headers: { authorization: AUTHORIZATION }, ...values };
}
function json(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
function setup({ env = { OPS_BACKEND_ORIGIN: ORIGIN }, getOidcToken = async () => OIDC, fetchImpl } = {}) {
  const fetches = [];
  let oidcReads = 0;
  const proxy = createOpsProxy({
    env,
    getOidcToken: async () => { oidcReads++; return getOidcToken(); },
    fetchImpl: async (url, options) => {
      fetches.push({ url, options });
      return fetchImpl ? fetchImpl(url, options) : json(url.endsWith('/start') ? { authorizationUrl: START_URL, expiresAt: '2030-01-01T00:00:00Z' } : { ok: true });
    },
  });
  return {
    fetches,
    get oidcReads() { return oidcReads; },
    async invoke(req = request()) {
      const headers = {};
      let text = '';
      let ended = 0;
      const res = { statusCode: 0, setHeader(name, value) { headers[name.toLowerCase()] = value; }, end(value) { ended++; text = value; } };
      await proxy(req, res);
      assert.equal(ended, 1);
      return { status: res.statusCode, headers, text, body: JSON.parse(text) };
    },
  };
}
function assertStopped(harness) {
  assert.equal(harness.fetches.length, 0);
  assert.equal(harness.oidcReads, 0);
}
function assertNoSecrets(result, values = [FIREBASE, OIDC]) {
  const output = JSON.stringify(result);
  for (const value of values) assert.equal(output.includes(value), false, `response leaked ${value.slice(0, 8)}`);
}

test('only four JSON routes proxy to the fixed origin with the original Firebase identity', async () => {
  for (const [path, method] of [['bootstrap', 'GET'], ['actions', 'POST'], ['connections/canva', 'GET'], ['connections/canva/start', 'POST']]) {
    const harness = setup();
    const req = request({ url: `/api/ops/${path}`, method });
    if (path === 'actions') { req.body = COMMAND; req.headers['content-type'] = 'application/json'; }
    const result = await harness.invoke(req);
    assert.equal(result.status, 200, path);
    assert.equal(harness.oidcReads, 1);
    assert.equal(harness.fetches.length, 1);
    const { url, options } = harness.fetches[0];
    assert.equal(url, `${ORIGIN}/api/ops/${path}`);
    assert.equal(options.method, method);
    assert.equal(options.headers.Authorization, AUTHORIZATION);
    assert.equal(options.headers['x-vercel-trusted-oidc-idp-token'], OIDC);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['vercel-cdn-cache-control'], 'no-store');
    assertNoSecrets(result);
  }
});

test('Vercel rewrite supports rewritten query and original URL forms without forwarding query strings', async () => {
  for (const values of [
    { url: '/api/ops?path=bootstrap' },
    { url: '/api/ops', query: { path: 'bootstrap' } },
    { url: '/api/ops?path=bootstrap', query: { path: 'bootstrap' } },
    { url: '/api/ops/bootstrap', query: { path: 'bootstrap' } },
    { url: '/api/ops?path=connections%2Fcanva', query: { path: 'connections/canva' } },
  ]) {
    const harness = setup();
    const result = await harness.invoke(request(values));
    assert.equal(result.status, 200, JSON.stringify(values));
    assert.equal(harness.fetches.length, 1);
    assert.equal(new URL(harness.fetches[0].url).search, '');
  }
});

test('cron, OAuth callback, disconnect, CMS and arbitrary proxy routes fail before OIDC or fetch', async () => {
  for (const path of ['jobs/tick', 'connections/canva/callback', 'connections/canva/disconnect', 'health', 'sections', 'bootstrap/extra', 'connections/canva/', 'toString', '__proto__']) {
    const harness = setup();
    assert.equal((await harness.invoke(request({ url: `/api/ops/${path}` }))).status, 404, path);
    assertStopped(harness);
  }
});

test('path normalization, caller target, duplicate and conflicting query values cannot select another endpoint', async () => {
  for (const values of [
    { url: 'https://attacker.example/api/ops/bootstrap' },
    { url: '//attacker.example/api/ops/bootstrap' },
    { url: '/api/ops/../ops/bootstrap' },
    { url: '/api/ops/%62ootstrap' },
    { url: '/api/ops/connections%2fcanva' },
    { url: '/api/ops\\bootstrap' },
    { url: '/api/ops/bootstrap#ignored' },
    { url: '/api/ops/bootstrap?target=https://attacker.example' },
    { url: '/api/ops?path=bootstrap&path=actions' },
    { url: '/api/ops/bootstrap?path=actions' },
    { url: '/api/ops?path=bootstrap', query: { path: 'actions' } },
    { url: '/api/ops', query: { path: ['bootstrap', 'actions'] } },
    { url: '/api/ops', query: { path: 'bootstrap', target: ORIGIN } },
  ]) {
    const harness = setup();
    assert.ok([400, 404].includes((await harness.invoke(request(values))).status), JSON.stringify(values));
    assertStopped(harness);
  }
});

test('method allowlist rejects OPTIONS, HEAD and writes to GET routes without minting OIDC', async () => {
  for (const [path, method, allow] of [['bootstrap', 'POST', 'GET'], ['bootstrap', 'OPTIONS', 'GET'], ['bootstrap', 'HEAD', 'GET'], ['actions', 'GET', 'POST'], ['actions', 'DELETE', 'POST'], ['connections/canva/start', 'PUT', 'POST']]) {
    const harness = setup();
    const result = await harness.invoke(request({ url: `/api/ops/${path}`, method }));
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, allow);
    assertStopped(harness);
  }
});

test('missing, malformed and duplicated Firebase Authorization fail before OIDC access', async () => {
  for (const headers of [{}, { authorization: 'Basic fixture' }, { authorization: 'Bearer opaque' }, { authorization: `Bearer ${FIREBASE}\r\nX-Forged: true` }, { authorization: `Bearer ${'a'.repeat(9000)}.b.c` }, { authorization: [AUTHORIZATION, AUTHORIZATION] }, { authorization: AUTHORIZATION, Authorization: AUTHORIZATION }]) {
    const harness = setup();
    const result = await harness.invoke(request({ headers }));
    assert.ok([400, 401].includes(result.status));
    assertStopped(harness);
  }
  const harness = setup();
  assert.equal((await harness.invoke(request({ rawHeaders: ['Authorization', AUTHORIZATION, 'authorization', AUTHORIZATION] }))).status, 400);
  assertStopped(harness);
});

test('destination comes only from an exact HTTPS Vercel server origin; missing and deceptive origins fail closed', async () => {
  for (const origin of [undefined, '', ' http://itrc.vercel.app', 'http://itrc.vercel.app', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://itrc.vercel.app.attacker.example', 'https://nested.itrc.vercel.app', 'https://attacker.example', 'https://user:password@itrc.vercel.app', 'https://itrc.vercel.app:8443', 'https://itrc.vercel.app/api', 'https://itrc.vercel.app?target=1', 'https://itrc.vercel.app#part']) {
    const harness = setup({ env: { OPS_BACKEND_ORIGIN: origin } });
    const result = await harness.invoke();
    assert.equal(result.status, 503, String(origin));
    assert.equal(result.body.code, 'OPS_PROXY_NOT_CONFIGURED');
    assertStopped(harness);
    assertNoSecrets(result, ['password@', '127.0.0.1']);
  }
  const harness = setup({ env: { OPS_BACKEND_ORIGIN: `${ORIGIN}/` } });
  assert.equal((await harness.invoke()).status, 200);
  assert.equal(harness.fetches[0].url, `${ORIGIN}/api/ops/bootstrap`);
});

test('caller cookies, forwarded hosts, bypass headers and forged OIDC never enter the upstream request', async () => {
  const harness = setup();
  const result = await harness.invoke(request({ headers: {
    authorization: AUTHORIZATION, host: 'attacker.example', cookie: 'private_session=fixture',
    'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http',
    'x-vercel-oidc-token': 'attacker.oidc.signature',
    'x-vercel-trusted-oidc-idp-token': 'attacker.trusted.signature',
    'x-vercel-protection-bypass': 'attacker-bypass',
    'x-target-url': 'https://attacker.example',
  } }));
  assert.equal(result.status, 200);
  assert.deepEqual(harness.fetches[0].options.headers, {
    Accept: 'application/json', Authorization: AUTHORIZATION, 'x-vercel-trusted-oidc-idp-token': OIDC,
  });
  assert.equal(harness.fetches[0].url, `${ORIGIN}/api/ops/bootstrap`);
});

test('missing, invalid or failing SDK OIDC stops without caller-token fallback or leaked errors', async () => {
  for (const getOidcToken of [async () => undefined, async () => '', async () => 'opaque', async () => `${OIDC}\n`, async () => { throw new Error(`SDK credential ${OIDC}`); }]) {
    const harness = setup({ getOidcToken });
    const result = await harness.invoke(request({ headers: { authorization: AUTHORIZATION, 'x-vercel-oidc-token': OIDC, 'x-vercel-trusted-oidc-idp-token': OIDC } }));
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'OPS_PROXY_OIDC_UNAVAILABLE');
    assert.equal(harness.fetches.length, 0);
    assert.equal(harness.oidcReads, 1);
    assertNoSecrets(result);
  }
});

test('OIDC is resolved independently for every request and never cached', async () => {
  let count = 0;
  const harness = setup({ getOidcToken: async () => `header.payload${++count}.signature` });
  const results = await Promise.all([harness.invoke(), harness.invoke()]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(harness.oidcReads, 2);
  assert.deepEqual(new Set(harness.fetches.map(item => item.options.headers['x-vercel-trusted-oidc-idp-token'])), new Set(['header.payload1.signature', 'header.payload2.signature']));
});

test('JSON actions preserve multiline content, idempotency and version while adding no actor or approval', async () => {
  const command = { action: 'post.update', id: 'fixture-post', expectedVersion: 7, idempotencyKey: 'fixture-request-07', payload: { caption: '第一行\n第二行', slides: [{ heading: '標題', body: '內容' }] } };
  for (const body of [command, JSON.stringify(command), Buffer.from(JSON.stringify(command))]) {
    const harness = setup();
    const result = await harness.invoke(request({ url: '/api/ops/actions', method: 'POST', body, headers: { authorization: AUTHORIZATION, 'content-type': 'application/json; charset=utf-8' } }));
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(harness.fetches[0].options.body), command);
    assert.equal(harness.fetches[0].options.headers['Content-Type'], 'application/json');
  }
});

test('streamed request JSON is bounded and complete before any OIDC lookup or upstream write', async () => {
  const harness = setup();
  const serialized = JSON.stringify(COMMAND);
  const req = request({ url: '/api/ops/actions', method: 'POST', headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' } });
  req[Symbol.asyncIterator] = async function* () { yield Buffer.from(serialized.slice(0, 20)); yield Buffer.from(serialized.slice(20)); };
  assert.equal((await harness.invoke(req)).status, 200);
  assert.deepEqual(JSON.parse(harness.fetches[0].options.body), COMMAND);
  const oversized = setup();
  let closed = false;
  req[Symbol.asyncIterator] = async function* () { try { yield Buffer.alloc(MAX_REQUEST_BYTES); yield Buffer.from('x'); } finally { closed = true; } };
  assert.equal((await oversized.invoke(req)).status, 413);
  assert.equal(closed, true);
  assertStopped(oversized);
});

test('oversized, compressed, non-JSON and primitive bodies cannot reach the backend', async () => {
  const validHeaders = { authorization: AUTHORIZATION, 'content-type': 'application/json' };
  for (const [values, expected] of [
    [{ body: { caption: 'x'.repeat(MAX_REQUEST_BYTES) } }, 413],
    [{ headers: { ...validHeaders, 'content-length': String(MAX_REQUEST_BYTES + 1) }, body: COMMAND }, 413],
    [{ headers: { ...validHeaders, 'content-encoding': 'gzip' }, body: COMMAND }, 415],
    [{ headers: { authorization: AUTHORIZATION, 'content-type': 'text/plain' }, body: JSON.stringify(COMMAND) }, 415],
    [{ body: '{invalid' }, 400], [{ body: '[]' }, 400], [{ body: 'null' }, 400], [{ body: '"text"' }, 400], [{ body: '' }, 400],
    [{ body: Buffer.from([0xff, 0xfe]) }, 400],
  ]) {
    const harness = setup();
    const result = await harness.invoke(request({ url: '/api/ops/actions', method: 'POST', headers: validHeaders, ...values }));
    assert.equal(result.status, expected);
    assertStopped(harness);
  }
});

test('GET bodies and caller-supplied Canva OAuth configuration are rejected', async () => {
  const getHarness = setup();
  assert.equal((await getHarness.invoke(request({ body: { target: 'ignored' } }))).status, 400);
  assertStopped(getHarness);
  const startHarness = setup();
  assert.equal((await startHarness.invoke(request({ url: '/api/ops/connections/canva/start', method: 'POST', headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' }, body: { redirectUri: 'https://attacker.example', state: 'caller-controlled' } }))).status, 400);
  assertStopped(startHarness);
});

test('every upstream redirect is blocked without following or returning Location and Set-Cookie', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const harness = setup({ fetchImpl: async () => json({ unexpected: true }, { status, headers: { Location: 'https://attacker.example', 'Set-Cookie': 'private_session=fixture' } }) });
    const result = await harness.invoke();
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'OPS_PROXY_REDIRECT_BLOCKED');
    assert.equal(result.headers.location, undefined);
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(harness.fetches.length, 1);
    assert.equal(harness.fetches[0].options.redirect, 'manual');
  }
});

test('only proxy-owned response headers survive; normal JSON and backend validation status are preserved', async () => {
  const responseBody = { error: '目前版本已更新，請重新整理。', code: 'VERSION_CONFLICT' };
  const harness = setup({ fetchImpl: async () => json(responseBody, { status: 409, headers: {
    'Set-Cookie': 'provider_private=fixture', Authorization: `Bearer ${OIDC}`, 'x-vercel-oidc-token': OIDC,
    'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600', Location: 'https://attacker.example',
  } }) });
  const result = await harness.invoke();
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, responseBody);
  for (const name of ['set-cookie', 'authorization', 'x-vercel-oidc-token', 'access-control-allow-origin', 'location']) assert.equal(result.headers[name], undefined);
  assert.equal(result.headers['cache-control'], 'no-store');
  assertNoSecrets(result);
});

test('unrecognized JSON 401/403 become deployment failures while actual Ops access-error contracts survive', async () => {
  // Synthetic non-contract envelopes; no assumptions about a provider's real body.
  for (const status of [401, 403]) {
    for (const body of [
      { error: { message: 'synthetic access gate' } },
      { error: 'synthetic access gate', code: 'UNKNOWN_ACCESS_ERROR' },
      { message: 'synthetic access gate' },
      { error: ' ', code: status === 401 ? 'INVALID_IDENTITY' : 'ROLE_REQUIRED' },
      { error: 'fixture', code: status === 401 ? 'INVALID_IDENTITY' : 'ROLE_REQUIRED', unexpected: true },
      { error: 'wrong status for code', code: status === 401 ? 'ROLE_REQUIRED' : 'INVALID_IDENTITY' },
    ]) {
      const harness = setup({ fetchImpl: async () => json(body, { status }) });
      const result = await harness.invoke();
      assert.equal(result.status, 502);
      assert.equal(result.body.code, 'OPS_PROXY_DEPLOYMENT_ACCESS');
      assert.match(result.body.error, /部署保護與連線設定/);
      assert.equal(result.text.includes('synthetic'), false);
      assert.equal(harness.fetches.length, 1);
      assertNoSecrets(result);
    }
  }
  for (const [status, codes] of [
    [401, ['IDENTITY_REQUIRED', 'INVALID_IDENTITY']],
    [403, ['ROLE_REQUIRED', 'OWNER_REQUIRED', 'ADVISOR_REQUIRED', 'ASSIGNMENT_REQUIRED', 'UNIT_REVIEWER_REQUIRED', 'FINAL_APPROVER_REQUIRED', 'REVIEWER_REQUIRED', 'DESIGNER_REQUIRED', 'PUBLISHER_REQUIRED']],
  ]) {
    for (const code of codes) {
      const body = { error: '工作台身分或操作權限不足。', code };
      const harness = setup({ fetchImpl: async () => json(body, { status }) });
      const result = await harness.invoke();
      assert.equal(result.status, status);
      assert.deepEqual(result.body, body);
    }
  }
});

test('HTML protection pages, invalid JSON and unexpected response shapes fail without reflecting content', async () => {
  for (const response of [
    new Response(`<html>secret ${OIDC}</html>`, { status: 401, headers: { 'content-type': 'text/html' } }),
    new Response(`{broken ${OIDC}`, { status: 200, headers: { 'content-type': 'application/json' } }),
    json(null), json([]), json('unexpected'),
  ]) {
    const harness = setup({ fetchImpl: async () => response });
    const result = await harness.invoke();
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'OPS_PROXY_INVALID_RESPONSE');
    assertNoSecrets(result);
  }
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from('unneeded protection page')); },
    cancel() { cancelled = true; },
  }), { status: 401, headers: { 'content-type': 'text/html' } });
  const harness = setup({ fetchImpl: async () => response });
  assert.equal((await harness.invoke()).status, 502);
  assert.equal(cancelled, true, 'discarded protection pages must release the upstream body');
});

test('announced and actual response-size overflow both fail closed', async () => {
  for (const response of [
    json({ ok: true }, { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }),
    json({ payload: 'x'.repeat(MAX_RESPONSE_BYTES) }),
  ]) {
    const harness = setup({ fetchImpl: async () => response });
    const result = await harness.invoke();
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'OPS_PROXY_INVALID_RESPONSE');
  }
});

test('credential fields and token echoes anywhere in upstream JSON never reach the browser', async () => {
  for (const body of [
    { data: { access_token: 'hidden-provider-token' } }, { data: { refreshToken: 'hidden-provider-token' } },
    { data: { 'Set-Cookie': 'private_session=fixture' } }, { data: { client_secret: 'hidden-provider-secret' } },
    { data: { privateKey: 'hidden-provider-key' } }, { data: { sealed: 'encrypted-credentials' } },
    { error: `upstream accidentally echoed ${OIDC}` }, { data: [`Bearer ${FIREBASE}`] }, { [OIDC]: true },
  ]) {
    const harness = setup({ fetchImpl: async () => json(body) });
    const result = await harness.invoke();
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'OPS_PROXY_INVALID_RESPONSE');
    assertNoSecrets(result, [FIREBASE, OIDC, 'hidden-provider', 'private_session', 'encrypted-credentials']);
  }
});

test('Canva start accepts only the HTTPS Canva authorization destination', async () => {
  for (const authorizationUrl of ['https://attacker.example/api/oauth/authorize', 'https://www.canva.com.attacker.example/api/oauth/authorize', 'http://www.canva.com/api/oauth/authorize', 'https://user:password@www.canva.com/api/oauth/authorize', 'https://www.canva.com/api/oauth/authorize#fragment', 'https://www.canva.com/another-path']) {
    const harness = setup({ fetchImpl: async () => json({ authorizationUrl }) });
    const result = await harness.invoke(request({ url: '/api/ops/connections/canva/start', method: 'POST' }));
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'OPS_PROXY_INVALID_RESPONSE');
  }
});

test('network and timeout failures are sanitized and never retry a potentially committed action', async () => {
  for (const [name, expected] of [['Error', 502], ['AbortError', 504], ['TimeoutError', 504]]) {
    const harness = setup({ fetchImpl: async () => { const error = new Error(`internal error ${OIDC}`); error.name = name; throw error; } });
    const result = await harness.invoke(request({ url: '/api/ops/actions', method: 'POST', body: COMMAND, headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' } }));
    assert.equal(result.status, expected);
    assert.equal(result.body.code, 'OPS_PROXY_UPSTREAM_UNAVAILABLE');
    assert.match(result.body.error, /尚未確認操作結果/);
    assert.equal(harness.fetches.length, 1);
    assertNoSecrets(result);
  }
});

test('the deployable ESM entry imports the official OIDC helper without invoking it at module load', async () => {
  const entry = await import('../api/ops.js');
  assert.equal(typeof entry.default, 'function');
});
