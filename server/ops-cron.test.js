'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const express = require('express');
const { createOpsCronRouter } = require('./ops-cron');

async function fixture(t, { secret = randomBytes(32).toString('hex'), runJobs = async () => ({processed:0,jobs:[]}) } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/ops/jobs', createOpsCronRouter({runJobs}, {env:{OPS_CRON_SECRET:secret}}));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {url:`http://127.0.0.1:${server.address().port}/api/ops/jobs/tick`,secret};
}

test('cron fails closed when its secret is absent, weak, or malformed',async t => {
  for (const secret of [undefined,'short',' '.repeat(40),'x'.repeat(513)]) {
    let calls=0;
    // Explicit undefined bypasses fixture default by using an empty value for the missing case.
    const f=await fixture(t,{secret:secret || '',runJobs:async () => {calls++;return {processed:0};}});
    const response=await fetch(f.url,{headers:{Authorization:`Bearer ${'x'.repeat(64)}`}});
    assert.equal(response.status,503); assert.equal((await response.json()).code,'CRON_NOT_CONFIGURED'); assert.equal(calls,0);
  }
});

test('cron rejects missing, malformed and incorrect credentials without running jobs',async t => {
  let calls=0;
  const f=await fixture(t,{runJobs:async () => {calls++;return {processed:0};}});
  for (const authorization of ['',`Basic ${f.secret}`,`Bearer wrong-token`,`Bearer ${f.secret} extra`,`Bearer ${f.secret.slice(0,-1)}x`]) {
    const response=await fetch(f.url,{headers:authorization ? {Authorization:authorization} : {}});
    assert.equal(response.status,401); assert.equal((await response.json()).code,'CRON_UNAUTHORIZED');
  }
  assert.equal(calls,0);
});

test('authenticated GET and POST process at most the fixed service batch and do not forward caller controls',async t => {
  const calls=[];
  const f=await fixture(t,{runJobs:async options => {calls.push(options);return {processed:3,jobs:[{privateRecord:'not in response',secret:'not in response'}]};}});
  const get=await fetch(`${f.url}?limit=999&actor=advisor`,{headers:{Authorization:`Bearer ${f.secret}`}});
  assert.equal(get.status,200); assert.equal(get.headers.get('cache-control'),'no-store'); assert.deepEqual(await get.json(),{ok:true,processed:3});
  const post=await fetch(f.url,{method:'POST',headers:{Authorization:`Bearer ${f.secret}`,'Content-Type':'application/json'},body:JSON.stringify({limit:999,actor:{email:'forged@example.com',canApprove:true},action:'post.approve',jobId:'arbitrary'})});
  assert.equal(post.status,200); assert.deepEqual(await post.json(),{ok:true,processed:3});
  assert.deepEqual(calls,[{limit:3},{limit:3}]);
});

test('cron does not expose upstream errors, credentials, or provider response bodies',async t => {
  const marker='PRIVATE_PROVIDER_BODY_DO_NOT_EXPOSE';
  const f=await fixture(t,{runJobs:async () => {throw Error(marker);}});
  const response=await fetch(f.url,{headers:{Authorization:`Bearer ${f.secret}`}});
  assert.equal(response.status,503); const text=await response.text(); assert.ok(!text.includes(marker)); assert.ok(!text.includes(f.secret)); assert.equal(JSON.parse(text).code,'CRON_UNAVAILABLE');
});

test('cron rejects unsupported methods without processing work',async t => {
  let calls=0;
  const f=await fixture(t,{runJobs:async () => {calls++;return {processed:0};}});
  for (const method of ['DELETE','HEAD','PUT']) {
    const response=await fetch(f.url,{method,headers:{Authorization:`Bearer ${f.secret}`}});
    assert.equal(response.status,405); assert.equal(response.headers.get('allow'),'GET, POST');
  }
  assert.equal(calls,0);
});
