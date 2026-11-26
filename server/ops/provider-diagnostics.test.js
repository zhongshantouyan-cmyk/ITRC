'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { createCanvaDesign, getCanvaJob, readSheetSource, getIntegrationStatus } = require('./providers');
const { createOpsService, safeError } = require('./service');
const { providerResponseDiagnostic, safeProviderDiagnostic } = require('./provider-diagnostics');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const privateValue = 'SYNTHETIC_PRIVATE_DO_NOT_RETURN';
const canvaEnv = { CANVA_ACCESS_TOKEN: privateValue, CANVA_TEMPLATE_DESIGN_ID: 'DTestTemplate',
  CANVA_FIELD_MAP_JSON: JSON.stringify({ TITLE: { type: 'text', path: 'post.title' } }) };
const dataset = { dataset: { TITLE: { type: 'text' } } };
const approved = { event: { title: '測試活動', eventType: 'activity' },
  post: { title: '測試文案', caption: '僅供測試', copyVersion: 1, approvedVersion: 1,
    stage: 'design_pending', approvedBy: 'approver@example.test', approvedAt: '2026-11-26T00:00:00.000Z' }, obligations: [] };
const denied = () => json({ code: 'permission_denied', message: privateValue,
  url: 'https://example.invalid/' + privateValue, access_token: privateValue }, 403);
const sheet = { spreadsheetId: 'SheetTestId', range: 'Test!A1:B5' };
const sheetEnv = { GOOGLE_SHEETS_ACCESS_TOKEN: privateValue, OPS_SHEET_SOURCE_IDS: sheet.spreadsheetId };
const capture = async promise => {
  try { await promise; } catch (error) { return error; }
  assert.fail('Expected provider failure');
};
const planMessagePrefix = 'Access the autofill feature and other powerful design tools by upgrading your Canva plan here: ';
const canvaDenials = [
  { message: `Not allowed to access design with id '${privateValue}'`, reason: 'DESIGN_ACCESS_DENIED' },
  { message: `Not allowed to access brand template with id '${privateValue}'`, reason: 'BRAND_TEMPLATE_ACCESS_DENIED' },
  { message: planMessagePrefix + 'https://www.canva.com/pro/?test=' + privateValue, reason: 'AUTOFILL_PLAN_REQUIRED' },
];

test('Canva dataset rejection identifies the read stage without creating a design or disclosing response data', async () => {
  const requests = [];
  const error = await capture(createCanvaDesign(approved, { env: canvaEnv, fetchImpl: async (url, request) => {
    requests.push({ url, method: request.method }); return denied();
  } }));
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'GET');
  assert.deepEqual(error.diagnostic, { provider: 'canva', stage: 'dataset_read', httpStatus: 403, code: 'permission_denied' });
  assert.equal(error.definite, true);
  assert.match(safeError(error), /讀取母版欄位.*HTTP 403，permission_denied/);
  assert.ok(!JSON.stringify(error).includes(privateValue));
  assert.ok(!safeError(error).includes(privateValue));
  assert.ok(!safeError(error).includes('升級'));
});

test('Canva create, poll and design-readback rejections retain separate fixed stages', async () => {
  let calls = 0;
  const createError = await capture(createCanvaDesign(approved, { env: canvaEnv,
    fetchImpl: async () => ++calls === 1 ? json(dataset) : denied() }));
  assert.equal(calls, 2); assert.equal(createError.diagnostic.stage, 'autofill_create');
  assert.equal(createError.code, 'PROVIDER_REJECTED'); assert.equal(createError.definite, true);
  const pollError = await capture(getCanvaJob('TestJobId', { env: canvaEnv, fetchImpl: async () => denied() }));
  assert.equal(pollError.diagnostic.stage, 'autofill_poll');
  calls = 0;
  const readError = await capture(getCanvaJob('TestJobId', { env: canvaEnv, fetchImpl: async () => ++calls === 1
    ? json({ job: { id: 'TestJobId', status: 'success', result: { type: 'create_design', design: { id: 'DTestResult' } } } })
    : denied() }));
  assert.equal(calls, 2); assert.equal(readError.diagnostic.stage, 'design_readback');
  for (const error of [createError, pollError, readError]) {
    assert.match(safeError(error), /HTTP 403，permission_denied/);
    assert.ok(!JSON.stringify(error).includes(privateValue));
  }
});

