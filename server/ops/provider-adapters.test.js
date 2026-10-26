'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  getIntegrationStatus, generateCopy, createCanvaDesign, getCanvaJob, readSheetSource,
} = require('./providers');
const {
  getOAuthConfiguration, createAuthorizationRequest, exchangeAuthorizationCode, refreshCanvaToken,
} = require('./canva-oauth');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const noNetwork = async () => { throw new Error('Unexpected network request'); };
const approved = {
  event: { title: '示範活動', date: '2027-01-01', time: '19:00', venue: '示範教室', speaker: '示範講者' },
  post: {
    title: '示範宣傳', caption: '已審核文案', slides: [{ heading: '標題', body: '內容' }],
    stage: 'design_pending', copyVersion: 2, approvedVersion: 2, approvedBy: 'approver@example.test',
    approvedAt: '2026-10-25T00:00:00.000Z',
  },
  obligations: [],
};
const canvaEnv = {
  CANVA_ACCESS_TOKEN: 'test_canva_access',
  CANVA_TEMPLATE_DESIGN_ID: 'DExampleTemplate',
  CANVA_FIELD_MAP_JSON: JSON.stringify({
    TITLE: { type: 'text', path: 'post.title', maxLength: 40 },
    DATE: { type: 'text', path: 'event.date' },
    LOGO: { type: 'image', assetId: 'MExampleLogo' },
  }),
};
const dataset = { dataset: { TITLE: { type: 'text' }, DATE: { type: 'text' }, LOGO: { type: 'image' } } };
const oauthEnv = {
  CANVA_CLIENT_ID: 'OCExample', CANVA_CLIENT_SECRET: 'test_client_secret',
  CANVA_REDIRECT_URI: 'https://club.example.test/api/ops/canva/callback',
};

test('configuration reports capability without leaking credentials or claiming verified access', () => {
  const empty = getIntegrationStatus({});
  assert.equal(empty.drafting.status, 'rules_only');
  assert.equal(empty.canva.status, 'blocked_configuration');
  const status = getIntegrationStatus({ ...canvaEnv, OPENAI_API_KEY: 'test_ai_key', OPENAI_MODEL: 'configured-model' });
  assert.equal(status.canva.configured, true);
  assert.equal(status.canva.verified, false);
  const serialized = JSON.stringify(status);
  for (const secret of ['test_canva_access', 'test_ai_key', 'MExampleLogo']) assert.ok(!serialized.includes(secret));
  assert.equal(getIntegrationStatus({ ...canvaEnv, CANVA_FIELD_MAP_JSON: '{broken' }).canva.status, 'configuration_invalid');
  const expired = getIntegrationStatus({ ...canvaEnv, CANVA_ACCESS_TOKEN_EXPIRES_AT: '2000-01-01T00:00:00.000Z' });
  assert.equal(expired.canva.configured, false);
  assert.equal(expired.canva.requiresConnection, true);
});

test('missing either AI key or explicit model uses labelled rules with honest placeholders', async () => {
  for (const env of [{}, { OPENAI_API_KEY: 'test_ai_key' }, { OPENAI_MODEL: 'model' }]) {
    const draft = await generateCopy({ post: { title: '活動' } }, { env, fetchImpl: noNetwork });
    assert.equal(draft.generationMethod, 'rules');
    assert.match(draft.caption, /【待確認】/);
    assert.equal(draft.slides.length, 3);
  }
});

const compactMap = {
  HEADING_1: { type: 'text', path: 'post.slides.0.heading', maxLength: 12 },
  HEADING_1_REPEAT: { type: 'text', path: 'post.slides.0.heading', maxLength: 8 },
  BODY_1: { type: 'text', path: 'post.slides.0.body', maxLength: 42 },
  HEADING_2: { type: 'text', path: 'post.slides.1.heading', maxLength: 8 },
  BODY_2: { type: 'text', path: 'post.slides.1.body', maxLength: 84 },
  HEADING_3: { type: 'text', path: 'post.slides.2.heading', maxLength: 8 },
  BODY_3: { type: 'text', path: 'post.slides.2.body', maxLength: 84 },
};

