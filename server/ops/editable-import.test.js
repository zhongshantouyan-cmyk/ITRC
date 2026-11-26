'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const JSZip = require('jszip');
const adapters = require('./providers');
const { createOpsService } = require('./service');
const { actorFromIdentity } = require('./auth');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const slides = () => [
  { heading: '連線驗證', body: '【整合測試】\n網站後端產生。\n請勿正式發布。' },
  { heading: '資料讀回', body: '【整合測試】\n時間、地點不適用。\n僅供驗證，請勿發布。' },
  { heading: '編輯測試', body: '【整合測試】\n檢查六個文字欄位。\n請勿正式發布。' },
];
const approved = () => ({
  event: { title: '【整合測試】活動來源', privateNote: 'PRIVATE_EVENT_DO_NOT_TRANSMIT' },
  post: { title: '【整合測試】可編輯設計', caption: '【整合測試】僅供整合驗證，請勿發布。',
    slides: slides(), copyVersion: 1, approvedVersion: 1, approvedBy: 'owner@example.test',
    approvedAt: '2026-11-26T00:00:00.000Z', stage: 'approved' },
});
const importEnv = { CANVA_GENERATION_MODE: 'editable_import', CANVA_ACCESS_TOKEN: 'TEST_ONLY_CANVA_TOKEN' };
const autofillEnv = { ...importEnv, CANVA_GENERATION_MODE: 'autofill', CANVA_TEMPLATE_DESIGN_ID: 'DTestTemplate',
  CANVA_FIELD_MAP_JSON: JSON.stringify({ TITLE: { type: 'text', path: 'post.title' } }) };
const importJob = (status = 'success', designs = [{ id: 'DImportedTest', page_count: 3 }]) =>
  ({ job: { id: 'ImportTest01', status, ...(status === 'success' ? { result: { designs } } : {}) } });
const readback = () => ({ design: { id: 'DImportedTest', page_count: 3,
  urls: { edit_url: 'https://www.canva.com/design/DImportedTest/edit' } } });
const noNetwork = async () => { throw new Error('Unexpected network request'); };

test('editable import is explicit, keeps default Autofill, needs no template, and never claims verified access', async () => {
  assert.equal(adapters.getCanvaGenerationMode({}), 'autofill');
  assert.equal(adapters.getCanvaGenerationMode({ CANVA_GENERATION_MODE: ' editable_import ' }), 'editable_import');
  for (const mode of ['import', 'auto', true, {}, ' ']) {
    const env = { ...importEnv, CANVA_GENERATION_MODE: mode };
    assert.equal(adapters.getIntegrationStatus(env).canva.status, 'configuration_invalid');
    await assert.rejects(adapters.createCanvaDesign(approved(), { env, fetchImpl: noNetwork }), { code: 'CONFIGURATION_INVALID' });
  }
  const status = adapters.getIntegrationStatus({ ...importEnv, CANVA_FIELD_MAP_JSON: '{ignored invalid Autofill map' }).canva;
  assert.equal(status.configured, true);
  assert.equal(status.verified, false);
  assert.equal(status.generationMode, 'editable_import');
  assert.deepEqual(status.missing, []);
  assert.match(status.message, /可編輯匯入/);
  assert.ok(!JSON.stringify(status).includes(importEnv.CANVA_ACCESS_TOKEN));
  assert.equal(adapters.getIntegrationStatus({ CANVA_GENERATION_MODE: 'editable_import' }).canva.configured, false);
  await assert.rejects(adapters.createCanvaDesign(approved(), {
    env: { CANVA_ACCESS_TOKEN: importEnv.CANVA_ACCESS_TOKEN }, fetchImpl: noNetwork,
  }), { code: 'CONFIGURATION_MISSING' });
});

