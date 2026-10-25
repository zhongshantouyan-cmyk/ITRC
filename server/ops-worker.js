'use strict';

// Optional on an always-running Node host. Serverless hosts use authenticated jobs.run.
function startOpsWorker(service,{env=process.env,onError=() => console.error('[ops] 工作佇列處理失敗，請查看工作台狀態。')}={}) {
  if (String(env.OPS_WORKER_ENABLED || '').toLowerCase() !== 'true') return () => {};
  const seconds = Math.max(30,Math.min(3600,Number(env.OPS_WORKER_INTERVAL_SECONDS) || 60));
  let busy=false;
  let stopped=false;
  const tick=async () => {
    if (busy || stopped) return;
    busy=true;
    try { await service.runJobs({limit:3}); }
    catch { onError(); }
    finally { busy=false; }
  };
  const timer=setInterval(tick,seconds*1000);
  timer.unref();
  void tick();
  return () => {stopped=true;clearInterval(timer);};
}

module.exports={startOpsWorker};