test('optional template limits shorten only rule slides, preserving full caption and Unicode graphemes', async () => {
  const family = '👩‍👩‍👧‍👦';
  const input = {
    event: { title: '示範', date: '2027-01-01', time: '19:00', speaker: '示範講者', venue: '示範場地', fee: '100 元' },
    post: {
      title: family + '這是一個超過母版長度的示範標題',
      highlights: '這是完整宣傳重點，包含活動的內容與參與資訊。'.repeat(6),
      cta: '完整報名方式：' + 'https://example.test/register?reference=' + 'sample'.repeat(20),
    },
  };
  const original = structuredClone(input);
  const baseline = await generateCopy(input, { env: {}, fetchImpl: noNetwork });
  const bounded = await generateCopy(input, { env: { CANVA_FIELD_MAP_JSON: JSON.stringify(compactMap) }, fetchImpl: noNetwork });
  assert.equal(bounded.generationMethod, 'rules');
  assert.equal(bounded.caption, baseline.caption);
  assert.ok(bounded.caption.includes(input.post.highlights));
  assert.ok(bounded.caption.includes(input.post.cta));
  assert.equal(bounded.slides[0].heading, family + '…');
  for (const [index, bodyLimit] of [42, 84, 84].entries()) {
    assert.ok(Array.from(bounded.slides[index].heading).length <= 8);
    assert.ok(Array.from(bounded.slides[index].body).length <= bodyLimit);
  }
  assert.ok(bounded.slides[0].body.endsWith('…'));
  assert.ok(bounded.slides[2].body.endsWith('…'));
  assert.deepEqual(input, original);
});

test('missing, invalid, or unrelated Canva mapping preserves default draft behavior', async () => {
  const input = { event: approved.event, post: { title: 'a'.repeat(100), highlights: 'b'.repeat(700) } };
  const baseline = await generateCopy(input, { env: {}, fetchImpl: noNetwork });
  for (const CANVA_FIELD_MAP_JSON of [
    '{invalid',
    JSON.stringify({ BAD: { type: 'text', path: 'post.slides.0.heading', maxLength: 0 } }),
    JSON.stringify({ TITLE: { type: 'text', path: 'event.title', maxLength: 8 } }),
  ]) {
    assert.deepEqual(await generateCopy(input, { env: { CANVA_FIELD_MAP_JSON }, fetchImpl: noNetwork }), baseline);
  }
  assert.equal(baseline.slides[0].heading.length, 80);
  assert.equal(baseline.slides[0].body.length, 600);
});

test('AI request enforces minimum mapped limit per page slot and returns the unchanged public slides-array shape', async () => {
  let requestBody;
  const content = {
    caption: '完整活動資訊與報名連結仍在這裡',
    slides: {
      page_1: { heading: '標題一', body: '一'.repeat(42) },
      page_2: { heading: '標題二', body: '二'.repeat(84) },
      page_3: { heading: '標題三', body: '三'.repeat(84) },
    },
  };
  const result = await generateCopy(approved, {
    env: { OPENAI_API_KEY: 'test_ai_key', OPENAI_MODEL: 'explicit-model', CANVA_FIELD_MAP_JSON: JSON.stringify(compactMap) },
    fetchImpl: async (_, request) => {
      requestBody = JSON.parse(request.body);
      return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(content) }] }] });
    },
  });
  const pages = requestBody.text.format.schema.properties.slides.properties;
  assert.equal(pages.page_1.properties.heading.maxLength, 8);
  assert.equal(pages.page_1.properties.body.maxLength, 42);
  assert.equal(pages.page_2.properties.body.maxLength, 84);
  assert.equal(pages.page_3.properties.body.maxLength, 84);
  assert.match(requestBody.instructions, /第 1 頁 heading 最多 8 字、body 最多 42 字/);
  assert.match(requestBody.instructions, /完整活動事實與報名連結保留於 caption/);
  assert.deepEqual(result, {
    caption: content.caption, slides: Object.values(content.slides), generationMethod: 'openai',
  });
});