test('import mode drafting uses its three-page limits regardless of an unrelated Autofill map', async () => {
  for (const mode of ['editable_import', ' editable_import ']) {
    const draft = await adapters.generateCopy({ event: { title: '【測試】活動' },
      post: { title: '超過八個中文字的測試標題', highlights: '完整活動資訊'.repeat(100) } },
    { env: { CANVA_GENERATION_MODE: mode, CANVA_FIELD_MAP_JSON: '{bad' }, fetchImpl: noNetwork });
    assert.equal(draft.slides.length, 3);
    for (const [index, limit] of [42, 84, 84].entries()) {
      assert.ok(Array.from(draft.slides[index].heading).length <= 8);
      assert.ok(Array.from(draft.slides[index].body).length <= limit);
    }
    assert.ok(draft.caption.includes('完整活動資訊'.repeat(100)));
  }
});

test('stale approval, malformed or oversized copy, and invalid characters are stopped before OAuth or HTTP', async () => {
  let network = 0, tokens = 0;
  const options = { env: importEnv, fetchImpl: async () => { network++; return json(importJob('in_progress')); },
    getCanvaAccessToken: async () => { tokens++; return 'test_oauth_token'; } };
  const variants = [
    post => { delete post.approvedAt; },
    post => { post.approvedVersion = 2; },
    post => { post.stage = 'draft'; },
    post => { post.slides.pop(); },
    post => { post.slides[0].heading = '題'.repeat(9); },
    post => { post.slides[0].body = '文'.repeat(43); },
    post => { post.slides[1].body = '文'.repeat(85); },
    post => { post.slides[2].body = '含有\u0001無效字元'; },
    post => { post.slides[0].heading = 123; },
    post => { post.slides[0].heading = { text: '不能注入 options' }; },
  ];
  for (const alter of variants) {
    const input = approved(); alter(input.post);
    await assert.rejects(adapters.createCanvaDesign(input, options), error =>
      ['VALIDATION_ERROR', 'EDITABLE_COPY_INVALID'].includes(error.code) && error.definite === true);
  }
  assert.equal(tokens, 0); assert.equal(network, 0);
});

test('binary import preserves approved text, uses UTF-8 base64 title and returns a durable typed job before readback', async () => {
  const input = approved();
  input.post.title = '【測試】😀'.repeat(15);
  input.post.slides[0].body = '  保留空白\nA&B <文字>  ';
  const original = structuredClone(input);
  let calls = 0;
  const result = await adapters.createCanvaDesign(input, { env: importEnv, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.canva.com/rest/v1/imports');
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, 'Bearer ' + importEnv.CANVA_ACCESS_TOKEN);
    assert.equal(request.headers['Content-Type'], 'application/octet-stream');
    const metadata = JSON.parse(request.headers['Import-Metadata']);
    assert.deepEqual(Object.keys(metadata).sort(), ['mime_type', 'title_base64']);
    assert.equal(metadata.mime_type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const title = Buffer.from(metadata.title_base64, 'base64').toString('utf8');
    assert.equal(Array.from(title).length, 50);
    assert.ok(title.endsWith(' · 文案 v1'));
    assert.ok(!title.includes('\ufffd'));
    assert.ok(Buffer.isBuffer(request.body));
    const zip = await JSZip.loadAsync(request.body);
    assert.equal(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 3);
    const page1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.match(page1, /  保留空白/); assert.match(page1, /A&amp;B &lt;文字&gt;  /);
    for (let page = 1; page <= 3; page++) {
      const xml = await zip.file(`ppt/slides/slide${page}.xml`).async('string');
      assert.ok(xml.includes(input.post.slides[page - 1].heading));
      assert.ok(!xml.includes('PRIVATE_EVENT_DO_NOT_TRANSMIT'));
      assert.ok(!xml.includes('TEST_ONLY_CANVA_TOKEN'));
    }
    // Even immediate success must be persisted before querying the output.
    return json(importJob(), 201);
  } });
  assert.deepEqual(result, { providerJobId: 'import:ImportTest01', status: 'in_progress', generationMethod: 'editable_import' });
  assert.equal(calls, 1); assert.deepEqual(input, original);
});

test('a blank post title falls back to the event title and a pinned mode overrides later configuration', async () => {
  const input = approved(); input.post.title = '';
  await adapters.createCanvaDesign(input, { env: autofillEnv, generationMode: 'editable_import', fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.canva.com/rest/v1/imports');
    const title = Buffer.from(JSON.parse(request.headers['Import-Metadata']).title_base64, 'base64').toString('utf8');
    assert.equal(title, input.event.title + ' · 文案 v1');
    return json(importJob('in_progress'));
  } });
});

