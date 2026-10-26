const ROUTES = Object.freeze({
  bootstrap: 'GET',
  actions: 'POST',
  'connections/canva': 'GET',
  'connections/canva/start': 'POST',
});

export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 55_000;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// Keep aligned with server/ops/auth.js, domain.js, service.js and ops-connection.js.
// A platform's JSON access-denied response is not evidence of expired Firebase identity.
const OPS_ACCESS_CODES = {
  401: new Set(['IDENTITY_REQUIRED', 'INVALID_IDENTITY']),
  403: new Set([
    'ROLE_REQUIRED', 'OWNER_REQUIRED', 'ADVISOR_REQUIRED', 'ASSIGNMENT_REQUIRED',
    'UNIT_REVIEWER_REQUIRED', 'FINAL_APPROVER_REQUIRED', 'REVIEWER_REQUIRED',
    'DESIGNER_REQUIRED', 'PUBLISHER_REQUIRED', 'PERSON_ACCESS_REVOKED',
  ]),
};
const SENSITIVE_KEYS = new Set([
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'oidctoken', 'verceloidctoken',
  'authorization', 'cookie', 'setcookie', 'xverceloidctoken', 'xverceltrustedoidcidptoken',
  'apikey', 'authtoken', 'clientsecret', 'privatekey', 'password', 'passwordhash', 'sealed',
]);

class ProxyError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}
const problem = (status, code, message, headers) => new ProxyError(status, code, message, headers);
const invalidRequest = () => problem(400, 'OPS_PROXY_INVALID_REQUEST', '工作台請求格式不正確。');
const invalidResponse = () => problem(502, 'OPS_PROXY_INVALID_RESPONSE', '後端未回傳可驗證的工作台資料，請檢查部署保護與 API 設定。');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function header(req, name) {
  const entries = Object.entries(req.headers || {}).filter(([key]) => key.toLowerCase() === name);
  if (entries.length > 1 || (entries.length && typeof entries[0][1] !== 'string')) throw invalidRequest();
  if (Array.isArray(req.rawHeaders)) {
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (String(req.rawHeaders[i]).toLowerCase() === name) count++;
    if (count > 1) throw invalidRequest();
  }
  return entries[0]?.[1];
}

function routeFor(req) {
  // Support both Vercel's rewritten URL and the original URL. Never normalize a
  // caller's path, accept additional query parameters, or forward a query upstream.
  if (typeof req.url !== 'string' || req.url.length > 1024 || !req.url.startsWith('/') || req.url.startsWith('//') || /[\\#\r\n]/.test(req.url)) throw invalidRequest();
  const [pathname] = req.url.split('?');
  if (!/^\/api\/ops(?:\/[a-z][a-z/-]*)?$/.test(pathname)) throw problem(404, 'OPS_PROXY_ROUTE_NOT_FOUND', '此工作台 API 路徑不提供代理。');
  const parsed = new URL(req.url, 'https://ops-proxy.invalid');
  for (const key of parsed.searchParams.keys()) if (key !== 'path') throw invalidRequest();
  const paths = parsed.searchParams.getAll('path');
  if (paths.length > 1) throw invalidRequest();
  if (req.query !== undefined && (!isObject(req.query) || Object.keys(req.query).some(key => key !== 'path'))) throw invalidRequest();
  const queryPath = req.query?.path;
  if (queryPath !== undefined && typeof queryPath !== 'string') throw invalidRequest();
  if (paths.length && queryPath !== undefined && paths[0] !== queryPath) throw invalidRequest();
  const supplied = queryPath ?? paths[0];
  const route = pathname === '/api/ops' ? supplied : pathname.slice('/api/ops/'.length);
  if (pathname !== '/api/ops' && supplied !== undefined && supplied !== route) throw invalidRequest();
  if (typeof route !== 'string' || !Object.hasOwn(ROUTES, route)) throw problem(404, 'OPS_PROXY_ROUTE_NOT_FOUND', '此工作台 API 路徑不提供代理。');
  if (req.method !== ROUTES[route]) throw problem(405, 'OPS_PROXY_METHOD_NOT_ALLOWED', '此路徑不接受這種請求方法。', { Allow: ROUTES[route] });
  return route;
}

function backendOrigin(env) {
  // This single server-owned value is the entire destination allowlist. This
  // version supports direct Vercel deployment origins, not arbitrary/custom hosts.
  // Browser headers, request bodies, and VITE_* variables cannot select a target.
  const value = env.OPS_BACKEND_ORIGIN;
  try {
    if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(url.hostname) ||
        (value !== url.origin && value !== `${url.origin}/`)) throw new Error();
    return url.origin;
  } catch {
    throw problem(503, 'OPS_PROXY_NOT_CONFIGURED', '工作台代理尚未完成後端連線設定。');
  }
}

function bearerFor(req) {
  const value = header(req, 'authorization');
  if (typeof value !== 'string' || !value.startsWith('Bearer ') || value.length > 8199 || !JWT.test(value.slice(7))) {
    throw problem(401, 'IDENTITY_REQUIRED', '請使用 Google 帳號重新登入社團工作台。');
  }
  // This is only a syntax check. The backend must still verify Firebase identity
  // and resolve roles; the proxy never derives permissions from an unverified JWT.
  return value;
}

async function requestBody(req, route) {
  const contentLength = header(req, 'content-length');
  if (contentLength !== undefined && !/^\d+$/.test(contentLength)) throw invalidRequest();
  if (Number(contentLength) > MAX_REQUEST_BYTES) throw problem(413, 'PAYLOAD_TOO_LARGE', '一次傳入的資料超過 256 KB，請分批匯入。');
  if (req.method === 'GET') {
    if (Number(contentLength) > 0 || header(req, 'transfer-encoding') || (req.body !== undefined && req.body !== null && req.body !== '')) throw invalidRequest();
    return undefined;
  }
  const encoding = header(req, 'content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw problem(415, 'OPS_PROXY_JSON_REQUIRED', '工作台僅接受未壓縮的 JSON 請求。');
  const chunks = [];
  let size = 0;
  const add = chunk => {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw problem(413, 'PAYLOAD_TOO_LARGE', '一次傳入的資料超過 256 KB，請分批匯入。');
    chunks.push(bytes);
  };
  try {
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body) || typeof req.body === 'string') add(req.body);
      else add(JSON.stringify(req.body));
    } else if (typeof req[Symbol.asyncIterator] === 'function') {
      for await (const chunk of req) add(chunk);
    }
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw invalidRequest();
  }
  if (!size) {
    // Axios sends Canva /start without a payload. It has no caller-controlled
    // OAuth options: the backend creates and stores its own PKCE state.
    if (route === 'connections/canva/start') return '{}';
    throw invalidRequest();
  }
  if ((header(req, 'content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'OPS_PROXY_JSON_REQUIRED', '工作台僅接受 JSON 請求。');
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!isObject(value)) throw new Error();
    if (route === 'connections/canva/start' && Object.keys(value).length) throw new Error();
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MAX_REQUEST_BYTES) throw problem(413, 'PAYLOAD_TOO_LARGE', '一次傳入的資料超過 256 KB，請分批匯入。');
    return serialized;
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw invalidRequest();
  }
}