test('AI text exceeding a particular template slot is rejected without silent truncation', async () => {
  const content = {
    caption: '原始完整文案',
    slides: {
      page_1: { heading: '標題一', body: '一'.repeat(43) },
      page_2: { heading: '標題二', body: '二'.repeat(84) },
      page_3: { heading: '標題三', body: '三'.repeat(84) },
    },
  };
  const original = structuredClone(content);
  await assert.rejects(generateCopy(approved, {
    env: { OPENAI_API_KEY: 'test_ai_key', OPENAI_MODEL: 'explicit-model', CANVA_FIELD_MAP_JSON: JSON.stringify(compactMap) },
    fetchImpl: async () => json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(content) }] }] }),
  }), error => error.code === 'INVALID_PROVIDER_RESPONSE' && error.message.includes('母版欄位限制'));
  assert.deepEqual(content, original);
});

test('AI request uses explicit model, structured Responses output, limited public fields, and no stored response', async () => {
  let body;
  const responseDraft = { caption: '測試文案', slides: Array.from({ length: 3 }, (_, i) => ({ heading: '頁' + i, body: '內容' })) };
  const draft = await generateCopy({
    ...approved,
    event: { ...approved.event, ownerEmail: 'private@example.test', privateNote: 'do not transmit' },
    obligations: [{ title: '示範贊助', requirements: '需先確認 Logo 位置', requiresSponsorReview: true }],
  }, {
    env: { OPENAI_API_KEY: 'test_ai_key', OPENAI_MODEL: 'explicit-model' },
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      body = JSON.parse(request.body);
      return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(responseDraft) }] }] });
    },
  });
  assert.equal(body.model, 'explicit-model');
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.match(body.input, /Logo/);
  assert.ok(!body.input.includes('private@example.test') && !body.input.includes('do not transmit'));
  assert.deepEqual(draft, { ...responseDraft, generationMethod: 'openai' });
});

test('AI provider rejection, incomplete output, refusal, and malformed structure never become rule successes', async () => {
  const env = { OPENAI_API_KEY: 'test_ai_key', OPENAI_MODEL: 'explicit-model' };
  const responses = [
    () => json({ error: { message: 'test_ai_key' } }, 401),
    () => json({ status: 'incomplete', output: [] }),
    () => json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }),
    () => json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"caption":3,"slides":[]}' }] }] }),
  ];
  for (const response of responses) {
    await assert.rejects(generateCopy(approved, { env, fetchImpl: async () => response() }), error => {
      assert.ok(!error.message.includes('test_ai_key'));
      return ['PROVIDER_REJECTED', 'INVALID_PROVIDER_RESPONSE'].includes(error.code);
    });
  }
});