test('ambiguous import writes stay uncertain and definite provider refusals have only safe fixed diagnostics', async () => {
  for (const response of [
    async () => { throw new Error('sensitive response'); },
    async () => json({ error: { message: 'sensitive response' } }, 408),
    async () => json({ error: { message: 'sensitive response' } }, 500),
    async () => new Response('{malformed', { status: 200 }),
    async () => json({ job: { id: 'bad/id', status: 'success' } }),
    async () => json({ job: { id: 'ImportTest01', status: 'unknown' } }),
  ]) {
    await assert.rejects(adapters.createCanvaDesign(approved(), { env: importEnv, fetchImpl: response }), error =>
      error.code === 'UNCERTAIN_RESULT' && error.uncertain && !error.message.includes('sensitive'));
  }
  await assert.rejects(adapters.createCanvaDesign(approved(), { env: importEnv,
    fetchImpl: async () => json({ code: 'permission_denied', message: 'sensitive response' }, 403),
  }), error => {
    assert.equal(error.code, 'PROVIDER_REJECTED'); assert.equal(error.definite, true);
    assert.deepEqual(error.diagnostic, { provider: 'canva', stage: 'import_create', httpStatus: 403, code: 'permission_denied' });
    assert.ok(!JSON.stringify(error).includes('sensitive'));
    return true;
  });
});

test('persisted import IDs always use import polling and legacy IDs remain Autofill regardless of configured mode', async () => {
  const urls = [];
  const success = await adapters.getCanvaJob('import:ImportTest01', { env: autofillEnv, fetchImpl: async url => {
    urls.push(url); return json(url.includes('/imports/') ? importJob() : readback());
  } });
  assert.deepEqual(urls, ['https://api.canva.com/rest/v1/imports/ImportTest01', 'https://api.canva.com/rest/v1/designs/DImportedTest']);
  assert.deepEqual(success, { providerJobId: 'import:ImportTest01', status: 'success', generationMethod: 'editable_import',
    canvaDesignId: 'DImportedTest', canvaEditUrl: readback().design.urls.edit_url, sourcePageCount: 3, pageCount: 3 });
  await adapters.getCanvaJob('LegacyAutofillJob', { env: importEnv, fetchImpl: async url => {
    assert.equal(url, 'https://api.canva.com/rest/v1/autofills/LegacyAutofillJob');
    return json({ job: { id: 'LegacyAutofillJob', status: 'in_progress' } });
  } });
  for (const id of ['import:', 'import:a/b', 'import:..', 'import:evil?x=y', 'other:job']) {
    await assert.rejects(adapters.getCanvaJob(id, { env: importEnv, fetchImpl: noNetwork }), { code: 'VALIDATION_ERROR' });
  }
});

test('import polling rejects mismatched jobs and empty, multiple, invalid or explicitly non-three-page outputs before reading designs', async () => {
  const cases = [
    { job: { ...importJob().job, id: 'DifferentJob' } },
    importJob('success', []),
    importJob('success', [{ id: 'DA' }, { id: 'DB' }]),
    importJob('success', [{ id: 'bad/id' }]),
    importJob('success', [null]),
    ...[0, 1, 2, 4, '3', null].map(page_count => importJob('success', [{ id: 'DImportedTest', page_count }])),
  ];
  for (const body of cases) {
    let calls = 0;
    await assert.rejects(adapters.getCanvaJob('import:ImportTest01', { env: importEnv, fetchImpl: async url => {
      calls++; assert.match(url, /\/imports\/ImportTest01$/); return json(body);
    } }), { code: 'INVALID_PROVIDER_RESPONSE' });
    assert.equal(calls, 1);
  }
});

