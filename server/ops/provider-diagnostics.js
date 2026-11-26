'use strict';

// Only fixed operation names, numeric HTTP statuses and documented codes may
// cross the provider boundary. Never persist provider messages, URLs or metadata.
// https://www.canva.dev/docs/apps/rest-apis/error-responses/
// https://cloud.google.com/apis/design/errors
const STAGES = Object.freeze({
  canva: Object.freeze({
    dataset_read: '讀取母版欄位', autofill_create: '建立套版設計',
    autofill_poll: '查詢設計工作', design_readback: '讀回完成設計',
    import_create: '建立可編輯匯入', import_poll: '查詢可編輯匯入',
  }),
  google_sheets: Object.freeze({ token: '取得唯讀授權', read: '讀取來源資料' }),
});
const CANVA_CODES = new Set([
  'invalid_access_token', 'revoked_access_token', 'missing_scope', 'permission_denied',
  'not_found', 'design_not_found', 'bad_request_body', 'bad_request_params', 'invalid_field',
  'missing_field', 'too_many_requests', 'quota_exceeded', 'design_not_fillable',
  'autofill_data_invalid', 'unsupported_design_type', 'feature_not_available', 'internal_error',
]);
const CANVA_AUTOFILL_REASONS = Object.freeze({
  DESIGN_ACCESS_DENIED: 'Canva 拒絕存取來源設計，請核對目前連線帳號及設計分享權限。',
  BRAND_TEMPLATE_ACCESS_DENIED: 'Canva 拒絕存取來源品牌範本，請核對目前連線帳號及範本分享權限。',
  AUTOFILL_PLAN_REQUIRED: 'Canva 回報目前帳號的方案未提供 Autofill 使用資格。系統未進行升級或付款。',
});
// Match only the complete documented 403 templates. IDs and URLs are neither
// captured nor retained; the final lookahead rejects even a trailing newline.
// https://www.canva.dev/docs/apps/rest-apis/reference/autofills/create-design-autofill-job/
const CANVA_AUTOFILL_DENIALS = [
  [/^Not allowed to access design with id '[A-Za-z0-9_-]{1,128}'(?![\s\S])/, 'DESIGN_ACCESS_DENIED'],
  [/^Not allowed to access brand template with id '[A-Za-z0-9_-]{1,128}'(?![\s\S])/, 'BRAND_TEMPLATE_ACCESS_DENIED'],
  [/^Access the autofill feature and other powerful design tools by upgrading your Canva plan here: https:\/\/(?:www\.)?canva\.com\/(?:[A-Za-z0-9._~!$&()*+,;=:@/?#-]|%[0-9A-Fa-f]{2})*(?![\s\S])/, 'AUTOFILL_PLAN_REQUIRED'],
];

function isCanvaAutofillDenial(value) {
  return value.provider === 'canva' && value.stage === 'autofill_create' &&
    value.httpStatus === 403 && value.code === 'permission_denied';
}

function canvaAutofillReason(diagnostic, message) {
  if (!isCanvaAutofillDenial(diagnostic) || typeof message !== 'string') return undefined;
  return CANVA_AUTOFILL_DENIALS.find(([pattern]) => pattern.test(message))?.[1];
}

const GOOGLE_TOKEN_CODES = new Set(['invalid_grant', 'invalid_client', 'invalid_scope', 'unauthorized_client']);
const GOOGLE_API_CODES = new Set([
  'PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'INVALID_ARGUMENT', 'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED',
]);
const GOOGLE_REASONS = new Set([
  'SERVICE_DISABLED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'ACCESS_TOKEN_EXPIRED',
  'ACCOUNT_STATE_INVALID', 'USER_PROJECT_DENIED', 'RATE_LIMIT_EXCEEDED',
]);

function safeProviderDiagnostic(value) {
  if (!value || !Object.hasOwn(STAGES, value.provider) || !Object.hasOwn(STAGES[value.provider], value.stage) ||
      !Number.isInteger(value.httpStatus) || value.httpStatus < 400 || value.httpStatus > 599) return null;
  const codes = value.provider === 'canva' ? CANVA_CODES : value.stage === 'token' ? GOOGLE_TOKEN_CODES : GOOGLE_API_CODES;
  return {
    provider: value.provider, stage: value.stage, httpStatus: value.httpStatus,
    ...(codes.has(value.code) ? { code: value.code } : {}),
    ...(isCanvaAutofillDenial(value) && Object.hasOwn(CANVA_AUTOFILL_REASONS, value.reason) ? { reason: value.reason } : {}),
    ...(value.provider === 'google_sheets' && value.stage === 'read' && GOOGLE_REASONS.has(value.reason) ? { reason: value.reason } : {}),
  };
}

async function boundedErrorBody(response) {
  // Error responses are untrusted input. Limit bytes before concatenating or
  // parsing, and stop reading even if a provider stalls its response body.
  if (!response.body || typeof response.body.getReader !== 'function') return null;
  const reader = response.body.getReader();
  let timer;
  try {
    const read = (async () => {
      const chunks = []; let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) throw new Error('Error body limit');
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf8');
    })();
    const text = await Promise.race([read, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Error body timeout')), 1000);
    })]);
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

async function providerResponseDiagnostic(response, context) {
  const diagnostic = safeProviderDiagnostic({ ...context, httpStatus: response.status });
  if (!diagnostic) return null;
  const body = await boundedErrorBody(response);
  if (!body) return diagnostic;
  if (diagnostic.provider === 'canva') {
    if (CANVA_CODES.has(body.code)) diagnostic.code = body.code;
    const reason = canvaAutofillReason(diagnostic, body.message);
    if (reason) diagnostic.reason = reason;
  } else if (diagnostic.stage === 'token') {
    if (GOOGLE_TOKEN_CODES.has(body.error)) diagnostic.code = body.error;
  } else {
    if (GOOGLE_API_CODES.has(body.error?.status)) diagnostic.code = body.error.status;
    if (Array.isArray(body.error?.details)) {
      const info = body.error.details.find(detail => detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' &&
        detail.domain === 'googleapis.com' && GOOGLE_REASONS.has(detail.reason));
      if (info) diagnostic.reason = info.reason;
    }
  }
  return diagnostic;
}

function formatProviderDiagnostic(error) {
  if (error?.code !== 'PROVIDER_REJECTED') return null;
  const diagnostic = safeProviderDiagnostic(error.diagnostic);
  if (!diagnostic) return null;
  const details = [`HTTP ${diagnostic.httpStatus}`, diagnostic.code, diagnostic.reason].filter(Boolean).join('，');
  if (diagnostic.provider === 'google_sheets') {
    const hint = diagnostic.reason === 'SERVICE_DISABLED'
      ? 'Google 回報 API 尚未啟用，請由服務帳號所屬專案的管理者確認 Sheets API 設定。'
      : diagnostic.stage === 'token' ? '請檢查 Google 服務帳號授權設定。'
        : '請核對來源表分享權限、服務帳號與 Sheets API 設定。';
    return `Google 試算表${STAGES.google_sheets[diagnostic.stage]}未完成（${details}）。${hint}`;
  }
  const hint = CANVA_AUTOFILL_REASONS[diagnostic.reason] || (diagnostic.stage === 'dataset_read'
    ? '請核對目前連線帳號的母版存取權與應用程式授權。'
    : diagnostic.stage === 'autofill_create'
      ? '請核對母版存取權、應用程式授權與帳號的 Autofill 使用資格。'
      : '請核對目前連線與設計存取權。');
  return `Canva ${STAGES.canva[diagnostic.stage]}未完成（${details}）。${hint}`;
}

module.exports = { safeProviderDiagnostic, providerResponseDiagnostic, formatProviderDiagnostic };
