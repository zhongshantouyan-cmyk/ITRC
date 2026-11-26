'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createClient } = require('@libsql/client');
const { getIntegrationStatus, getSheetsCredentialMetadata, readSheetSource } = require('./providers');
const { createOpsRouter } = require('./index');

const pair = crypto.generateKeyPairSync('rsa', { modulusLength:2048 });
const account = name => ({
  type:'service_account', project_id:`itrc-test-${name}`,
  client_email:`reader@${name}.iam.gserviceaccount.com`,
  private_key:pair.privateKey.export({type:'pkcs8',format:'pem'}),
  private_key_id:'SYNTHETIC_PRIVATE_KEY_ID', client_id:'SYNTHETIC_CLIENT_ID',
  token_uri:'https://untrusted.example.invalid/token',
});
const firebaseAccount = account('firebase');
const dedicatedAccount = account('dedicated');
const source = { id:'test-source',spreadsheetId:'SheetExample',range:'Test!A1:B5',kind:'tasks',columns:{sourceKey:'ID',title:'Title'} };
const sourceEnv = {OPS_SHEET_SOURCES_JSON:JSON.stringify([source])};
const json = (value,status=200) => new Response(JSON.stringify(value),{status});
const forbiddenNetwork = async () => { throw new Error('Unexpected provider request'); };
const baseEnv = () => ({...sourceEnv,GOOGLE_SHEETS_USE_FIREBASE_SERVICE_ACCOUNT:'true',FIREBASE_SERVICE_ACCOUNT:JSON.stringify(firebaseAccount)});

function forbidFirebaseRead(env) {
  Object.defineProperty(env,'FIREBASE_SERVICE_ACCOUNT',{get(){ throw new Error('Firebase secret must not be read'); }});
  return env;
}

test('Sheets never reads or falls back to Firebase credentials without exact explicit opt-in',async () => {
  for (const flag of [undefined,'','false','1','yes','TRUE',true]) {
    const env = forbidFirebaseRead({...sourceEnv,GOOGLE_SHEETS_USE_FIREBASE_SERVICE_ACCOUNT:flag});
    assert.equal(getIntegrationStatus(env).sheets.configured,false);
    const metadata=getSheetsCredentialMetadata(env);
    assert.equal(metadata.credentialSource,'none');
    assert.equal(metadata.client_email,null);
    assert.equal(metadata.project_id,null);
    assert.ok(metadata.missing.length);
    await assert.rejects(readSheetSource({spreadsheetId:source.spreadsheetId,range:source.range},{env,fetchImpl:forbiddenNetwork}),{code:'CONFIGURATION_MISSING'});
  }
});

