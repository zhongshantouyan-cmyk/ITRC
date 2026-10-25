'use strict';

// Server-owned Canva connection. Credentials never leave this module in HTTP responses.
const crypto = require('node:crypto');
const express = require('express');
const { createOpsAuth } = require('./ops/auth');
const { OpsError } = require('./ops/errors');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const privileged = actor => ['advisor', 'chair'].includes(actor?.role);

function encryptionKey(env) {
  const text = String(env.OPS_TOKEN_ENCRYPTION_KEY || '');
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32 || key.toString('base64') !== text) {
    throw new OpsError(503, 'CONFIGURATION_REQUIRED', '請在後端設定 32 位元組的 OPS_TOKEN_ENCRYPTION_KEY。');
  }
  return key;
}

function seal(value, env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(Buffer.from('itrc-canva-connection-v1'));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64')).join('.');
}

function unseal(text, env) {
  try {
    const parts = typeof text === 'string' ? text.split('.') : [];
    if (parts.length !== 3 || parts.some(part => Buffer.from(part, 'base64').toString('base64') !== part)) throw new Error();
    const [iv, tag, body] = parts.map(part => Buffer.from(part, 'base64'));
    if (iv.length !== 12 || tag.length !== 16 || !body.length) throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(env), iv);
    decipher.setAAD(Buffer.from('itrc-canva-connection-v1'));
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
  } catch {
    throw new OpsError(503, 'RECONNECT_REQUIRED', '無法解密 Canva 連線，請檢查加密金鑰或重新連接。');
  }
}

function usableTokens(tokens) {
  if (!tokens || typeof tokens !== 'object' ||
      typeof tokens.accessToken !== 'string' || !tokens.accessToken || tokens.accessToken.length > 8192 ||
      typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || tokens.refreshToken.length > 8192 ||
      /[\r\n]/.test(tokens.accessToken + tokens.refreshToken) ||
      typeof tokens.expiresAt !== 'string' || !Number.isFinite(Date.parse(tokens.expiresAt))) {
    throw new OpsError(503, 'RECONNECT_REQUIRED', 'Canva 保存的授權資料不完整，請重新連接。');
  }
  return tokens;
}

function staticAccessToken(env, now) {
  if (typeof env.CANVA_ACCESS_TOKEN !== 'string' || !env.CANVA_ACCESS_TOKEN.trim()) return null;
  const token = env.CANVA_ACCESS_TOKEN.trim();
  if (token.length > 8192 || /[\r\n]/.test(token) ||
      (env.CANVA_ACCESS_TOKEN_EXPIRES_AT && !(Date.parse(env.CANVA_ACCESS_TOKEN_EXPIRES_AT) > now() + 30000))) {
    throw new OpsError(503, 'CONFIGURATION_REQUIRED', 'Canva 暫用權杖無效或已過期，請重新連線。');
  }
  return token;
}

function frontendUrl(env) {
  try {
    const url = new URL(env.OPS_FRONTEND_ORIGIN);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    return `${url.origin}/ops`;
  } catch { return null; }
}

