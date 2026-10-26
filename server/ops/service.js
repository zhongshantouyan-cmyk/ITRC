'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { createOpsStore } = require('./store');
const { OpsError, assert } = require('./errors');
const { emails } = require('./auth');
const { assertActorActive } = require('./people');
const { executeAction, isAdvisor, find, touch, audit, relevantObligations, clearApproval, obsoleteJobs, eventMissingFacts, httpsUrl, cleanFields, capturePostRevision } = require('./domain');

const SYSTEM = {email:'system@itrc.local',name:'工作台排程',role:'advisor',canApprove:false,canDesign:false};
const safeError = error => {
  const messages = {
    CONFIGURATION_MISSING:'尚未完成服務連線設定。請到「系統連線」查看缺少的設定。',
    CONFIGURATION_INVALID:'服務連線設定格式不正確，請檢查伺服器設定。',
    CONFIGURATION_REQUIRED:'尚未完成服務連線，請由管理者到系統連線完成設定。',
    RECONNECT_REQUIRED:'服務授權已失效，請由管理者重新連線。',
    PROVIDER_BUSY:'服務連線正在更新，請稍後重試。',
    VALIDATION_ERROR:'輸入內容或模板欄位未通過檢查，請先修正資料。',
    PROVIDER_REJECTED:'外部服務拒絕這次請求，請檢查權限與設定後重試。',
    PROVIDER_UNAVAILABLE:'外部服務暫時無法使用。',
    INVALID_PROVIDER_RESPONSE:'外部服務回傳了無法驗證的結果。',
    UNCERTAIN_RESULT:'Canva 建立結果不明；請先核對是否已建立設計，再附上正確網址，避免重複建立。',
  };
  return messages[error?.code] || '工作未完成，請由系統管理者確認服務狀態；未記錄為成功。';
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
function parseSources(env) {
  if (!env.OPS_SHEET_SOURCES_JSON) return [];
  try {
    const sources = JSON.parse(env.OPS_SHEET_SOURCES_JSON);
    if (!Array.isArray(sources) || sources.length > 20) return [];
    return sources.filter(item => item && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) && /^[a-zA-Z0-9_-]{10,200}$/.test(item.spreadsheetId) && typeof item.range === 'string' && item.range.length < 200 && ['events','posts','tasks'].includes(item.kind) && item.columns && typeof item.columns === 'object');
  } catch { return []; }
}