test('Canva refuses unapproved/stale copy and missing configuration before network', async () => {
  await assert.rejects(createCanvaDesign({ ...approved, post: { ...approved.post, approvedVersion: 1 } }, {
    env: canvaEnv, fetchImpl: noNetwork,
  }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(createCanvaDesign(approved, { env: {}, fetchImpl: noNetwork }), { code: 'CONFIGURATION_MISSING' });
  await assert.rejects(createCanvaDesign(approved, { env: { ...canvaEnv, CANVA_BRAND_TEMPLATE_ID: 'BTemplate' }, fetchImpl: noNetwork }),
    { code: 'CONFIGURATION_INVALID' });
});

test('Canva validates current dataset then creates a NEW design with independently mapped text and asset fields', async () => {
  const requests = [];
  const result = await createCanvaDesign(approved, {
    env: canvaEnv,
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return requests.length === 1 ? json(dataset) : json({ job: { id: 'job-123', status: 'in_progress' } });
    },
  });
  assert.deepEqual(result, { providerJobId: 'job-123', status: 'in_progress' });
  assert.match(requests[0].url, /designs\/DExampleTemplate\/dataset$/);
  assert.equal(requests[0].request.method, 'GET');
  const body = JSON.parse(requests[1].request.body);
  assert.equal(body.type, 'create_from_design');
  assert.equal(body.design_id, 'DExampleTemplate');
  assert.deepEqual(body.data.TITLE, { type: 'text', text: '示範宣傳' });
  assert.deepEqual(body.data.LOGO, { type: 'image', asset_id: 'MExampleLogo' });
  assert.ok(!JSON.stringify(body).includes('update_design'));
});

test('Canva brand template mode and injected durable OAuth token are supported', async () => {
  let posted;
  const env = { ...canvaEnv, CANVA_ACCESS_TOKEN: '', CANVA_TEMPLATE_DESIGN_ID: '', CANVA_BRAND_TEMPLATE_ID: 'BExample' };
  await createCanvaDesign(approved, {
    env, getCanvaAccessToken: async () => 'oauth_access',
    fetchImpl: async (url, request) => {
      assert.equal(request.headers.Authorization, 'Bearer oauth_access');
      if (request.method === 'GET') { assert.match(url, /brand-templates\/BExample\/dataset$/); return json(dataset); }
      posted = JSON.parse(request.body);
      return json({ job: { id: 'job-456', status: 'in_progress' } });
    },
  });
  assert.equal(posted.type, 'create_from_brand_template');
  assert.equal(posted.brand_template_id, 'BExample');
  assert.ok(!Object.hasOwn(posted, 'design_id'));
});

test('Canva blocks renamed/unmapped/mistyped dataset and long or missing content instead of silently keeping stale template text', async () => {
  const badDatasets = [
    { dataset: {} },
    { dataset: { ...dataset.dataset, EXTRA: { type: 'text' } } },
    { dataset: { ...dataset.dataset, TITLE: { type: 'image' } } },
    { dataset: { RENAMED: { type: 'text' }, DATE: { type: 'text' }, LOGO: { type: 'image' } } },
  ];
  for (const fixture of badDatasets) {
    let calls = 0;
    await assert.rejects(createCanvaDesign(approved, { env: canvaEnv, fetchImpl: async () => { calls++; return json(fixture); } }),
      { code: 'CONFIGURATION_INVALID' });
    assert.equal(calls, 1);
  }
  for (const title of ['', 'a'.repeat(41)]) {
    let calls = 0;
    await assert.rejects(createCanvaDesign({ ...approved, post: { ...approved.post, title } }, {
      env: canvaEnv, fetchImpl: async () => { calls++; return json(dataset); },
    }), { code: 'VALIDATION_ERROR' });
    assert.equal(calls, 1);
  }
});

test('ambiguous Canva create writes require reconciliation, while failed preflight/definite 4xx remain safe to retry', async () => {
  const cases = [
    { response: () => { throw new Error('test_canva_access socket lost'); }, code: 'UNCERTAIN_RESULT', uncertain: true },
    { response: () => json({}, 503), code: 'UNCERTAIN_RESULT', uncertain: true },
    { response: () => new Response('not-json'), code: 'UNCERTAIN_RESULT', uncertain: true },
    { response: () => json({}, 400), code: 'PROVIDER_REJECTED', uncertain: false },
    { response: () => json({}, 429), code: 'PROVIDER_REJECTED', uncertain: false },
  ];
  for (const scenario of cases) {
    let count = 0;
    await assert.rejects(createCanvaDesign(approved, {
      env: canvaEnv, fetchImpl: async () => ++count === 1 ? json(dataset) : scenario.response(),
    }), error => {
      assert.equal(error.code, scenario.code);
      assert.equal(error.uncertain, scenario.uncertain);
      assert.ok(!error.message.includes('test_canva_access'));
      return true;
    });
    assert.equal(count, 2);
  }
  await assert.rejects(createCanvaDesign(approved, { env: canvaEnv, fetchImpl: async () => { throw new Error('offline'); } }),
    { code: 'PROVIDER_UNAVAILABLE', uncertain: false });
});

test('Canva job polling validates job identity and secure Canva edit URL', async () => {
  const complete = { job: { id: 'job-123', status: 'success', result: { type: 'create_design', design: {
    id: 'DNewDesign', url: 'https://www.canva.com/design/DNewDesign/edit',
  } } } };
  assert.deepEqual(await getCanvaJob('job-123', { env: canvaEnv, fetchImpl: async () => json(complete) }), {
    providerJobId: 'job-123', status: 'success', canvaDesignId: 'DNewDesign', canvaEditUrl: 'https://www.canva.com/design/DNewDesign/edit',
  });
  for (const badUrl of ['http://www.canva.com/design/D/edit', 'https://canva.com.evil.example/design/D/edit', 'https://user:pass@www.canva.com/design/D/edit']) {
    const bad = structuredClone(complete); bad.job.result.design.url = badUrl;
    await assert.rejects(getCanvaJob('job-123', { env: canvaEnv, fetchImpl: async () => json(bad) }), { code: 'INVALID_PROVIDER_RESPONSE' });
  }
  await assert.rejects(getCanvaJob('another-id', { env: canvaEnv, fetchImpl: async () => json(complete) }), { code: 'INVALID_PROVIDER_RESPONSE' });
});

test('Sheets accepts only configured IDs and explicitly bounded ranges, always read-only', async () => {
  const env = { GOOGLE_SHEETS_ACCESS_TOKEN: 'test_google_token', OPS_SHEET_SOURCES_JSON: JSON.stringify([
    { id: 'events', spreadsheetId: 'SheetExample', range: '活動!A1:D100' },
  ]) };
  let requests = 0;
  const result = await readSheetSource({ spreadsheetId: 'SheetExample', range: '活動!A1:D100' }, {
    env, fetchImpl: async (url, request) => {
      requests++;
      assert.equal(request.method, 'GET');
      assert.equal(request.body, undefined);
      assert.match(url, /majorDimension=ROWS/);
      assert.equal(request.headers.Authorization, 'Bearer test_google_token');
      return json({ range: '活動!A1:D100', values: [['title', 'date'], ['示範', '2027-01-01']] });
    },
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.values.length, 2);
  for (const input of [
    { spreadsheetId: 'OtherSheet', range: '活動!A1:D100' },
    { spreadsheetId: 'SheetExample', range: '活動!A1:D99' },
    { spreadsheetId: 'SheetExample', range: '活動!A:Z' },
    { spreadsheetId: 'SheetExample', range: '活動!A1:Z10000' },
    { spreadsheetId: 'SheetExample', range: '活動!Z1:A2' },
  ]) await assert.rejects(readSheetSource(input, { env, fetchImpl: noNetwork }), { code: 'VALIDATION_ERROR' });
  assert.equal(requests, 1);
});

test('Sheets service account signs only readonly scope without delegated impersonation', async () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    OPS_SHEET_SOURCE_IDS: 'SheetExample',
    GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: 'service_account', client_email: 'reader@example-project.iam.gserviceaccount.com',
      private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://attacker.example/token',
    }),
  };
  let claims;
  const result = await readSheetSource({ spreadsheetId: 'SheetExample', range: "'Example Sheet'!A1:B5" }, {
    env, fetchImpl: async (url, request) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const form = new URLSearchParams(request.body);
        const [head, payload, signature] = form.get('assertion').split('.');
        assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
        assert.equal(crypto.verify('RSA-SHA256', Buffer.from(head + '.' + payload), keys.publicKey, Buffer.from(signature, 'base64url')), true);
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return json({ access_token: 'issued_google_token', expires_in: 3600 });
      }
      assert.ok(url.startsWith('https://sheets.googleapis.com/'));
      assert.equal(request.headers.Authorization, 'Bearer issued_google_token');
      return json({ values: [] });
    },
  });
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.ok(!Object.hasOwn(claims, 'sub'));
  assert.equal(result.values.length, 0);
});

