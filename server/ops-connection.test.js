'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {createClient} = require('@libsql/client');
const {createCanvaConnection,createConnectionRouter,withCanvaConnection} = require('./ops-connection');

const adviser={uid:'adviser-id',email:'adviser@example.test',role:'advisor'};
async function fixture(t,overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'itrc-oauth-'));
  const db=createClient({url:`file:${path.join(dir,'ops.db')}`});
  const env={OPS_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64')};
  let time=Date.parse('2026-10-25T04:00:00Z');
  const now=() => time;
  let exchanges=0;
  let refreshes=0;
  const oauth={
    getOAuthConfiguration:() => ({configured:true,missing:[],scopes:['design:content:write']}),
    createAuthorizationRequest:() => {
      const state=crypto.randomBytes(32).toString('base64url');
      return {state,codeVerifier:'server-only-verifier',authorizationUrl:`https://www.canva.com/api/oauth/authorize?state=${state}`,expiresAt:new Date(time+600000).toISOString()};
    },
    exchangeAuthorizationCode:async input => {
      exchanges++;
      assert.equal(input.codeVerifier,'server-only-verifier');
      assert.equal(input.expectedState,input.receivedState);
      return {accessToken:'access-original-private',refreshToken:'refresh-original-private',expiresAt:new Date(time+3600000).toISOString()};
    },
    refreshCanvaToken:async ({refreshToken}) => {
      refreshes++;
      assert.equal(refreshToken,'refresh-original-private');
      return {accessToken:'access-rotated-private',refreshToken:'refresh-rotated-private',expiresAt:new Date(time+3600000).toISOString()};
    },
    ...overrides,
  };
  const manager=createCanvaConnection({db,env,oauth,now});
  await manager.ready;
  t.after(async () => {db.close();fs.rmSync(dir,{recursive:true,force:true});});
  async function connect() {
    const result=await manager.start(adviser);
    const state=new URL(result.authorizationUrl).searchParams.get('state');
    await manager.complete({state,code:'one-use-code'});
    return state;
  }
  return {db,env,oauth,now,manager,connect,advance:ms => {time+=ms;},counts:() => ({exchanges,refreshes})};
}

test('PKCE state and tokens are encrypted; callback is one use; restart preserves access',async t => {
  const f=await fixture(t);
  const started=await f.manager.start(adviser);
  const state=new URL(started.authorizationUrl).searchParams.get('state');
  const pending=(await f.db.execute('SELECT * FROM ops_oauth_states')).rows[0];
  assert.equal(JSON.stringify(pending).includes('server-only-verifier'),false);
  assert.equal(JSON.stringify(pending).includes(state),false);
  await assert.rejects(f.manager.complete({state:'x'.repeat(43),code:'bad'}),error => error.code==='INVALID_STATE');
  await f.manager.complete({state,code:'one-use-code'});
  await assert.rejects(f.manager.complete({state,code:'one-use-code'}),error => error.code==='INVALID_STATE');
  const saved=(await f.db.execute('SELECT * FROM ops_credentials')).rows[0];
  assert.equal(JSON.stringify(saved).includes('access-original-private'),false);
  assert.equal(JSON.stringify(saved).includes('refresh-original-private'),false);
  const reopened=createCanvaConnection({db:f.db,env:f.env,oauth:f.oauth,now:f.now});
  assert.equal(await reopened.getAccessToken(),'access-original-private');
  const status=await reopened.getStatus();
  assert.equal(status.connected,true);
  assert.equal(JSON.stringify(status).includes('private'),false);
  assert.equal(f.counts().exchanges,1);
});

test('unprivileged actor cannot connect; expired or superseded state cannot authorize',async t => {
  const f=await fixture(t);
  await assert.rejects(f.manager.start({...adviser,role:'officer'}),error => error.status===403);
  const a=await f.manager.start(adviser);
  const b=await f.manager.start(adviser);
  await assert.rejects(f.manager.complete({state:new URL(a.authorizationUrl).searchParams.get('state'),code:'code'}),error => error.code==='INVALID_STATE');
  f.advance(600001);
  await assert.rejects(f.manager.complete({state:new URL(b.authorizationUrl).searchParams.get('state'),code:'code'}),error => error.code==='INVALID_STATE');
  assert.equal(f.counts().exchanges,0);
});

test('single-use refresh is serialized across manager instances and stored before access',async t => {
  let release;
  let entered;
  const started=new Promise(resolve => {entered=resolve;});
  const gate=new Promise(resolve => {release=resolve;});
  let calls=0;
  const f=await fixture(t,{refreshCanvaToken:async () => {
    calls++;
    entered();
    await gate;
    return {accessToken:'new-access',refreshToken:'new-refresh',expiresAt:new Date(f.now()+3600000).toISOString()};
  }});
  await f.connect();
  f.advance(3600000);
  const second=createCanvaConnection({db:f.db,env:f.env,oauth:f.oauth,now:f.now});
  await second.ready;
  const request=f.manager.getAccessToken();
  await started;
  await assert.rejects(second.getAccessToken(),error => error.code==='PROVIDER_BUSY');
  release();
  assert.equal(await request,'new-access');
  assert.equal(await second.getAccessToken(),'new-access');
  assert.equal(calls,1);
});

test('uncertain refresh cannot retry a consumed token; reconnect is required',async t => {
  let calls=0;
  const f=await fixture(t,{refreshCanvaToken:async () => {calls++;throw new Error('private provider response');}});
  await f.connect();
  f.advance(3600000);
  await assert.rejects(f.manager.getAccessToken(),error => error.code==='UNCERTAIN_RESULT' && !error.message.includes('private'));
  await assert.rejects(f.manager.getAccessToken(),error => error.code==='RECONNECT_REQUIRED');
  assert.equal((await f.manager.getStatus()).status,'needs_reconnect');
  assert.equal(calls,1);
});