test('readback requires the same design ID, editable URL and no conflicting explicit page count', async () => {
  for (const design of [
    { ...readback().design, id: 'DWrong' },
    { ...readback().design, page_count: 2 },
    { ...readback().design, page_count: '3' },
    { id: 'DImportedTest', page_count: 3 },
    { ...readback().design, urls: { edit_url: 'https://example.test/design/DImportedTest/edit' } },
    { ...readback().design, urls: { edit_url: 'https://www.canva.com/design/DImportedTest/view' } },
  ]) {
    await assert.rejects(adapters.getCanvaJob('import:ImportTest01', { env: importEnv,
      fetchImpl: async url => json(url.includes('/imports/') ? importJob() : { design }),
    }), { code: 'INVALID_PROVIDER_RESPONSE' });
  }
  // Canva's page_count is optional; omit the verified count if both reads omit it.
  const design = readback().design; delete design.page_count;
  const result = await adapters.getCanvaJob('import:ImportTest01', { env: importEnv,
    fetchImpl: async url => json(url.includes('/imports/') ? importJob('success', [{ id: design.id }]) : { design }),
  });
  assert.equal(result.sourcePageCount, 3); assert.equal(result.pageCount, undefined);
});

test('duplicate_import is retained as reconciliation, never a normal failure eligible for a fresh upload', async () => {
  const duplicate = { job: { id: 'ImportTest01', status: 'failed', error: { code: 'duplicate_import', message: 'RAW_DO_NOT_STORE' } } };
  for (const result of [
    await adapters.createCanvaDesign(approved(), { env: importEnv, fetchImpl: async () => json(duplicate) }),
    await adapters.getCanvaJob('import:ImportTest01', { env: importEnv, fetchImpl: async () => json(duplicate) }),
  ]) {
    assert.equal(result.status, 'needs_reconciliation');
    assert.equal(result.providerJobId, 'import:ImportTest01');
    assert.ok(!JSON.stringify(result).includes('RAW_DO_NOT_STORE'));
  }
});

const actor = actorFromIdentity({ uid: 'test-owner', email: 'owner@example.test', email_verified: true, name: '測試幹部' }, 'advisor', {});
async function fixture(t, fetchImpl, initialEnv = importEnv) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'itrc-editable-import-'));
  const url = 'file:' + path.join(directory, 'isolated.db');
  const env = { ...initialEnv };
  const providers = { ...adapters,
    createCanvaDesign: (input, options) => adapters.createCanvaDesign(input, { ...options, fetchImpl }),
    getCanvaJob: (id, options) => adapters.getCanvaJob(id, { ...options, fetchImpl }),
  };
  const f = { db: createClient({ url }), env };
  f.service = createOpsService({ db: f.db, providers, env });
  await f.service.ready;
  f.restart = async () => {
    f.db.close(); f.db = createClient({ url });
    f.service = createOpsService({ db: f.db, providers, env }); await f.service.ready;
  };
  f.command = (action, payload = {}, record, key = randomUUID()) => f.service.action(actor,
    { action, id: record?.id, expectedVersion: record?.version, payload, idempotencyKey: key });
  f.post = async id => (await f.service.bootstrap(actor)).posts.find(item => item.id === id);
  t.after(async () => { f.db.close(); await rm(directory, { recursive: true, force: true }); });
  return f;
}
async function confirmedPost(f) {
  const input = approved();
  const event = (await f.command('event.create', { title: input.event.title })).record;
  let post = (await f.command('post.create', { eventId: event.id, title: input.post.title,
    caption: input.post.caption, slides: input.post.slides })).record;
  post = (await f.command('post.confirm', {}, post)).record;
  return post;
}