test('documented Canva Autofill 403 messages become fixed reasons without retaining IDs, URLs or raw text', async () => {
  for (const { message, reason } of canvaDenials) {
    let calls = 0;
    const error = await capture(createCanvaDesign(approved, { env: canvaEnv, fetchImpl: async () =>
      ++calls === 1 ? json(dataset) : json({ code: 'permission_denied', message }, 403) }));
    assert.equal(calls, 2); assert.equal(error.definite, true);
    assert.deepEqual(error.diagnostic, { provider: 'canva', stage: 'autofill_create', httpStatus: 403, code: 'permission_denied', reason });
    const serialized = JSON.stringify(error) + safeError(error);
    assert.ok(serialized.includes(reason));
    for (const hidden of [privateValue, message, 'https://www.canva.com/pro/']) assert.ok(!serialized.includes(hidden));
    if (reason === 'AUTOFILL_PLAN_REQUIRED') assert.match(safeError(error), /方案未提供 Autofill 使用資格。系統未進行升級或付款/);
  }
});

test('Canva reason classification rejects message near-matches, malicious suffixes and foreign URLs', async () => {
  const context = { provider: 'canva', stage: 'autofill_create' };
  const base = { ...context, httpStatus: 403, code: 'permission_denied' };
  const nearMatches = canvaDenials.flatMap(({ message }) =>
    [' ' + message, message + ' ' + privateValue, ...['\n', '\r\n', '\u2028', '\u2029'].map(end => message + end)]);
  for (const id of ['', 'x'.repeat(129), 'has space', "has'quote", 'slash/id', 'back\\slash', '非ASCII', 'nul\0id']) {
    nearMatches.push(`Not allowed to access design with id '${id}'`);
  }
  for (const url of ['http://www.canva.com/pro/', 'https://canva.com.evil.example/pro/', 'https://canva.com@evil.example/pro/',
    'https://evil.example@canva.com/pro/', 'https://canva.com:443/pro/', 'https://extra.canva.com/pro/',
    'https://cаnva.com/pro/', 'https://www.canva.com/pro/ has-space', 'https://www.canva.com/pro/\\x',
    'https://www.canva.com/pro/%ZZ', 'https://www.canva.com/pro/\0']) nearMatches.push(planMessagePrefix + url);
  for (const message of [null, {}, privateValue, ...nearMatches]) {
    const diagnostic = await providerResponseDiagnostic(json({ code: 'permission_denied', message,
      reason: 'AUTOFILL_PLAN_REQUIRED', provider: 'google_sheets', stage: 'read' }, 403), context);
    assert.deepEqual(diagnostic, base);
    const error = { code: 'PROVIDER_REJECTED', diagnostic };
    assert.ok(!safeError(error).includes('方案未提供'));
    assert.ok(!JSON.stringify(diagnostic).includes(privateValue));
  }
  for (const id of ['A', 'x'.repeat(128)]) {
    const diagnostic = await providerResponseDiagnostic(json({ code: 'permission_denied',
      message: `Not allowed to access design with id '${id}'` }, 403), context);
    assert.equal(diagnostic.reason, 'DESIGN_ACCESS_DENIED');
    assert.ok(!JSON.stringify(diagnostic).includes('"message"'));
  }
});

