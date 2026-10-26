'use strict';

// https://www.canva.dev/docs/apps/rest-apis/authentication/
// https://www.canva.dev/docs/apps/rest-apis/reference/authentication/generate-access-token/
// Canva authorization-code PKCE, with single-use refresh token rotation.
// Callers MUST keep verifiers/tokens server-side, bind state to the authenticated
// initiator, consume it once, and durably replace credentials after refresh.
const crypto = require('node:crypto');

const BASE_SCOPES = ['design:content:read', 'design:content:write', 'design:meta:read'];
const BRAND_SCOPES = ['brandtemplate:meta:read', 'brandtemplate:content:read'];

class CanvaOAuthError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'CanvaOAuthError';
    this.code = code;
    this.uncertain = !!options.uncertain;
    this.definite = !this.uncertain;
    this.configMissing = code === 'CONFIGURATION_MISSING';
    if (options.missing) this.missing = options.missing;
    if (options.status) this.status = options.status;
  }
}

function fail(code, message, options) { return new CanvaOAuthError(code, message, options); }
function present(env, key) { return typeof env[key] === 'string' && !!env[key].trim(); }

function validRedirect(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

function getOAuthConfiguration(env = process.env) {
  const missing = ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET', 'CANVA_REDIRECT_URI'].filter(key => !present(env, key));
  const invalid = !missing.length && (!validRedirect(env.CANVA_REDIRECT_URI) ||
    env.CANVA_CLIENT_ID.includes(':') || /[\r\n]/.test(env.CANVA_CLIENT_ID + env.CANVA_CLIENT_SECRET));
  return {
    configured: !missing.length && !invalid, missing,
    status: missing.length ? 'blocked_configuration' : invalid ? 'configuration_invalid' : 'configured_unverified',
    scopes: [...BASE_SCOPES, ...(present(env, 'CANVA_BRAND_TEMPLATE_ID') ? BRAND_SCOPES : [])],
  };
}

function requireConfiguration(env) {
  const status = getOAuthConfiguration(env);
  if (status.missing.length) throw fail('CONFIGURATION_MISSING', 'Canva OAuth 尚未設定完成。', { missing: status.missing });
  if (!status.configured) throw fail('CONFIGURATION_INVALID', 'Canva OAuth 回呼網址或應用程式設定不正確。');
  return status;
}

function createAuthorizationRequest({ env = process.env, now = Date.now } = {}) {
  const configuration = requireConfiguration(env);
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const url = new URL('https://www.canva.com/api/oauth/authorize');
  url.search = new URLSearchParams({
    code_challenge: codeChallenge, code_challenge_method: 'S256',
    scope: configuration.scopes.join(' '), response_type: 'code',
    client_id: env.CANVA_CLIENT_ID.trim(), state, redirect_uri: env.CANVA_REDIRECT_URI.trim(),
  }).toString();
  return { authorizationUrl: url.href, state, codeVerifier, expiresAt: new Date(now() + 10 * 60_000).toISOString() };
}

function verifyState(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(expected) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(received) ||
      expected.length !== received.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
    throw fail('VALIDATION_ERROR', 'Canva 授權狀態不相符，請重新開始連線。');
  }
}

async function tokenRequest(form, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  requireConfiguration(env);
  if (typeof fetchImpl !== 'function') throw fail('CONFIGURATION_INVALID', '伺服器無法連線至 Canva。');
  let response;
  const timeout = Math.max(1000, Math.min(Number(env.OPS_PROVIDER_TIMEOUT_MS) || 20000, 45000));
  try {
    response = await fetchImpl('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: 'Basic ' + Buffer.from(env.CANVA_CLIENT_ID.trim() + ':' + env.CANVA_CLIENT_SECRET.trim()).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw fail('UNCERTAIN_RESULT', 'Canva 授權請求結果不明，請重新連線；不要重複使用先前的授權碼或更新權杖。', { uncertain: true });
  }
  if (!response.ok) {
    const uncertain = response.status >= 500 || response.status === 408;
    throw fail(uncertain ? 'UNCERTAIN_RESULT' : 'PROVIDER_REJECTED',
      uncertain ? 'Canva 授權結果不明，請重新連線。' : 'Canva 授權遭拒（HTTP ' + response.status + '），請重新連線。',
      { uncertain, status: response.status });
  }
  let result;
  try {
    const text = await response.text();
    if (text.length > 100_000) throw new Error();
    result = JSON.parse(text);
    if (!result || typeof result.access_token !== 'string' || !result.access_token || result.access_token.length > 8192 ||
        typeof result.refresh_token !== 'string' || !result.refresh_token || result.refresh_token.length > 8192 ||
        /[\r\n]/.test(result.access_token + result.refresh_token) ||
        !Number.isFinite(result.expires_in) || result.expires_in < 1 || result.expires_in > 31_536_000 ||
        (result.token_type && result.token_type.toLowerCase() !== 'bearer')) throw new Error();
  } catch {
    throw fail('UNCERTAIN_RESULT', 'Canva 未回傳完整授權資料，請重新連線。', { uncertain: true });
  }
  // Do not log or serialize this result to a browser. The caller persists it encrypted.
  return {
    accessToken: result.access_token, refreshToken: result.refresh_token,
    expiresAt: new Date(now() + result.expires_in * 1000).toISOString(),
    scope: typeof result.scope === 'string' ? result.scope : '',
    tokenType: 'Bearer',
  };
}

async function exchangeAuthorizationCode(
  { code, codeVerifier, expectedState, receivedState } = {},
  options = {},
) {
  verifyState(expectedState, receivedState);
  if (typeof code !== 'string' || !code || code.length > 4096 || /[\r\n]/.test(code) ||
      typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    throw fail('VALIDATION_ERROR', 'Canva 授權碼或 PKCE 資料不正確。');
  }
  const env = options.env || process.env;
  requireConfiguration(env);
  return tokenRequest({
    grant_type: 'authorization_code', code, code_verifier: codeVerifier,
    redirect_uri: env.CANVA_REDIRECT_URI.trim(),
  }, options);
}

async function refreshCanvaToken({ refreshToken } = {}, options = {}) {
  if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 8192 || /[\r\n]/.test(refreshToken)) {
    throw fail('VALIDATION_ERROR', 'Canva 更新權杖不正確，請重新連線。');
  }
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, options);
}

module.exports = { CanvaOAuthError, getOAuthConfiguration, createAuthorizationRequest, exchangeAuthorizationCode, refreshCanvaToken };