test('OAuth creates unpredictable state and PKCE while keeping verifier and client secret out of authorization URL', () => {
  const first = createAuthorizationRequest({ env: oauthEnv, now: () => 0 });
  const second = createAuthorizationRequest({ env: oauthEnv, now: () => 0 });
  const url = new URL(first.authorizationUrl);
  assert.equal(url.origin, 'https://www.canva.com');
  assert.equal(url.searchParams.get('state'), first.state);
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(first.codeVerifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(first.expiresAt, '1970-01-01T00:10:00.000Z');
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.codeVerifier, second.codeVerifier);
  assert.ok(!first.authorizationUrl.includes(first.codeVerifier) && !first.authorizationUrl.includes(oauthEnv.CANVA_CLIENT_SECRET));
  assert.equal(getOAuthConfiguration({ ...oauthEnv, CANVA_REDIRECT_URI: 'http://public.example/callback' }).configured, false);
  assert.equal(getOAuthConfiguration({ ...oauthEnv, CANVA_REDIRECT_URI: 'http://localhost:3001/callback' }).configured, true);
});

test('OAuth rejects mismatched/non-ASCII state before token exchange', async () => {
  const authorization = createAuthorizationRequest({ env: oauthEnv });
  for (const receivedState of ['bad', 'a'.repeat(43), '全'.repeat(43)]) {
    await assert.rejects(exchangeAuthorizationCode({
      code: 'auth_code', codeVerifier: authorization.codeVerifier,
      expectedState: authorization.state, receivedState,
    }, { env: oauthEnv, fetchImpl: noNetwork }), { code: 'VALIDATION_ERROR' });
  }
});