test('one confirmed copy can explicitly request a new import after a definite Autofill refusal, with durable readback and deduplication', async t => {
  const requests = [];
  let failReadback = true;
  const f = await fixture(t, async (url, request) => {
    requests.push({ url, method: request.method });
    if (url.endsWith('/dataset')) return json({ dataset: { TITLE: { type: 'text' } } });
    if (url.endsWith('/autofills')) return json({ code: 'permission_denied', message: 'RAW_DO_NOT_STORE' }, 403);
    if (url.endsWith('/imports')) return json(importJob());
    if (url.endsWith('/imports/ImportTest01')) return json(importJob());
    if (url.endsWith('/designs/DImportedTest')) return failReadback ? json({ message: 'RAW_DO_NOT_STORE' }, 503) : json(readback());
    throw new Error('Unexpected test URL');
  }, autofillEnv);
  const post = await confirmedPost(f);
  const oldJob = (await f.command('post.request-design', {}, post)).record;
  await f.service.runJobs({ limit: 1, jobId: oldJob.id });
  const failedOld = (await f.service.store.read()).jobs.find(job => job.id === oldJob.id);
  assert.equal(failedOld.status, 'failed'); assert.equal(failedOld.providerJobId, undefined);

  f.env.CANVA_GENERATION_MODE = 'editable_import';
  const importWork = (await f.command('post.request-design', {}, await f.post(post.id))).record;
  assert.notEqual(importWork.id, oldJob.id); assert.equal(importWork.generationMode, 'editable_import');
  const again = (await f.command('post.request-design', {}, await f.post(post.id))).record;
  assert.equal(again.id, importWork.id);
  assert.equal((await f.service.store.read()).jobs.length, 2);
  assert.deepEqual((await f.service.store.read()).jobs.find(job => job.id === oldJob.id), failedOld);
  await assert.rejects(f.command('job.retry', {}, failedOld), { code: 'CANVA_MODE_CHANGE_BLOCKED' });
  let current = await f.post(post.id);
  assert.equal(current.copyVersion, 1); assert.equal(current.approvedVersion, 1);
  assert.equal(current.approvedAt, post.approvedAt);
  assert.equal(current.history.filter(item => item.action === 'post.confirm').length, 1);

  // An environment switch after enqueue must not reinterpret a pending job.
  f.env.CANVA_GENERATION_MODE = 'autofill';
  await f.service.runJobs({ limit: 1, jobId: importWork.id });
  let job = (await f.service.store.read()).jobs.find(item => item.id === importWork.id);
  assert.equal(job.status, 'running'); assert.equal(job.providerJobId, 'import:ImportTest01'); assert.equal(job.attempts, 1);
  assert.equal(requests.filter(item => item.url.endsWith('/imports') && item.method === 'POST').length, 1);
  assert.equal(requests.filter(item => item.url.includes('/designs/DImportedTest')).length, 0);
  await f.restart();
  await f.service.runJobs({ limit: 1, jobId: job.id });
  job = (await f.service.store.read()).jobs.find(item => item.id === job.id);
  assert.equal(job.status, 'failed'); assert.equal(job.providerJobId, 'import:ImportTest01');
  assert.equal((await f.post(post.id)).canvaEditUrl, undefined);
  failReadback = false;
  await f.command('job.retry', {}, job);
  await f.service.runJobs({ limit: 1, jobId: job.id });
  job = (await f.service.store.read()).jobs.find(item => item.id === job.id);
  current = await f.post(post.id);
  assert.equal(job.status, 'succeeded'); assert.equal(job.attempts, 1);
  assert.equal(current.designCopyVersion, 1); assert.equal(current.designGenerationMethod, 'editable_import');
  assert.equal(current.canvaDesignId, 'DImportedTest'); assert.equal(current.canvaEditUrl, readback().design.urls.edit_url);
  assert.equal(current.approvedAt, post.approvedAt);
  assert.equal(job.result.generationMethod, 'editable_import');
  assert.ok(current.history.some(item => item.action === 'post.generated-design' && item.designGenerationMethod === 'editable_import'));
  assert.equal(requests.filter(item => item.url.endsWith('/imports') && item.method === 'POST').length, 1);
  const state = await f.service.store.read();
  assert.deepEqual(state.jobs.find(item => item.id === oldJob.id), failedOld);
  assert.ok(!JSON.stringify(state).includes('RAW_DO_NOT_STORE'));
  assert.ok(!JSON.stringify(state).includes(importEnv.CANVA_ACCESS_TOKEN));
  f.env.CANVA_GENERATION_MODE = 'editable_import';
  assert.equal((await f.command('post.request-design', {}, current)).record.id, job.id);
  await f.service.runJobs({ limit: 1, jobId: job.id });
  assert.equal(requests.filter(item => item.url.endsWith('/imports') && item.method === 'POST').length, 1);
});