function createCanvaConnection({ db, env = process.env, oauth = require('./ops/canva-oauth'), now = () => Date.now() }) {
  const ready = db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS ops_credentials (
      provider TEXT PRIMARY KEY, sealed TEXT NOT NULL, status TEXT NOT NULL,
      owner TEXT, lease_until INTEGER, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_oauth_states (
      state_hash TEXT PRIMARY KEY, actor_email TEXT NOT NULL, sealed TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_connection_audit (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_email TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_connection_intent (
      provider TEXT PRIMARY KEY, state_hash TEXT NOT NULL
    );
  `);
  let tail = Promise.resolve();
  function exclusive(fn) {
    const result = tail.then(fn, fn);
    tail = result.catch(() => {});
    return result;
  }
  async function transaction(fn) {
    await ready;
    return exclusive(async () => {
      const tx = await db.transaction('write');
      try {
        const result = await fn(tx);
        await tx.commit();
        return result;
      } catch (error) {
        if (!tx.closed) await tx.rollback();
        throw error;
      } finally { tx.close(); }
    });
  }
  async function audit(tx, action, actorEmail) {
    await tx.execute({sql:'INSERT INTO ops_connection_audit VALUES(?,?,?,?)',args:[crypto.randomUUID(),action,actorEmail,new Date(now()).toISOString()]});
  }
  function requireConfiguration() {
    const config = oauth.getOAuthConfiguration(env);
    if (!config.configured) throw new OpsError(503, 'CONFIGURATION_REQUIRED', config.missing.length ? `Canva 連線尚缺：${config.missing.join('、')}` : 'Canva OAuth 設定格式不正確，請檢查回呼網址。');
    encryptionKey(env);
  }
  async function getStatus() {
    await ready;
    const config = oauth.getOAuthConfiguration(env);
    const missing = [...(config.missing || [])];
    try { encryptionKey(env); } catch { missing.push('OPS_TOKEN_ENCRYPTION_KEY'); }
    const result = await db.execute("SELECT sealed,status,lease_until,updated_at FROM ops_credentials WHERE provider='canva'");
    const saved = result.rows[0];
    let savedStatus = saved?.status || 'not_connected';
    if (saved) {
      try { usableTokens(unseal(saved.sealed, env)); }
      catch { savedStatus = 'needs_reconnect'; }
      if (savedStatus === 'refreshing' && !(Number(saved.lease_until) > now())) savedStatus = 'needs_reconnect';
      if (!['active', 'refreshing', 'needs_reconnect'].includes(savedStatus)) savedStatus = 'needs_reconnect';
    }
    let staticTokenConfigured = false;
    try { staticTokenConfigured = Boolean(staticAccessToken(env, now)); } catch { /* Status must not claim an expired token is usable. */ }
    const recent = await db.execute('SELECT action,actor_email AS actorEmail,created_at AS createdAt FROM ops_connection_audit ORDER BY created_at DESC LIMIT 10');
    return {
      configured: config.configured && missing.length === 0, missing, connected: savedStatus === 'active' && config.configured && missing.length === 0,
      status: missing.length ? 'blocked_configuration' : !config.configured ? 'configuration_invalid' : savedStatus,
      updatedAt: saved?.updated_at || null, scopes: config.scopes || [],
      staticTokenConfigured, audit: recent.rows,
    };
  }
  async function start(actor) {
    if (!privileged(actor)) throw new OpsError(403, 'ROLE_REQUIRED', '僅社長或顧問可設定共用 Canva 連線。');
    requireConfiguration();
    const request = oauth.createAuthorizationRequest({env,now});
    const expiresAt = new Date(request.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new OpsError(503, 'INVALID_CONFIGURATION', 'Canva 授權期限無效。');
    await transaction(async tx => {
      // Only the newest connection attempt is usable, preventing a stale callback replacing it.
      await tx.execute('DELETE FROM ops_oauth_states');
      await tx.execute({sql:'INSERT INTO ops_oauth_states VALUES(?,?,?,?)',args:[digest(request.state),actor.email,seal({state:request.state,codeVerifier:request.codeVerifier},env),expiresAt]});
      await tx.execute({sql:"INSERT INTO ops_connection_intent VALUES('canva',?) ON CONFLICT(provider) DO UPDATE SET state_hash=excluded.state_hash",args:[digest(request.state)]});
      await audit(tx,'canva.connection-started',actor.email);
    });
    return {authorizationUrl:request.authorizationUrl,expiresAt:request.expiresAt};
  }
  async function complete({state,code,error}) {
    requireConfiguration();
    if (typeof state !== 'string' || state.length < 16 || state.length > 512) throw new OpsError(400,'INVALID_STATE','授權狀態無效，請從工作台重新連接。');
    const saved = await transaction(async tx => {
      const result = await tx.execute({sql:'SELECT * FROM ops_oauth_states WHERE state_hash=?',args:[digest(state)]});
      const row = result.rows[0];
      if (!row || Number(row.expires_at) <= now()) throw new OpsError(400,'INVALID_STATE','授權已過期或已使用，請從工作台重新連接。');
      await tx.execute({sql:'DELETE FROM ops_oauth_states WHERE state_hash=?',args:[digest(state)]});
      return row;
    });
    if (error) throw new OpsError(400,'AUTHORIZATION_DECLINED','Canva 授權未完成，可回工作台重新連接。');
    if (typeof code !== 'string' || !code || code.length > 2048) throw new OpsError(400,'INVALID_CODE','缺少 Canva 授權碼，請重新連接。');
    const pending = unseal(saved.sealed, env);
    let tokens;
    try {
      tokens = usableTokens(await oauth.exchangeAuthorizationCode({code,codeVerifier:pending.codeVerifier,expectedState:pending.state,receivedState:state},{env,now}));
    } catch {
      throw new OpsError(502,'RECONNECT_REQUIRED','Canva 授權交換未完成，請重新連接；授權碼不會自動重送。');
    }
    await transaction(async tx => {
      const intent = await tx.execute("SELECT state_hash FROM ops_connection_intent WHERE provider='canva'");
      if (intent.rows[0]?.state_hash !== digest(state)) throw new OpsError(409,'CONNECTION_CHANGED','已有更新的連線操作，請完成最新一次授權。');
      await tx.execute({sql:"INSERT INTO ops_credentials VALUES('canva',?,'active',NULL,NULL,?) ON CONFLICT(provider) DO UPDATE SET sealed=excluded.sealed,status='active',owner=NULL,lease_until=NULL,updated_at=excluded.updated_at",args:[seal(tokens,env),new Date(now()).toISOString()]});
      await audit(tx,'canva.connected',saved.actor_email);
    });
    return {connected:true};
  }
  async function getAccessToken() {
    // A configured persisted OAuth connection takes precedence over an optional static test token.
    await ready;
    const existing = await db.execute("SELECT status FROM ops_credentials WHERE provider='canva'");
    if (!existing.rows.length) {
      const token = staticAccessToken(env, now);
      if (token) return token;
    }
    requireConfiguration();
    const owner = crypto.randomUUID();
    const decision = await transaction(async tx => {
      const result = await tx.execute("SELECT * FROM ops_credentials WHERE provider='canva'");
      const saved = result.rows[0];
      if (!saved) throw new OpsError(503,'CONFIGURATION_REQUIRED','請先在系統連線頁連接 Canva。');
      if (saved.status === 'needs_reconnect') throw new OpsError(503,'RECONNECT_REQUIRED','Canva 連線需要重新授權。');
      if (saved.status === 'refreshing') {
        if (Number(saved.lease_until) > now()) throw new OpsError(503,'PROVIDER_BUSY','Canva 連線正在更新，請稍後重試。');
        await tx.execute("UPDATE ops_credentials SET status='needs_reconnect',owner=NULL,lease_until=NULL WHERE provider='canva'");
        await audit(tx,'canva.refresh-uncertain','system');
        return {uncertain:true};
      }
      if (saved.status !== 'active') throw new OpsError(503,'RECONNECT_REQUIRED','Canva 連線狀態無效，請重新授權。');
      const tokens = usableTokens(unseal(saved.sealed,env));
      if (new Date(tokens.expiresAt).getTime() > now() + 120000) return {accessToken:tokens.accessToken};
      await tx.execute({sql:"UPDATE ops_credentials SET status='refreshing',owner=?,lease_until=? WHERE provider='canva'",args:[owner,now()+60000]});
      return {refreshToken:tokens.refreshToken};
    });
    if (decision.uncertain) throw new OpsError(503,'UNCERTAIN_RESULT','前次 Canva 續期結果不明，請重新連接以避免重送一次性權杖。');
    if (decision.accessToken) return decision.accessToken;
    let renewed;
    try {
      renewed = usableTokens(await oauth.refreshCanvaToken({refreshToken:decision.refreshToken},{env,now}));
    } catch {
      await transaction(async tx => {
        await tx.execute({sql:"UPDATE ops_credentials SET status='needs_reconnect',owner=NULL,lease_until=NULL WHERE provider='canva' AND owner=?",args:[owner]});
        await audit(tx,'canva.refresh-uncertain','system');
      });
      throw new OpsError(503,'UNCERTAIN_RESULT','Canva 續期未確認成功，請重新連接；系統不會重送一次性權杖。');
    }
    await transaction(async tx => {
      const updated = await tx.execute({sql:"UPDATE ops_credentials SET sealed=?,status='active',owner=NULL,lease_until=NULL,updated_at=? WHERE provider='canva' AND owner=?",args:[seal(renewed,env),new Date(now()).toISOString(),owner]});
      if (updated.rowsAffected !== 1) throw new OpsError(409,'CONNECTION_CHANGED','Canva 連線已變更，請重新整理後再試。');
      await audit(tx,'canva.refreshed','system');
    });
    return renewed.accessToken;
  }
  return {ready,getStatus,start,complete,getAccessToken};
}

function createConnectionRouter({ manager, env = process.env, firebase }) {
  const router = express.Router();
  const auth = createOpsAuth({firebase,env});
  const handle = handler => async (req,res) => {
    try { await handler(req,res); }
    catch (error) {
      res.status(error instanceof OpsError ? error.status : 502).json({
        code:error instanceof OpsError ? error.code : 'CONNECTION_FAILED',
        error:error instanceof OpsError ? error.message : '連線操作未完成，請稍後重試。',
      });
    }
  };
  router.use((_req,res,next) => {res.set('Cache-Control','no-store');next();});
  router.get('/',auth,handle(async (_req,res) => res.json(await manager.getStatus())));
  router.post('/start',auth,handle(async (req,res) => res.json(await manager.start(req.opsActor))));
  // Callback relies on one-use encrypted PKCE state; browsers do not send Firebase headers here.
  router.get('/callback',handle(async (req,res) => {
    await manager.complete({state:req.query.state,code:req.query.code,error:req.query.error});
    const back = frontendUrl(env);
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.set('Referrer-Policy','no-referrer');
    res.type('html').send(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canva 已連接</title><body style="font-family:system-ui;padding:3rem;max-width:36rem;margin:auto"><h1>Canva 已連接</h1><p>連線已安全保存。完成核准的工作可以從工作台進入套版佇列。</p>${back ? `<a href="${back}">返回營運工作台</a>` : '<p>請回到原本的營運工作台分頁。</p>'}</body></html>`);
  }));
  return router;
}

