'use strict';

const express = require('express');
const { createOpsAuth } = require('./auth');
const { createOpsService } = require('./service');
const { OpsError } = require('./errors');

function createOpsRouter({db = require('../db'),firebase,providers,env = process.env,now} = {}) {
  const router = express.Router();
  const service = createOpsService({db,providers,env,now});
  router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  router.use(createOpsAuth({firebase,env}));
  router.get('/bootstrap',async (req,res,next) => {
    try { res.json(await service.bootstrap(req.opsActor)); } catch (error) { next(error); }
  });
  router.post('/actions',express.json({limit:'256kb'}),async (req,res,next) => {
    try { res.json(await service.action(req.opsActor,req.body)); } catch (error) { next(error); }
  });
  router.use((error,req,res,next) => {
    if (res.headersSent) return next(error);
    if (error instanceof OpsError) return res.status(error.status).json({error:error.message,code:error.code});
    if (error.type === 'entity.too.large') return res.status(413).json({error:'一次傳入的資料過大，請分批匯入。',code:'PAYLOAD_TOO_LARGE'});
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({error:'JSON 格式不正確。',code:'INVALID_JSON'});
    // Intentionally no raw database/provider errors in responses or logs.
    res.status(500).json({error:'工作台暫時無法完成操作，請稍後重新整理；尚未確認成功。',code:'OPS_UNAVAILABLE'});
  });
  router.service = service;
  return router;
}

module.exports = {createOpsRouter,createOpsService};