async function discardResponse(response) {
  try { await response.body?.cancel(); } catch { /* Release rejected upstream bodies without exposing errors. */ }
}

async function readJson(response) {
  if ((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json' ||
      Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body?.getReader) {
    await discardResponse(response);
    throw invalidResponse();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw invalidResponse();
      chunks.push(Buffer.from(value));
    }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!isObject(result)) throw invalidResponse();
    return result;
  } catch (error) {
    try { await reader.cancel(); } catch { /* Do not expose upstream errors. */ }
    if (error instanceof ProxyError) throw error;
    throw invalidResponse();
  } finally { reader.releaseLock(); }
}

function assertNoCredentials(value, secrets) {
  const pending = [value];
  let visited = 0;
  while (pending.length) {
    if (++visited > 100_000) throw invalidResponse();
    const item = pending.pop();
    if (typeof item === 'string') {
      if (secrets.some(secret => item.includes(secret))) throw invalidResponse();
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) || secrets.some(secret => key.includes(secret))) throw invalidResponse();
        pending.push(child);
      }
    }
  }
}

function send(res, status, value, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, content] of Object.entries(extraHeaders)) res.setHeader(name, content);
  // Intentionally no upstream headers, cookies, redirects, or CORS permissions.
  res.end(JSON.stringify(value));
}

export function createOpsProxy({ getOidcToken, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  return async function opsProxy(req, res) {
    try {
      const route = routeFor(req);
      const authorization = bearerFor(req);
      const origin = backendOrigin(env);
      const body = await requestBody(req, route);
      let oidcToken;
      try { oidcToken = await getOidcToken(); } catch { /* No SDK error details or caller-token fallback. */ }
      if (typeof oidcToken !== 'string' || oidcToken.length > 16384 || !JWT.test(oidcToken)) {
        throw problem(503, 'OPS_PROXY_OIDC_UNAVAILABLE', '工作台尚未取得伺服器連線身分，請管理者檢查 Vercel OIDC 設定。');
      }
      let response;
      try {
        response = await fetchImpl(`${origin}/api/ops/${route}`, {
          method: req.method,
          headers: {
            Accept: 'application/json', Authorization: authorization,
            'x-vercel-trusted-oidc-idp-token': oidcToken,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body }),
          redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = ['AbortError', 'TimeoutError'].includes(error?.name);
        throw problem(timedOut ? 504 : 502, 'OPS_PROXY_UPSTREAM_UNAVAILABLE', '工作台後端連線未完成，請重新整理核對紀錄；尚未確認操作結果。');
      }
      if (response.status >= 300 && response.status < 400) {
        await discardResponse(response);
        throw problem(502, 'OPS_PROXY_REDIRECT_BLOCKED', '後端要求重新導向，工作台代理已停止；請管理者檢查後端網址與部署保護。');
      }
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
        await discardResponse(response);
        throw invalidResponse();
      }
      const result = await readJson(response);
      assertNoCredentials(result, [oidcToken, authorization, authorization.slice(7)]);
      if (OPS_ACCESS_CODES[response.status] &&
          (Object.keys(result).length !== 2 || typeof result.error !== 'string' || !result.error.trim() ||
           result.error.length > 2000 || !OPS_ACCESS_CODES[response.status].has(result.code))) {
        throw problem(502, 'OPS_PROXY_DEPLOYMENT_ACCESS', '工作台與後端的部署連線未完成，請管理者檢查部署保護與連線設定。');
      }
      if (route === 'connections/canva/start' && response.ok) {
        let destination;
        try { destination = new URL(result.authorizationUrl); } catch { throw invalidResponse(); }
        if (destination.protocol !== 'https:' || !['www.canva.com', 'canva.com'].includes(destination.hostname) || destination.port || destination.username || destination.password || destination.hash || destination.pathname !== '/api/oauth/authorize') throw invalidResponse();
      }
      send(res, response.status, result);
    } catch (error) {
      const safe = error instanceof ProxyError ? error : problem(502, 'OPS_PROXY_UNAVAILABLE', '工作台代理暫時無法完成操作；請重新整理核對紀錄。');
      send(res, safe.status, { error: safe.message, code: safe.code }, safe.headers);
    }
  };
}