test('expired refresh lease fails closed after process interruption',async t => {
  const f=await fixture(t);
  await f.connect();
  await f.db.execute({sql:"UPDATE ops_credentials SET status='refreshing',owner='crashed',lease_until=? WHERE provider='canva'",args:[f.now()-1]});
  assert.equal((await f.manager.getStatus()).status,'needs_reconnect');
  await assert.rejects(f.manager.getAccessToken(),error => error.code==='UNCERTAIN_RESULT');
  assert.equal((await f.manager.getStatus()).status,'needs_reconnect');
  assert.equal(f.counts().refreshes,0);
});

test('HTTP connection routes reject legacy auth and never expose credentials',async t => {
  const f=await fixture(t);
  await f.connect();
  const firebase={
    verifyFirebaseToken:async token => {if(token!=='verified-google-token') throw new Error('invalid');return {...adviser,email_verified:true};},
    resolveRole:() => 'advisor',
  };
  const app=express();
  app.use(express.json());
  app.use('/connection',createConnectionRouter({manager:f.manager,env:f.env,firebase}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/connection`;
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer legacy-jwt'}})).status,401);
  const result=await fetch(url,{headers:{Authorization:'Bearer verified-google-token'}});
  assert.equal(result.headers.get('cache-control'),'no-store');
  const body=await result.text();
  assert.equal(JSON.parse(body).connected,true);
  assert.equal(body.includes('private'),false);
  assert.equal(body.includes(f.env.OPS_TOKEN_ENCRYPTION_KEY),false);
});

test('token acquisition errors cannot be mistaken for an uncertain design creation',async () => {
  for (const [incoming,expected,configuration] of [
    ['RECONNECT_REQUIRED','RECONNECT_REQUIRED',true],
    ['UNCERTAIN_RESULT','RECONNECT_REQUIRED',true],
    ['CONFIGURATION_REQUIRED','CONFIGURATION_REQUIRED',true],
    ['CONFIGURATION_MISSING','CONFIGURATION_MISSING',true],
    ['INVALID_CONFIGURATION','CONFIGURATION_INVALID',true],
    ['PROVIDER_BUSY','PROVIDER_BUSY',false],
    ['CONNECTION_CHANGED','PROVIDER_BUSY',false],
    ['SQLITE_BUSY','PROVIDER_UNAVAILABLE',false],
  ]) {
    const providers=withCanvaConnection(
      {createCanvaDesign:async (_input,options) => options.getCanvaAccessToken()},
      {getAccessToken:async () => {const error=new Error('private provider detail');error.code=incoming;throw error;}},
    );
    await assert.rejects(providers.createCanvaDesign({}),error => {
      assert.equal(error.code,expected);
      assert.equal(error.configMissing,configuration);
      assert.equal(error.definite,true);
      assert.equal(error.uncertain,false);
      assert.equal(error.message.includes('private'),false);
      return true;
    });
  }
});

test('expired static test tokens are blocked before the design adapter can send a request',async t => {
  const f=await fixture(t);
  f.env.CANVA_ACCESS_TOKEN='  temporary-token  ';
  f.env.CANVA_ACCESS_TOKEN_EXPIRES_AT=new Date(f.now()+60000).toISOString();
  assert.equal(await f.manager.getAccessToken(),'temporary-token');
  assert.equal((await f.manager.getStatus()).staticTokenConfigured,true);
  f.advance(31000);
  await assert.rejects(f.manager.getAccessToken(),error => error.code==='CONFIGURATION_REQUIRED');
  assert.equal((await f.manager.getStatus()).staticTokenConfigured,false);
  f.env.CANVA_ACCESS_TOKEN_EXPIRES_AT='invalid-date';
  await assert.rejects(f.manager.getAccessToken(),error => error.code==='CONFIGURATION_REQUIRED');
  assert.deepEqual(f.counts(),{exchanges:0,refreshes:0});
});

test('changed encryption key or damaged ciphertext is never reported as a connected account',async t => {
  const f=await fixture(t);
  await f.connect();
  f.env.OPS_TOKEN_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
  assert.equal((await f.manager.getStatus()).connected,false);
  assert.equal((await f.manager.getStatus()).status,'needs_reconnect');
  await assert.rejects(f.manager.getAccessToken(),error => error.code==='RECONNECT_REQUIRED');
  await f.db.execute("UPDATE ops_credentials SET sealed='invalid.payload' WHERE provider='canva'");
  assert.equal((await f.manager.getStatus()).connected,false);
});

test('a late authorization exchange cannot overwrite a newer connection intent',async t => {
  let release;
  let entered;
  const started=new Promise(resolve => {entered=resolve;});
  const gate=new Promise(resolve => {release=resolve;});
  const f=await fixture(t,{
    exchangeAuthorizationCode:async () => {
      entered();
      await gate;
      return {accessToken:'older-access',refreshToken:'older-refresh',expiresAt:new Date(f.now()+3600000).toISOString()};
    },
  });
  const first=await f.manager.start(adviser);
  const completing=f.manager.complete({state:new URL(first.authorizationUrl).searchParams.get('state'),code:'old-code'});
  await started;
  await f.manager.start(adviser);
  release();
  await assert.rejects(completing,error => error.code==='CONNECTION_CHANGED');
  assert.equal((await f.db.execute('SELECT * FROM ops_credentials')).rows.length,0);
});