test('legacy queued jobs never switch mode and active, unknown or identified results block creating another mode', async t => {
  const f = await fixture(t, noNetwork, autofillEnv);
  const post = await confirmedPost(f);
  const job = (await f.command('post.request-design', {}, post)).record;
  const states = [
    { status: 'queued' }, { status: 'running' }, { status: 'needs_reconciliation' },
    { status: 'failed', providerJobId: 'LegacyJob' },
    { status: 'blocked_configuration', needsReconciliation: true }, { status: 'succeeded' },
  ];
  for (const values of states) {
    await f.service.store.mutate({ actorEmail: actor.email, now: new Date().toISOString() }, state => {
      const current = state.jobs.find(item => item.id === job.id);
      delete current.generationMode; delete current.providerJobId; delete current.needsReconciliation;
      Object.assign(current, values); return { ok: true };
    });
    f.env.CANVA_GENERATION_MODE = 'editable_import';
    await assert.rejects(f.command('post.request-design', {}, await f.post(post.id)), { code: 'CANVA_MODE_CHANGE_BLOCKED' });
    assert.equal((await f.service.store.read()).jobs.length, 1);
  }
  await f.service.store.mutate({ actorEmail: actor.email, now: new Date().toISOString() }, state => {
    Object.assign(state.jobs[0], { status: 'queued' }); return { ok: true };
  });
  // No generationMode means legacy Autofill, even though import is now configured.
  let calledMode;
  const pinned = createOpsService({ db: f.db, env: f.env, providers: { ...adapters,
    createCanvaDesign: async (_, options) => { calledMode = options.generationMode; return { providerJobId: 'LegacyPending', status: 'in_progress' }; },
  } });
  await pinned.runJobs({ limit: 1, jobId: job.id }); assert.equal(calledMode, 'autofill');
});

test('ambiguous uploads and duplicate_import persist reconciliation and cannot be retried or changed to another mode', async t => {
  for (const scenario of ['network', 'duplicate']) await t.test(scenario, async t => {
    let posts = 0;
    const f = await fixture(t, async (_, request) => {
      if (request.method === 'POST') posts++;
      if (scenario === 'network') throw new Error('RAW_DO_NOT_STORE');
      return json({ job: { id: 'ImportTest01', status: 'failed', error: { code: 'duplicate_import', message: 'RAW_DO_NOT_STORE' } } });
    });
    const post = await confirmedPost(f);
    const requested = (await f.command('post.request-design', {}, post)).record;
    await f.service.runJobs({ limit: 1, jobId: requested.id });
    const job = (await f.service.store.read()).jobs[0];
    assert.equal(job.status, 'needs_reconciliation'); assert.equal(job.errorCode, 'UNCERTAIN_RESULT');
    if (scenario === 'duplicate') assert.equal(job.providerJobId, 'import:ImportTest01');
    await assert.rejects(f.command('job.retry', {}, job), { code: 'RETRY_NOT_ALLOWED' });
    f.env.CANVA_GENERATION_MODE = 'autofill';
    await assert.rejects(f.command('post.request-design', {}, await f.post(post.id)), { code: 'CANVA_MODE_CHANGE_BLOCKED' });
    await f.restart(); await f.service.runJobs({ limit: 1 });
    assert.equal(posts, 1);
    assert.ok(!JSON.stringify(await f.service.store.read()).includes('RAW_DO_NOT_STORE'));
  });
});