test('Canva reason whitelist is limited to the expected provider, create stage, HTTP 403 and permission_denied code', async () => {
  const valid = { provider: 'canva', stage: 'autofill_create', httpStatus: 403, code: 'permission_denied' };
  for (const change of [{ httpStatus: 401 }, { httpStatus: 404 }, { httpStatus: 429 }, { httpStatus: 503 },
    { code: 'missing_scope' }, { code: 'unknown' }, { stage: 'dataset_read' }, { stage: 'autofill_poll' },
    { stage: 'design_readback' }, { provider: 'google_sheets', stage: 'read' }]) {
    const context = { ...valid, ...change };
    const diagnostic = await providerResponseDiagnostic(json({ code: context.code, message: canvaDenials[2].message }, context.httpStatus),
      { provider: context.provider, stage: context.stage });
    assert.equal(diagnostic.reason, undefined);
    assert.equal(safeProviderDiagnostic({ ...context, reason: 'AUTOFILL_PLAN_REQUIRED' }).reason, undefined);
  }
  for (const reason of [privateValue, '__proto__', 'SERVICE_DISABLED', undefined]) {
    assert.deepEqual(safeProviderDiagnostic({ ...valid, reason, message: privateValue, url: privateValue }), valid);
  }
});

test('unrecognized, oversized and invalid error bodies retain only the fixed stage and HTTP status', async () => {
  const context = { provider: 'canva', stage: 'dataset_read' };
  for (const response of [json({ code: privateValue, message: privateValue }, 403),
    json({ code: 'permission_denied', message: 'x'.repeat(9000) }, 403),
    new Response('<html>' + privateValue, { status: 403 })]) {
    assert.deepEqual(await providerResponseDiagnostic(response, context), { ...context, httpStatus: 403 });
  }
  assert.equal(safeProviderDiagnostic({ provider: 'canva', stage: '__proto__', httpStatus: 403 }), null);
  assert.equal(safeProviderDiagnostic({ provider: '__proto__', stage: 'dataset_read', httpStatus: 403 }), null);
  assert.equal(safeProviderDiagnostic({ ...context, httpStatus: '403' }), null);
  const clean = safeProviderDiagnostic({ ...context, httpStatus: 403, code: 'permission_denied', message: privateValue,
    headers: { Authorization: privateValue }, url: privateValue });
  assert.deepEqual(clean, { ...context, httpStatus: 403, code: 'permission_denied' });
});

test('stalled provider error body times out and is cancelled without losing safe status', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 });
  const start = Date.now();
  assert.deepEqual(await providerResponseDiagnostic(response, { provider: 'canva', stage: 'dataset_read' }),
    { provider: 'canva', stage: 'dataset_read', httpStatus: 403 });
  assert.ok(Date.now() - start < 3000); assert.equal(cancelled, true);
});

test('Sheets read diagnoses an official SERVICE_DISABLED reason while dropping project, email and activation URL', async () => {
  const error = await capture(readSheetSource(sheet, { env: sheetEnv, fetchImpl: async () => json({ error: {
    code: 403, status: 'PERMISSION_DENIED', message: privateValue, details: [{
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'googleapis.com', reason: 'SERVICE_DISABLED',
      metadata: { consumer: privateValue, email: privateValue, activationUrl: 'https://example.invalid/' + privateValue },
    }],
  } }, 403) }));
  assert.deepEqual(error.diagnostic, { provider: 'google_sheets', stage: 'read', httpStatus: 403,
    code: 'PERMISSION_DENIED', reason: 'SERVICE_DISABLED' });
  assert.match(safeError(error), /API 尚未啟用/);
  assert.ok(!JSON.stringify(error).includes(privateValue)); assert.ok(!safeError(error).includes(privateValue));
});

test('Sheets permission denial alone never claims API disabled and ignores untrusted reason domains', async () => {
  for (const detail of [
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'untrusted.invalid', reason: 'SERVICE_DISABLED' },
    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'googleapis.com', reason: privateValue },
    { '@type': 'other', domain: 'googleapis.com', reason: 'SERVICE_DISABLED' },
  ]) {
    const error = await capture(readSheetSource(sheet, { env: sheetEnv, fetchImpl: async () => json({ error: {
      status: 'PERMISSION_DENIED', message: privateValue, details: [detail],
    } }, 403) }));
    assert.equal(error.diagnostic.reason, undefined);
    assert.ok(!safeError(error).includes('API 尚未啟用'));
    assert.ok(!JSON.stringify(error).includes(privateValue));
  }
});

