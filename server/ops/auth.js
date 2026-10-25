'use strict';

const { OpsError } = require('./errors');
const AUTHORIZED_ROLES = new Set(['chair', 'advisor', 'treasurer', 'officer']);
const emails = value => new Set(String(value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean));

function actorFromIdentity(identity, role, env = process.env) {
  if (!identity || !identity.uid || !identity.email || identity.email_verified !== true) {
    throw new OpsError(401, 'IDENTITY_REQUIRED', '請使用已驗證的 Google 帳號重新登入。');
  }
  if (!AUTHORIZED_ROLES.has(role)) throw new OpsError(403, 'ROLE_REQUIRED', '此帳號尚未被授權使用社團工作台。');
  const email = identity.email.trim().toLowerCase();
  return {
    uid: identity.uid, email, name: identity.name || email, role,
    canApprove: emails(env.OPS_APPROVER_EMAILS).has(email),
    canDesign: emails(env.OPS_DESIGNER_EMAILS).has(email),
  };
}

function createOpsAuth({ firebase = require('../firebase'), env = process.env } = {}) {
  return async function opsAuth(req, res, next) {
    try {
      const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '');
      if (!match) throw new OpsError(401, 'IDENTITY_REQUIRED', '請使用 Google 帳號登入社團工作台。');
      // Deliberately no legacy JWT fallback. Roles and capabilities never come from the request body.
      let identity;
      try { identity = await firebase.verifyFirebaseToken(match[1]); }
      catch { throw new OpsError(401, 'INVALID_IDENTITY', '登入憑證無效或已過期，請重新登入。'); }
      req.opsActor = actorFromIdentity(identity, await firebase.resolveRole(identity.email || ''), env);
      next();
    } catch (error) {
      res.status(error instanceof OpsError ? error.status : 401).json({
        error: error instanceof OpsError ? error.message : '無法驗證登入身分。',
        code: error instanceof OpsError ? error.code : 'INVALID_IDENTITY',
      });
    }
  };
}

module.exports = { createOpsAuth, actorFromIdentity, emails };