test('invalid imported outputs retain the provider ID for safe read-only retries and never attach a partial design', async t => {
  for (const invalid of ['multiple', 'page_count', 'wrong_readback']) await t.test(invalid, async t => {
    let posts = 0;
    const f = await fixture(t, async (url, request) => {
      if (request.method === 'POST') { posts++; return json(importJob('in_progress')); }
      if (url.includes('/imports/')) return json(importJob('success', invalid === 'multiple'
        ? [{ id: 'DImportedTest' }, { id: 'DExtra' }]
        : [{ id: 'DImportedTest', page_count: invalid === 'page_count' ? 2 : 3 }]));
      return json({ design: { ...readback().design, id: 'DWrong' } });
    });
    const post = await confirmedPost(f);
    const requested = (await f.command('post.request-design', {}, post)).record;
    await f.service.runJobs({ limit: 1, jobId: requested.id });
    await f.service.runJobs({ limit: 1, jobId: requested.id });
    let job = (await f.service.store.read()).jobs[0];
    assert.equal(job.status, 'failed'); assert.equal(job.errorCode, 'INVALID_PROVIDER_RESPONSE');
    assert.equal(job.providerJobId, 'import:ImportTest01');
    assert.equal((await f.post(post.id)).canvaEditUrl, undefined);
    await f.command('job.retry', {}, job);
    await f.service.runJobs({ limit: 1, jobId: requested.id });
    job = (await f.service.store.read()).jobs[0];
    assert.equal(job.status, 'failed'); assert.equal(job.providerJobId, 'import:ImportTest01'); assert.equal(posts, 1);
  });
});

test('manual design provenance replaces import provenance and changing copy invalidates both design and approval', async t => {
  const f = await fixture(t, async (url, request) => json(request.method === 'POST'
    ? importJob('in_progress') : url.includes('/imports/') ? importJob() : readback()));
  let post = await confirmedPost(f);
  const job = (await f.command('post.request-design', {}, post)).record;
  await f.service.runJobs({ limit: 1, jobId: job.id }); await f.service.runJobs({ limit: 1, jobId: job.id });
  post = await f.post(post.id); assert.equal(post.designGenerationMethod, 'editable_import');
  post = (await f.command('post.attach-design', { canvaDesignId: 'DManualTest', canvaEditUrl: 'https://www.canva.com/design/DManualTest/edit' }, post)).record;
  assert.equal(post.designGenerationMethod, 'manual');
  assert.ok(post.history.some(item => item.designGenerationMethod === 'editable_import'));
  post = (await f.command('post.update', { caption: '【整合測試】新版需要重新確認。' }, post)).record;
  assert.equal(post.copyVersion, 2); assert.equal(post.approvedVersion, undefined);
  assert.equal(post.designGenerationMethod, undefined); assert.equal(post.canvaEditUrl, undefined);
});

test('complete then reopen cannot bypass an obsolete same-version unknown or pending external creation', async t => {
  for (const scenario of ['unknown', 'pending']) await t.test(scenario, async t => {
    let posts = 0;
    const f = await fixture(t, async (_, request) => {
      if (request.method === 'POST') posts++;
      if (scenario === 'unknown') throw new Error('connection ended after write');
      return json(importJob('in_progress'));
    });
    let post = await confirmedPost(f);
    const job = (await f.command('post.request-design', {}, post)).record;
    await f.service.runJobs({ limit: 1, jobId: job.id });
    post = await f.post(post.id);
    post = (await f.command('post.complete', {}, post)).record;
    assert.equal(post.copyVersion, 1); assert.equal(post.approvedVersion, 1);
    assert.equal((await f.service.store.read()).jobs[0].status, 'obsolete');
    await f.restart();
    for (const mode of ['editable_import', 'autofill']) {
      f.env.CANVA_GENERATION_MODE = mode;
      await assert.rejects(f.command('post.request-design', {}, await f.post(post.id)), { code: 'CANVA_MODE_CHANGE_BLOCKED' });
    }
    const state = await f.service.store.read();
    assert.equal(state.jobs.length, 1); assert.equal(state.posts[0].stage, 'completed');
    assert.equal(posts, 1);
  });
});

test('a never-executed obsolete request can be replaced without reconfirming the same copy', async t => {
  const f = await fixture(t, noNetwork, autofillEnv);
  let post = await confirmedPost(f);
  const oldJob = (await f.command('post.request-design', {}, post)).record;
  post = (await f.command('post.complete', {}, await f.post(post.id))).record;
  f.env.CANVA_GENERATION_MODE = 'editable_import';
  const next = (await f.command('post.request-design', {}, post)).record;
  assert.notEqual(next.id, oldJob.id); assert.equal(next.generationMode, 'editable_import');
  assert.equal((await f.service.store.read()).jobs.find(job => job.id === oldJob.id).attempts, 0);
  assert.equal((await f.post(post.id)).approvedVersion, 1);
});