test('explicit Firebase reuse signs only readonly scope and projects non-secret identity without external verification claims',async () => {
  const env=baseEnv();
  assert.deepEqual(getSheetsCredentialMetadata(env),{
    client_email:firebaseAccount.client_email,project_id:firebaseAccount.project_id,credentialSource:'firebase_service_account',missing:[],
  });
  const status=getIntegrationStatus(env);
  assert.equal(status.sheets.configured,true);
  assert.equal(status.sheets.verified,false);
  for(const value of [firebaseAccount.client_email,firebaseAccount.project_id,firebaseAccount.private_key,'SYNTHETIC_PRIVATE_KEY_ID','SYNTHETIC_CLIENT_ID']) assert.ok(!JSON.stringify(status).includes(value));
  let calls=0,claims;
  const read=await readSheetSource({spreadsheetId:source.spreadsheetId,range:source.range},{env,fetchImpl:async(url,request)=>{
    calls++;
    if(url==='https://oauth2.googleapis.com/token'){
      const [header,payload,signature]=new URLSearchParams(request.body).get('assertion').split('.');
      assert.ok(crypto.verify('RSA-SHA256',Buffer.from(header+'.'+payload),pair.publicKey,Buffer.from(signature,'base64url')));
      claims=JSON.parse(Buffer.from(payload,'base64url').toString());
      return json({access_token:'SYNTHETIC_READONLY_TOKEN'});
    }
    assert.ok(url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/SheetExample/values/'));
    assert.equal(request.method,'GET');
    assert.equal(request.headers.Authorization,'Bearer SYNTHETIC_READONLY_TOKEN');
    return json({range:source.range,values:[['ID','Title'],['test-fixed-id','【測試】唯讀來源']]});
  }});
  assert.equal(calls,2);
  assert.equal(claims.iss,firebaseAccount.client_email);
  assert.equal(claims.scope,'https://www.googleapis.com/auth/spreadsheets.readonly');
  assert.equal(claims.aud,'https://oauth2.googleapis.com/token');
  assert.equal(Object.hasOwn(claims,'sub'),false);
  assert.equal(read.readOnly,true);
});

test('dedicated Sheets access token wins without reading either service-account credential',async () => {
  const env=forbidFirebaseRead({...sourceEnv,GOOGLE_SHEETS_USE_FIREBASE_SERVICE_ACCOUNT:'true',GOOGLE_SHEETS_ACCESS_TOKEN:'SYNTHETIC_DEDICATED_TOKEN',GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON:'{invalid-dedicated-json'});
  assert.deepEqual(getSheetsCredentialMetadata(env),{client_email:null,project_id:null,credentialSource:'google_sheets_access_token',missing:[]});
  assert.equal(getIntegrationStatus(env).sheets.configured,true);
  let calls=0;
  await readSheetSource({spreadsheetId:source.spreadsheetId,range:source.range},{env,fetchImpl:async(url,request)=>{
    calls++;assert.ok(url.startsWith('https://sheets.googleapis.com/'));
    assert.equal(request.headers.Authorization,'Bearer SYNTHETIC_DEDICATED_TOKEN');
    return json({values:[]});
  }});
  assert.equal(calls,1);
});

test('dedicated Sheets service account wins and invalid dedicated settings never fall back to Firebase',async () => {
  const env=forbidFirebaseRead({...sourceEnv,GOOGLE_SHEETS_USE_FIREBASE_SERVICE_ACCOUNT:'true',GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON:JSON.stringify(dedicatedAccount)});
  assert.equal(getSheetsCredentialMetadata(env).client_email,dedicatedAccount.client_email);
  assert.equal(getSheetsCredentialMetadata(env).credentialSource,'google_sheets_service_account');
  let issuer;
  await readSheetSource({spreadsheetId:source.spreadsheetId,range:source.range},{env,fetchImpl:async(url,request)=>{
    if(url==='https://oauth2.googleapis.com/token'){
      issuer=JSON.parse(Buffer.from(new URLSearchParams(request.body).get('assertion').split('.')[1],'base64url').toString()).iss;
      return json({access_token:'SYNTHETIC_TOKEN'});
    }
    return json({values:[]});
  }});
  assert.equal(issuer,dedicatedAccount.client_email);
  for(const settings of [
    {GOOGLE_SHEETS_ACCESS_TOKEN:'invalid\ntoken'},
    {GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON:'{invalid_dedicated_secret'},
  ]){
    const invalid={...baseEnv(),...settings};
    assert.equal(getIntegrationStatus(invalid).sheets.status,'configuration_invalid');
    assert.throws(()=>getSheetsCredentialMetadata(invalid),{code:'CONFIGURATION_INVALID'});
    await assert.rejects(readSheetSource({spreadsheetId:source.spreadsheetId,range:source.range},{env:invalid,fetchImpl:forbiddenNetwork}),{code:'CONFIGURATION_INVALID'});
  }
});

test('opt-in reports missing Firebase configuration and rejects invalid JSON, identities, and keys safely',async () => {
  const missing={...sourceEnv,GOOGLE_SHEETS_USE_FIREBASE_SERVICE_ACCOUNT:'true'};
  assert.deepEqual(getSheetsCredentialMetadata(missing),{client_email:null,project_id:null,credentialSource:'firebase_service_account',missing:['FIREBASE_SERVICE_ACCOUNT']});
  assert.equal(getIntegrationStatus(missing).sheets.configured,false);
  for(const raw of [
    '{SYNTHETIC_SECRET_INVALID_JSON',JSON.stringify(null),JSON.stringify([]),
    JSON.stringify({...firebaseAccount,type:'authorized_user'}),
    JSON.stringify({...firebaseAccount,client_email:'not-a-service-account@example.com'}),
    JSON.stringify({...firebaseAccount,client_email:'reader\n@example.iam.gserviceaccount.com'}),
    JSON.stringify({...firebaseAccount,private_key:'SYNTHETIC_INVALID_PRIVATE_KEY'}),
  ]){
    const env={...baseEnv(),FIREBASE_SERVICE_ACCOUNT:raw};
    assert.equal(getIntegrationStatus(env).sheets.status,'configuration_invalid');
    assert.throws(()=>getSheetsCredentialMetadata(env),error=>error.code==='CONFIGURATION_INVALID'&&!error.message.includes('SYNTHETIC'));
    await assert.rejects(readSheetSource({spreadsheetId:source.spreadsheetId,range:source.range},{env,fetchImpl:forbiddenNetwork}),{code:'CONFIGURATION_INVALID'});
  }
});

test('metadata omits absent or invalid project IDs and never returns extra credential properties',()=>{
  for(const project_id of [undefined,'invalid/project-id',firebaseAccount.private_key]){
    const env={...baseEnv(),FIREBASE_SERVICE_ACCOUNT:JSON.stringify({...firebaseAccount,project_id})};
    const metadata=getSheetsCredentialMetadata(env);
    assert.deepEqual(Object.keys(metadata).sort(),['client_email','credentialSource','missing','project_id']);
    assert.equal(metadata.project_id,null);
    assert.equal(metadata.client_email,firebaseAccount.client_email);
    assert.deepEqual(metadata.missing,['FIREBASE_SERVICE_ACCOUNT.project_id']);
    const text=JSON.stringify(metadata);
    for(const secret of [firebaseAccount.private_key,'SYNTHETIC_PRIVATE_KEY_ID','SYNTHETIC_CLIENT_ID','token_uri']) assert.ok(!text.includes(secret));
  }
});

async function httpFixture(t,env=baseEnv()){
  const dir=await mkdtemp(path.join(os.tmpdir(),'itrc-sheets-identity-'));
  const db=createClient({url:`file:${path.join(dir,'isolated.db')}`});
  const roles={chair:'chair',advisor:'advisor',officer:'officer',treasurer:'treasurer',retired:'advisor',unverified:'advisor'};
  const firebase={
    verifyFirebaseToken:async token=>{
      if(!Object.hasOwn(roles,token)) throw new Error('SYNTHETIC_INVALID_TOKEN');
      return {uid:'test-'+token,email:token+'@example.invalid',email_verified:token!=='unverified'};
    },
    resolveRole:async email=>roles[email.split('@')[0]],
  };
  const router=createOpsRouter({db,firebase,env:{...env,OPS_APPROVER_EMAILS:'officer@example.invalid'}});
  await router.service.ready;
  await router.service.store.mutate({actorEmail:'fixture@example.invalid',now:'2026-11-26T00:00:00Z'},state=>{
    state.people.push({id:'ITRC-P9999',personId:'ITRC-P9999',email:'retired@example.invalid',status:'retired',version:1});
  });
  const app=express();app.use('/api/ops',router);
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();await rm(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}/api/ops`;
  const get=(token,route='/connections/google-sheets/metadata')=>fetch(origin+route,{headers:token?{Authorization:'Bearer '+token}:{}});
  return {get,router};
}

test('Sheets metadata endpoint requires verified active chair/advisor role and stays out of ordinary bootstrap',async t=>{
  const f=await httpFixture(t);
  for(const token of ['chair','advisor']){
    const response=await f.get(token);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{client_email:firebaseAccount.client_email,project_id:firebaseAccount.project_id,credentialSource:'firebase_service_account',missing:[]});
  }
  for(const [token,expected] of [[null,401],['forged',401],['unverified',401],['officer',403],['treasurer',403],['retired',403]]){
    const response=await f.get(token,'/connections/google-sheets/metadata?role=advisor');
    assert.equal(response.status,expected);
    const text=await response.text();
    for(const value of [firebaseAccount.client_email,firebaseAccount.project_id,firebaseAccount.private_key,'SYNTHETIC_PRIVATE_KEY_ID','SYNTHETIC_CLIENT_ID']) assert.ok(!text.includes(value));
  }
  for(const token of ['chair','officer']){
    const response=await f.get(token,'/bootstrap');
    assert.equal(response.status,200);
    const text=await response.text();
    for(const value of [firebaseAccount.client_email,firebaseAccount.project_id,firebaseAccount.private_key,'credentialSource']) assert.ok(!text.includes(value));
  }
});

test('metadata endpoint sanitizes invalid configured credentials without returning raw input',async t=>{
  const f=await httpFixture(t,{...baseEnv(),FIREBASE_SERVICE_ACCOUNT:'{SYNTHETIC_SECRET_SHOULD_NEVER_LEAK'});
  const response=await f.get('advisor');
  assert.equal(response.status,409);
  const body=await response.json();
  assert.equal(body.code,'CONFIGURATION_INVALID');
  assert.ok(!JSON.stringify(body).includes('SYNTHETIC_SECRET'));
});