test('OAuth exchanges PKCE code and returns rotated credentials only to caller', async () => {
  const authorization = createAuthorizationRequest({ env: oauthEnv });
  let form;
  const result = await exchangeAuthorizationCode({
    code: 'auth_code', codeVerifier: authorization.codeVerifier,
    expectedState: authorization.state, receivedState: authorization.state,
  }, {
    env: oauthEnv, now: () => 0,
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://api.canva.com/rest/v1/oauth/token');
      assert.equal(request.headers.Authorization, 'Basic ' + Buffer.from('OCExample:test_client_secret').toString('base64'));
      form = new URLSearchParams(request.body);
      return json({ access_token: 'new_access', refresh_token: 'new_refresh', expires_in: 14400, token_type: 'Bearer', scope: 'design:content:write' });
    },
  });
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code_verifier'), authorization.codeVerifier);
  assert.equal(form.get('redirect_uri'), oauthEnv.CANVA_REDIRECT_URI);
  assert.deepEqual(result, {
    accessToken: 'new_access', refreshToken: 'new_refresh', expiresAt: '1970-01-01T04:00:00.000Z', scope: 'design:content:write', tokenType: 'Bearer',
  });
});

test('OAuth refresh returns the NEW refresh token and does not automatically retry single-use credentials', async () => {
  let calls = 0;
  const result = await refreshCanvaToken({ refreshToken: 'old_refresh' }, {
    env: oauthEnv, fetchImpl: async (_, request) => {
      calls++;
      const form = new URLSearchParams(request.body);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), 'old_refresh');
      return json({ access_token: 'next_access', refresh_token: 'rotated_refresh', expires_in: 3600 });
    },
  });
  assert.equal(result.refreshToken, 'rotated_refresh');
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(refreshCanvaToken({ refreshToken: 'old_refresh' }, {
    env: oauthEnv, fetchImpl: async () => { calls++; throw new Error('secret transport failure'); },
  }), error => error.code === 'UNCERTAIN_RESULT' && error.uncertain === true && !error.message.includes('old_refresh'));
  assert.equal(calls, 1);
});
