'use strict';

const express = require('express');
const { createHash, timingSafeEqual } = require('node:crypto');

const digest = value => createHash('sha256').update(value, 'utf8').digest();
const { createGitHubCronVerifier } = require('./github-cron-auth');

/**
 * A narrowly scoped scheduler endpoint. It processes already-authorized jobs only.
 * It cannot create records, approve copy, select a principal, or change job limits.
 */
function createOpsCronRouter(service, { env = process.env, verifyGitHub = createGitHubCronVerifier() } = {}) {
  if (!service || typeof service.runJobs !== 'function') throw new TypeError('An operations job service is required.');
  const router = express.Router();

  router.use('/tick', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const secret = env.OPS_CRON_SECRET;
    const hasSecret = typeof secret === 'string' && secret.length >= 32 && secret.length <= 512 && !/\s/.test(secret);
    const githubEnabled = env.VERCEL_ENV === 'production' && env.OPS_GITHUB_CRON_ENABLED !== 'false';
    if (!hasSecret && !githubEnabled) {
      return res.status(503).json({ ok:false, code:'CRON_NOT_CONFIGURED', error:'排程連線尚未完成設定。' });
    }
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    const submitted = match ? match[1] : '';
    let authorized = !!match && hasSecret && timingSafeEqual(digest(secret), digest(submitted));
    if (!authorized && match && githubEnabled) {
      try { await verifyGitHub(submitted); authorized = true; } catch { /* Never echo tokens or provider responses. */ }
    }
    if (!authorized) {
      return res.status(401).json({ ok:false, code:'CRON_UNAUTHORIZED', error:'排程驗證失敗。' });
    }
    if (!['GET','POST'].includes(req.method)) {
      return res.set('Allow', 'GET, POST').status(405).json({ ok:false, code:'METHOD_NOT_ALLOWED', error:'僅接受 GET 或 POST。' });
    }
    next();
  });

  const tick = async (req, res) => {
    try {
      // Query/body arguments and user identity are intentionally not forwarded.
      const result = await service.runJobs({ limit:3 });
      const processed = Number.isInteger(result?.processed) && result.processed >= 0 ? result.processed : 0;
      res.json({ ok:true, processed });
    } catch {
      // Provider responses and credentials never appear in scheduler responses.
      res.status(503).json({ ok:false, code:'CRON_UNAVAILABLE', error:'排程暫時無法完成，請查看工作台紀錄。' });
    }
  };
  router.get('/tick', tick);
  router.post('/tick', tick);
  return router;
}

module.exports = { createOpsCronRouter };