function createOpsService({ db, store = createOpsStore(db), providers, env = process.env, now = () => new Date().toISOString() }) {
  const provider = () => providers || require('./providers');
  async function bootstrap(actor) {
    const state = await store.read();
    assertActorActive(state,actor);
    return {
      actor, ...state,
      events:state.events.map(event => ({...event,missingFacts:eventMissingFacts(event)})),
      settings:{
        mode:'live', integrations:provider().getIntegrationStatus(env),
        approverConfigured:emails(env.OPS_APPROVER_EMAILS).size > 0,
        designerConfigured:emails(env.OPS_DESIGNER_EMAILS).size > 0,
        workerEnabled:String(env.OPS_WORKER_ENABLED).toLowerCase() === 'true',
        githubSchedulerConfigured:env.VERCEL_ENV === 'production' && env.OPS_GITHUB_CRON_ENABLED !== 'false',
        autoRunJobs:String(env.OPS_AUTO_RUN_JOBS).toLowerCase() === 'true',
        sources:parseSources(env).map(({id,name,spreadsheetId,range,kind}) => ({id,name:name || id,url:`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,range,kind})),
      },
    };
  }
  async function change(reducer, actor = SYSTEM) {
    return store.mutate({actorEmail:actor.email,now:now(),authorize:state => actor !== SYSTEM && assertActorActive(state,actor)},state => reducer(state,now()));
  }
  async function sheetPreview(actor, payload) {
    assert(isAdvisor(actor),403,'ADVISOR_REQUIRED','讀取來源表需要社長或顧問執行。');
    const source = parseSources(env).find(item => item.id === payload.sourceId);
    assert(source,400,'SOURCE_NOT_ALLOWED','請選擇已在伺服器設定的來源表。');
    let output;
    try { output = await provider().readSheetSource({spreadsheetId:source.spreadsheetId,range:source.range},{env}); }
    catch (error) { throw new OpsError(error?.configMissing ? 409 : 502, error?.code || 'SOURCE_UNAVAILABLE',safeError(error)); }
    const values = Array.isArray(output) ? output : output.values;
    assert(Array.isArray(values) && values.length > 1 && values.length <= 201,400,'SOURCE_LIMIT','來源表需包含標題列與 1 到 200 筆資料。');
    const headers = values[0].map(String);
    for (const column of Object.values(source.columns)) assert(headers.includes(column),400,'SOURCE_COLUMNS','來源表的欄位與設定不一致。');
    const rows = values.slice(1).filter(row => row.some(value => String(value).trim())).map(row => {
      const mapped = Object.fromEntries(Object.entries(source.columns).map(([field,column]) => [field,String(row[headers.indexOf(column)] ?? '')]));
      mapped.sourceUrl = `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit`;
      mapped.sourceDate = now().slice(0,10);
      mapped.sourceRevision = output.fetchedAt || now();
      return mapped;
    });
    const staged = {events:[],posts:[],tasks:[],[source.kind]:rows};
    const state = await store.read();
    const preview = executeAction(state,{action:'import.preview',payload:staged},actor,now());
    return {...preview,staged};
  }
  async function action(actor, command) {
    assert(actor?.uid && actor?.email && ['chair','advisor','treasurer','officer'].includes(actor.role),401,'IDENTITY_REQUIRED','需要有效的登入身分。');
    assertActorActive(await store.read(),actor);
    assert(command && typeof command === 'object' && typeof command.action === 'string',400,'INVALID_ACTION','操作格式不正確。');
    assert(typeof command.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(command.idempotencyKey),400,'IDEMPOTENCY_REQUIRED','缺少操作識別碼，請重新整理再試。');
    assert(!command.id || (typeof command.id === 'string' && command.id.length <= 120),400,'INVALID_ID','記錄識別碼不正確。');
    const payload = command.payload || {};
    assert(payload && typeof payload === 'object' && !Array.isArray(payload),400,'INVALID_PAYLOAD','資料格式不正確。');
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical({action:command.action,id:command.id || '',expectedVersion:command.expectedVersion,payload}))).digest('hex');
    if (command.action === 'import.sheet-preview') return sheetPreview(actor,payload);
    if (command.action === 'jobs.run') {
      assert(isAdvisor(actor),403,'ADVISOR_REQUIRED','執行系統工作需要社長或顧問。');
      assert(Number.isInteger(payload.limit || 3) && (payload.limit || 3) >= 1 && (payload.limit || 3) <= 5,400,'JOB_LIMIT','每次可執行 1 到 5 項工作。');
      const run = await store.mutate({actorEmail:actor.email,idempotencyKey:command.idempotencyKey,fingerprint,now:now(),authorize:state => assertActorActive(state,actor)},state => ({
        ok:true,record:{jobIds:state.jobs.filter(job => ['queued','running'].includes(job.status)).sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(0,payload.limit || 3).map(job => job.id)},
      }));
      const jobs = [];
      for (const jobId of run.record.jobIds) jobs.push(...(await runJobs({limit:1,jobId,actor})).jobs);
      return {ok:true,record:{processed:jobs.length,jobs}};
    }
    const result = await store.mutate({actorEmail:actor.email,idempotencyKey:command.idempotencyKey,fingerprint,now:now(),authorize:state => assertActorActive(state,actor)},state => executeAction(state,command,actor,now()));
    if (command.action === 'post.generate' && result.record?.id) {
      await runJobs({limit:1,jobId:result.record.id,actor});
      const current = await store.read();
      return {...result,record:current.jobs.find(job => job.id === result.record.id) || result.record};
    }
    if (String(env.OPS_AUTO_RUN_JOBS).toLowerCase() === 'true' && ['post.approve','post.request-design','job.retry'].includes(command.action)) {
      const current = await store.read();
      const job = command.action === 'post.approve'
        ? current.jobs.find(job => job.postId === result.record.id && job.copyVersion === result.record.copyVersion && job.type === 'canva')
        : current.jobs.find(job => job.id === result.record.id);
      if (job) await runJobs({limit:1,jobId:job.id,actor});
    }
    return result;
  }
  async function claimJob(jobId, actor) {
    return change((state,stamp) => {
      const job = state.jobs.find(item => item.id === jobId);
      if (!job) return null;
      const post = state.posts.find(item => item.id === job.postId);
      if (!post || ['completed','published'].includes(post.stage) || post.copyVersion !== job.copyVersion || (job.type === 'canva' && post.approvedVersion !== post.copyVersion) || (job.type === 'copy' && !['brief','draft','needs_revision'].includes(post.stage))) {
        if (['queued','running'].includes(job.status)) { job.status = 'obsolete'; touch(job,stamp); }
        return null;
      }
      if (job.status === 'running' && job.leaseUntil && Date.parse(job.leaseUntil) > Date.parse(stamp)) return null;
      if (job.status === 'running' && !job.providerJobId) {
        job.status = job.type === 'canva' ? 'needs_reconciliation' : 'failed';
        job.lastError = job.type === 'canva' ? safeError({code:'UNCERTAIN_RESULT'}) : '前次草稿工作中斷，請重試。';
        touch(job,stamp); audit(state,actor,'job.interrupted',job,job.version - 1,stamp,job.lastError); return null;
      }
      if (!(job.status === 'queued' || (job.status === 'running' && job.providerJobId))) return null;
      const polling = Boolean(job.providerJobId);
      job.status = 'running'; job.claimToken = randomUUID(); job.leaseUntil = new Date(Date.parse(stamp) + 120000).toISOString();
      if (!polling) job.attempts += 1;
      touch(job,stamp);
      return {job:structuredClone(job),post:structuredClone(post),event:structuredClone(state.events.find(event => event.id === post.eventId)),obligations:structuredClone(relevantObligations(state,post)),polling};
    },actor);
  }
  async function finishJob(claim, result, error, actor) {
    return change((state,stamp) => {
      const job = find(state,'jobs',claim.job.id);
      if (job.claimToken !== claim.job.claimToken) return job;
      if (job.status !== 'running') {
        // A human may edit the copy or attach a design while the provider is in flight.
        // Keep the external job identity for reconciliation without overwriting that newer work.
        delete job.leaseUntil; delete job.claimToken;
        if (result?.providerJobId) job.providerJobId = result.providerJobId;
        if (job.type === 'canva' && result) job.externalResult = {
          providerJobId:result.providerJobId || job.providerJobId || '',
          status:result.status || '', canvaEditUrl:result.canvaEditUrl || '', canvaDesignId:result.canvaDesignId || '',
        };
        if (job.type === 'canva' && error && !claim.polling && (error.uncertain || !error.definite)) {
          job.needsReconciliation = true; job.lastError = safeError({code:'UNCERTAIN_RESULT'});
        }
        const prior = job.version; touch(job,stamp); audit(state,actor,'job.late-result',job,prior,stamp,'保留外部工作識別，不覆蓋後續人工修改。');
        return job;
      }
      const post = find(state,'posts',job.postId); const from = job.version;
      delete job.leaseUntil; delete job.claimToken;
      if (['completed','published'].includes(post.stage) || post.copyVersion !== job.copyVersion || (job.type === 'copy' && (post.version !== job.expectedPostVersion || !['brief','draft','needs_revision'].includes(post.stage))) || (job.type === 'canva' && post.approvedVersion !== post.copyVersion)) {
        job.status = 'obsolete'; job.lastError = '工作執行期間內容已修改，保留結果供核對，不套用舊版。';
        if (result?.providerJobId) job.providerJobId = result.providerJobId;
        if (result?.canvaEditUrl) job.result = {canvaEditUrl:result.canvaEditUrl,canvaDesignId:result.canvaDesignId || ''};
      } else if (error) {
        const configured = error.configMissing || ['CONFIGURATION_MISSING','CONFIGURATION_INVALID'].includes(error.code);
        job.status = configured ? 'blocked_configuration' : (job.type === 'canva' && !claim.polling && (error.uncertain || !error.definite) ? 'needs_reconciliation' : 'failed');
        job.lastError = safeError(job.status === 'needs_reconciliation' ? {code:'UNCERTAIN_RESULT'} : error);
        job.errorCode = job.status === 'needs_reconciliation' ? 'UNCERTAIN_RESULT' : (error.code || 'PROVIDER_FAILURE');
      } else if (job.type === 'copy') {
        // Validate provider output before touching a user record.
        const output = cleanFields('posts',{caption:result.caption,slides:result.slides});
        assert(output.caption && output.slides.length,502,'INVALID_PROVIDER_RESPONSE','產生結果沒有完整文案。');
        capturePostRevision(state,post,actor,stamp,'post.before-generated-copy');
        clearApproval(post); obsoleteJobs(state,post,stamp);
        post.caption = output.caption; post.slides = output.slides; post.copyVersion += 1; post.stage = 'draft'; post.sourceEventVersion = claim.event.version;
        post.generationMethod = String(result.generationMethod || 'provider'); touch(post,stamp);
        capturePostRevision(state,post,actor,stamp,'post.generated-copy');
        job.status = 'succeeded'; job.result = {postId:post.id,copyVersion:post.copyVersion,generationMethod:post.generationMethod}; job.lastError = '';
      } else if (['success','succeeded'].includes(result.status) && result.canvaEditUrl) {
        httpsUrl(result.canvaEditUrl,'Canva 編輯網址',{canva:true,optional:false});
        post.canvaEditUrl = result.canvaEditUrl; post.canvaDesignId = result.canvaDesignId || ''; post.designCopyVersion = job.copyVersion; post.stage = 'approved'; touch(post,stamp);
        capturePostRevision(state,post,actor,stamp,'post.generated-design');
        job.status = 'succeeded'; job.result = {canvaEditUrl:post.canvaEditUrl,canvaDesignId:post.canvaDesignId}; job.lastError = '';
      } else if (['failed','failure'].includes(result.status)) {
        job.status = 'failed'; job.errorCode = 'PROVIDER_JOB_FAILED'; job.lastError = 'Canva 已回報設計產生失敗，請檢查模板後重試。';
      } else {
        assert(result.providerJobId || job.providerJobId,502,'INVALID_PROVIDER_RESPONSE','Canva 未提供工作識別碼。');
        job.status = 'running'; job.providerJobId = result.providerJobId || job.providerJobId; job.lastError = '';
      }
      touch(job,stamp); audit(state,actor,`job.${job.status}`,job,from,stamp,job.lastError || `${job.type} 工作：${job.status}`);
      return job;
    },actor);
  }
  async function runJobs({limit = 3,jobId,actor = SYSTEM} = {}) {
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 5,400,'JOB_LIMIT','每次可執行 1 到 5 項工作。');
    const state = await store.read();
    const ids = state.jobs.filter(job => (!jobId || job.id === jobId) && ['queued','running'].includes(job.status)).sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(0,limit).map(job => job.id);
    const results = [];
    for (const id of ids) {
      const claim = await claimJob(id,actor);
      if (!claim) continue;
      try {
        const result = claim.job.type === 'copy'
          ? await provider().generateCopy({post:claim.post,event:claim.event,obligations:claim.obligations},{env})
          : claim.polling
            ? await provider().getCanvaJob(claim.job.providerJobId,{env})
            : await provider().createCanvaDesign({post:claim.post,event:claim.event,obligations:claim.obligations},{env});
        results.push(await finishJob(claim,result,null,actor));
      } catch (error) {
        // Never leak response bodies, access tokens or credential values to stored job errors.
        results.push(await finishJob(claim,null,error,actor));
      }
    }
    return {processed:results.length,jobs:results};
  }
  return {bootstrap,action,runJobs,store,ready:store.ready};
}

module.exports = { createOpsService, safeError, parseSources };