test('Sheets OAuth token rejection is distinguished from source permission without disclosing credentials', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { type: 'service_account', client_email: 'test@test-project.iam.gserviceaccount.com',
    private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  let calls = 0;
  const error = await capture(readSheetSource(sheet, { env: { OPS_SHEET_SOURCE_IDS: sheet.spreadsheetId,
    GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: JSON.stringify(account) }, fetchImpl: async url => {
      calls++; assert.equal(url, 'https://oauth2.googleapis.com/token');
      return json({ error: 'invalid_grant', error_description: privateValue }, 400);
    } }));
  assert.equal(calls, 1);
  assert.deepEqual(error.diagnostic, { provider: 'google_sheets', stage: 'token', httpStatus: 400, code: 'invalid_grant' });
  assert.match(safeError(error), /取得唯讀授權.*invalid_grant/);
  assert.ok(!JSON.stringify(error).includes(privateValue));
  assert.ok(!JSON.stringify(error).includes(account.client_email));
});

test('durable jobs retain only safe reasons across reconnection and ambiguous writes still require reconciliation', async t => {
  for (const scenario of [{ datasetDenied: true }, { ambiguous: true }, ...canvaDenials]) {
    const { ambiguous, datasetDenied } = scenario;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'itrc-safe-provider-'));
    const dbUrl = 'file:' + path.join(dir, 'test.db');
    let db = createClient({ url: dbUrl });
    t.after(async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); });
    let calls = 0;
    const service = createOpsService({ db, env: canvaEnv, providers: {
      getIntegrationStatus,
      createCanvaDesign: (input, options) => createCanvaDesign(input, { ...options, fetchImpl: async () => {
        calls++;
        if (datasetDenied) return denied();
        if (calls === 1) return json(dataset);
        return ambiguous ? json({ code: 'internal_error', message: privateValue }, 503)
          : json({ code: 'permission_denied', message: scenario.message }, 403);
      } }),
    } });
    await service.ready;
    const actor = { uid: 'test-advisor', email: 'advisor@example.test', role: 'advisor' };
    const act = (action, payload = {}, record) => service.action(actor, { action, payload, id: record?.id,
      expectedVersion: record?.version, idempotencyKey: crypto.randomUUID() });
    const event = (await act('event.create', { title: '隔離測試活動', eventType: 'activity' })).record;
    let post = (await act('post.create', { eventId: event.id, title: '隔離測試宣傳', caption: '測試', slides: [] })).record;
    post = (await act('post.confirm', {}, post)).record;
    await act('post.request-design', {}, post); await service.runJobs({ limit: 1, actor });
    const state = await service.bootstrap(actor); const job = state.jobs[0];
    assert.equal(job.status, ambiguous ? 'needs_reconciliation' : 'failed');
    assert.equal(calls, datasetDenied ? 1 : 2);
    assert.match(job.lastError, ambiguous ? /建立結果不明/ : datasetDenied ? /讀取母版欄位.*HTTP 403，permission_denied/ : new RegExp(scenario.reason));
    assert.ok(!JSON.stringify(state).includes(privateValue));
    if (ambiguous) await assert.rejects(act('job.retry', {}, job), { code: 'RETRY_NOT_ALLOWED' });
    db.close(); db = createClient({ url: dbUrl });
    const reopened = createOpsService({ db, env: canvaEnv }); await reopened.ready;
    const persisted = await reopened.bootstrap(actor);
    assert.equal(persisted.jobs[0].lastError, job.lastError);
    assert.equal(persisted.jobs[0].status, job.status);
    assert.ok(!JSON.stringify(persisted).includes(privateValue));
    assert.ok(!JSON.stringify(persisted).includes('https://www.canva.com/pro/'));
  }
});