function withCanvaConnection(providers,manager) {
  const getCanvaAccessToken = async () => {
    try { return await manager.getAccessToken(); }
    catch (error) {
      // No design request has been sent. Token rotation uncertainty requires a
      // new connection, not reconciliation of a possibly-created design.
      const codes = {
        CONFIGURATION_REQUIRED: ['CONFIGURATION_REQUIRED', '請先完成 Canva 連線設定。', true],
        CONFIGURATION_MISSING: ['CONFIGURATION_MISSING', '請先完成 Canva 連線設定。', true],
        CONFIGURATION_INVALID: ['CONFIGURATION_INVALID', 'Canva 連線設定不正確。', true],
        INVALID_CONFIGURATION: ['CONFIGURATION_INVALID', 'Canva 連線設定不正確。', true],
        RECONNECT_REQUIRED: ['RECONNECT_REQUIRED', 'Canva 授權已失效，請重新連線。', true],
        UNCERTAIN_RESULT: ['RECONNECT_REQUIRED', 'Canva 授權更新未完成，請重新連線。', true],
        PROVIDER_BUSY: ['PROVIDER_BUSY', 'Canva 連線正在更新，請稍後重試。', false],
        CONNECTION_CHANGED: ['PROVIDER_BUSY', 'Canva 連線已更新，請稍後重試。', false],
      };
      const [code, message, configMissing] = codes[error?.code] ||
        ['PROVIDER_UNAVAILABLE', 'Canva 連線暫時無法使用，請稍後重試。', false];
      const wrapped = new OpsError(503, code, message);
      wrapped.definite = true;
      wrapped.uncertain = false;
      wrapped.configMissing = configMissing;
      throw wrapped;
    }
  };
  return {
    ...providers,
    createCanvaDesign:(input,options={}) => providers.createCanvaDesign(input,{...options,getCanvaAccessToken}),
    getCanvaJob:(id,options={}) => providers.getCanvaJob(id,{...options,getCanvaAccessToken}),
  };
}

module.exports = {createCanvaConnection,createConnectionRouter,withCanvaConnection};
